package main

import (
	"bufio"
	"context"
	"database/sql"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/mdp/qrterminal/v3"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
	_ "modernc.org/sqlite"
)

var argusMentionRe = regexp.MustCompile(`(?i)(^|\s)@argus\b[:,]?`)

type groupBuffer struct {
	mu    sync.Mutex
	chats map[string][]string
	limit int
}

func newGroupBuffer(limit int) *groupBuffer {
	return &groupBuffer{
		chats: make(map[string][]string),
		limit: limit,
	}
}

func (b *groupBuffer) add(chatJID, sender, text string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	entry := fmt.Sprintf("%s: %s", sender, text)
	buf := append(b.chats[chatJID], entry)
	if len(buf) > b.limit {
		buf = buf[len(buf)-b.limit:]
	}
	b.chats[chatJID] = buf
}

func (b *groupBuffer) snapshot(chatJID string) []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	src := b.chats[chatJID]
	out := make([]string, len(src))
	copy(out, src)
	return out
}

func main() {
	oncePrompt := flag.String("once", "", "run a single prompt through the agent router and exit")
	flag.Parse()

	repoRoot := findRepoRoot()
	loadDotEnv(filepath.Join(repoRoot, ".env"))

	if strings.TrimSpace(*oncePrompt) != "" {
		router := newAgentRouter(repoRoot, newGeminiClient())
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		reply, err := router.handle(ctx, "CLI", *oncePrompt, nil)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: %v\n", err)
			os.Exit(1)
		}
		fmt.Println(redactSecrets(reply))
		return
	}

	dbPath := strings.TrimSpace(os.Getenv("WHATSAPP_DB_PATH"))
	if dbPath == "" {
		dbPath = filepath.Join(repoRoot, "tools", "whatsapp-bot", "whatsapp.db")
	}

	allowedGroups := parseCSVSet(os.Getenv("WHATSAPP_GROUP_JID"))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dbLog := waLog.Stdout("Database", "WARN", true)
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)", dbPath)
	rawDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open sqlite db: %v\n", err)
		os.Exit(1)
	}
	rawDB.SetMaxOpenConns(1)
	container := sqlstore.NewWithDB(rawDB, "sqlite", dbLog)
	if err := container.Upgrade(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "failed to upgrade whatsapp store: %v\n", err)
		os.Exit(1)
	}

	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to get device store: %v\n", err)
		os.Exit(1)
	}

	clientLog := waLog.Stdout("Client", "WARN", true)
	client := whatsmeow.NewClient(deviceStore, clientLog)

	router := newAgentRouter(repoRoot, newGeminiClient())
	history := newGroupBuffer(12)
	var sentIDs sync.Map

	client.AddEventHandler(func(rawEvt interface{}) {
		switch evt := rawEvt.(type) {
		case *events.Connected:
			fmt.Println("Connected to WhatsApp.")
			if len(allowedGroups) == 0 {
				fmt.Println("WHATSAPP_GROUP_JID is not set — listening to all groups (mention @argus in a group to see its JID).")
			} else {
				fmt.Printf("Listening to group(s): %v\n", mapKeys(allowedGroups))
			}
		case *events.Message:
			go handleMessage(ctx, client, router, history, &sentIDs, allowedGroups, evt)
		}
	})

	if client.Store.ID == nil {
		qrChan, _ := client.GetQRChannel(ctx)
		if err := client.Connect(); err != nil {
			fmt.Fprintf(os.Stderr, "connect error: %v\n", err)
			os.Exit(1)
		}
		for evt := range qrChan {
			if evt.Event == "code" {
				fmt.Println("Scan this QR code in WhatsApp (Linked Devices -> Link a Device):")
				qrterminal.GenerateHalfBlock(evt.Code, qrterminal.L, os.Stdout)
			} else {
				fmt.Println("WhatsApp login event:", evt.Event)
			}
		}
	} else {
		if err := client.Connect(); err != nil {
			fmt.Fprintf(os.Stderr, "connect error: %v\n", err)
			os.Exit(1)
		}
	}

	<-ctx.Done()
	fmt.Println("\nShutting down ARGUS WhatsApp bot...")
	client.Disconnect()
}

func handleMessage(
	ctx context.Context,
	client *whatsmeow.Client,
	router *agentRouter,
	history *groupBuffer,
	sentIDs *sync.Map,
	allowedGroups map[string]struct{},
	evt *events.Message,
) {
	if evt.Info.Chat.Server != types.GroupServer {
		return
	}
	if _, isBotReply := sentIDs.Load(evt.Info.ID); isBotReply {
		return
	}

	chatJID := evt.Info.Chat.String()
	if len(allowedGroups) > 0 {
		if _, ok := allowedGroups[chatJID]; !ok {
			return
		}
	}

	text, mentionedJIDs := extractTextAndMentions(evt.Message)
	if strings.TrimSpace(text) == "" {
		return
	}

	sender := evt.Info.PushName
	if sender == "" {
		sender = evt.Info.Sender.User
	}

	// Check if triggered by literal "@argus" or native WhatsApp @mention of this bot's user.
	botUser := ""
	if client.Store.ID != nil {
		botUser = client.Store.ID.User
	}
	prompt, triggered := extractTriggerPrompt(text, botUser, mentionedJIDs)
	if !triggered {
		history.add(chatJID, sender, text)
		return
	}

	fmt.Printf("[Trigger] group=%s sender=%s prompt=%q\n", chatJID, sender, prompt)

	_ = client.SendChatPresence(ctx, evt.Info.Chat, types.ChatPresenceComposing, types.ChatPresenceMediaText)
	defer func() {
		_ = client.SendChatPresence(ctx, evt.Info.Chat, types.ChatPresencePaused, types.ChatPresenceMediaText)
	}()

	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	start := time.Now()
	rawReply, err := router.handle(reqCtx, sender, prompt, history.snapshot(chatJID))
	if err != nil {
		fmt.Fprintf(os.Stderr, "[AgentError] group=%s elapsed=%s err=%v\n", chatJID, time.Since(start).Round(time.Millisecond), err)
		return
	}
	reply := redactSecrets(rawReply)
	fmt.Printf("[Reply] group=%s elapsed=%s len=%d\n", chatJID, time.Since(start).Round(time.Millisecond), len(reply))
	history.add(chatJID, sender, text)
	history.add(chatJID, "ARGUS", reply)

	msg := &waE2E.Message{
		ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text: proto.String(reply),
			ContextInfo: &waE2E.ContextInfo{
				StanzaID:      proto.String(evt.Info.ID),
				Participant:   proto.String(evt.Info.Sender.String()),
				QuotedMessage: evt.Message,
			},
		},
	}

	resp, err := client.SendMessage(ctx, evt.Info.Chat, msg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[SendError] group=%s err=%v\n", chatJID, err)
		return
	}
	fmt.Printf("[Sent] group=%s id=%s\n", chatJID, resp.ID)
	sentIDs.Store(resp.ID, struct{}{})
}

func extractTextAndMentions(m *waE2E.Message) (string, []string) {
	if m == nil {
		return "", nil
	}
	if dsm := m.GetDeviceSentMessage(); dsm != nil && dsm.GetMessage() != nil {
		return extractTextAndMentions(dsm.GetMessage())
	}
	if em := m.GetEditedMessage(); em != nil && em.GetMessage() != nil {
		return extractTextAndMentions(em.GetMessage())
	}
	if m.Conversation != nil {
		return m.GetConversation(), nil
	}
	if ext := m.GetExtendedTextMessage(); ext != nil {
		var mentions []string
		if ci := ext.GetContextInfo(); ci != nil {
			mentions = ci.GetMentionedJID()
		}
		return ext.GetText(), mentions
	}
	if img := m.GetImageMessage(); img != nil {
		var mentions []string
		if ci := img.GetContextInfo(); ci != nil {
			mentions = ci.GetMentionedJID()
		}
		return img.GetCaption(), mentions
	}
	return "", nil
}

func extractTriggerPrompt(text, botUser string, mentionedJIDs []string) (string, bool) {
	if argusMentionRe.MatchString(text) {
		cleaned := argusMentionRe.ReplaceAllString(text, " ")
		return strings.Join(strings.Fields(cleaned), " "), true
	}
	if botUser != "" {
		for _, jid := range mentionedJIDs {
			if strings.HasPrefix(jid, botUser+"@") || jid == botUser {
				cleaned := strings.ReplaceAll(text, "@"+botUser, "")
				return strings.Join(strings.Fields(cleaned), " "), true
			}
		}
	}
	return "", false
}

func findRepoRoot() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	dir := wd
	for {
		if _, err := os.Stat(filepath.Join(dir, "AGENTS.md")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return wd
		}
		dir = parent
	}
}

func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		v = strings.Trim(v, `"'`)
		if k != "" && v != "" && os.Getenv(k) == "" {
			_ = os.Setenv(k, v)
		}
	}
}

func parseCSVSet(raw string) map[string]struct{} {
	out := make(map[string]struct{})
	for _, part := range strings.Split(raw, ",") {
		p := strings.TrimSpace(part)
		if p != "" {
			out[p] = struct{}{}
		}
	}
	return out
}

func mapKeys(m map[string]struct{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func redactSecrets(s string) string {
	for _, envKey := range []string{"GEMINI_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "GH_PROJECT_TOKEN"} {
		if val := strings.TrimSpace(os.Getenv(envKey)); val != "" {
			s = strings.ReplaceAll(s, val, "[REDACTED]")
		}
	}
	return s
}
