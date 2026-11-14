package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const maxWhatsAppReplyLen = 3500

var issueNumRe = regexp.MustCompile(`#?(\d+)`)

type agentRouter struct {
	repoRoot string
	gemini   *geminiClient
}

func newAgentRouter(repoRoot string, gemini *geminiClient) *agentRouter {
	return &agentRouter{
		repoRoot: repoRoot,
		gemini:   gemini,
	}
}

func (a *agentRouter) handle(ctx context.Context, senderName, prompt string, groupHistory []string) (string, error) {
	trimmed := strings.TrimSpace(prompt)
	if trimmed == "" || strings.EqualFold(trimmed, "help") || trimmed == "?" {
		return helpText(), nil
	}

	lower := strings.ToLower(trimmed)

	switch {
	case lower == "issues" || lower == "list issues" || lower == "list-issues":
		return a.listIssues(ctx)
	case lower == "tasks" || lower == "list tasks" || lower == "list-tasks":
		return a.listSWETasks(ctx)
	case lower == "pm" || strings.HasPrefix(lower, "pm "):
		arg := strings.TrimSpace(trimmed[2:])
		return a.runPMSubagent(ctx, senderName, arg)
	case lower == "swe" || strings.HasPrefix(lower, "swe "):
		arg := strings.TrimSpace(trimmed[3:])
		return a.runSWESubagent(ctx, senderName, arg)
	default:
		return a.answerQuestion(ctx, senderName, trimmed, groupHistory)
	}
}

func helpText() string {
	return strings.TrimSpace(`*ARGUS WhatsApp Agent*
Mention *@argus* with:
• *@argus <question>* — Ask about ARGUS, code, specs, or group context
• *@argus issues* — List open GitHub issues
• *@argus tasks* — List actionable SWE agent tasks
• *@argus pm audit* — Run PM agent audit (--dry-run)
• *@argus pm audit live* — Run PM agent audit (live GitHub mutations)
• *@argus pm <prompt>* — Ask the PM subagent (specs, triage, issue draft)
• *@argus swe <issue# | prompt>* — Run SWE subagent on an issue or task
• *@argus swe worktree <issue#>* — Create isolated .worktrees/issue-<n>`)
}

func (a *agentRouter) listIssues(ctx context.Context) (string, error) {
	out, err := a.runNodeScript(ctx, 30*time.Second, ".agents/skills/pm-agent/scripts/gh-pm-issue.mjs", "list", "--state", "open")
	if err != nil {
		return "", fmt.Errorf("failed to list issues: %w (%s)", err, truncate(out, 400))
	}
	var parsed struct {
		Total  int `json:"total"`
		Issues []struct {
			Number int      `json:"number"`
			Title  string   `json:"title"`
			Labels []string `json:"labels"`
		} `json:"issues"`
	}
	if json.Unmarshal([]byte(out), &parsed) == nil {
		if len(parsed.Issues) == 0 {
			return "No open GitHub issues.", nil
		}
		var sb strings.Builder
		fmt.Fprintf(&sb, "*Open GitHub Issues (%d):*\n", parsed.Total)
		for _, iss := range parsed.Issues {
			lbl := ""
			if len(iss.Labels) > 0 {
				lbl = fmt.Sprintf(" _(%s)_", strings.Join(iss.Labels, ", "))
			}
			fmt.Fprintf(&sb, "• *#%d* %s%s\n", iss.Number, iss.Title, lbl)
		}
		return truncate(sb.String(), maxWhatsAppReplyLen), nil
	}
	return "*Open GitHub Issues:*\n" + truncate(out, maxWhatsAppReplyLen-30), nil
}

func (a *agentRouter) listSWETasks(ctx context.Context) (string, error) {
	out, err := a.runNodeScript(ctx, 30*time.Second, ".agents/skills/swe-agent/scripts/gh-swe-pr.mjs", "list-tasks")
	if err != nil {
		return "", fmt.Errorf("failed to list SWE tasks: %w (%s)", err, truncate(out, 400))
	}
	var parsed struct {
		ActionableCount int `json:"actionableCount"`
		ActionableTasks []struct {
			Number int      `json:"number"`
			Title  string   `json:"title"`
			Labels []string `json:"labels"`
		} `json:"actionableTasks"`
	}
	if json.Unmarshal([]byte(out), &parsed) == nil {
		if len(parsed.ActionableTasks) == 0 {
			return "No actionable SWE agent tasks.", nil
		}
		var sb strings.Builder
		fmt.Fprintf(&sb, "*Actionable SWE Tasks (%d):*\n", parsed.ActionableCount)
		for _, t := range parsed.ActionableTasks {
			fmt.Fprintf(&sb, "• *#%d* %s\n", t.Number, t.Title)
		}
		return truncate(sb.String(), maxWhatsAppReplyLen), nil
	}
	return "*SWE Agent Tasks:*\n" + truncate(out, maxWhatsAppReplyLen-30), nil
}

func (a *agentRouter) runPMSubagent(ctx context.Context, senderName, arg string) (string, error) {
	lower := strings.ToLower(strings.TrimSpace(arg))

	if lower == "" || lower == "audit" || lower == "dry-run" || lower == "audit dry-run" {
		out, err := a.runNodeScript(ctx, 2*time.Minute, ".agents/skills/pm-agent/scripts/run-pm-audit.mjs", "--dry-run")
		if err != nil {
			return "", fmt.Errorf("PM audit (--dry-run) failed: %w (%s)", err, truncate(out, 400))
		}
		return "*[PM Subagent — Dry Run]*\n" + truncate(out, maxWhatsAppReplyLen-40), nil
	}

	if lower == "audit live" || lower == "live" {
		out, err := a.runNodeScript(ctx, 2*time.Minute, ".agents/skills/pm-agent/scripts/run-pm-audit.mjs")
		if err != nil {
			return "", fmt.Errorf("PM audit (live) failed: %w (%s)", err, truncate(out, 400))
		}
		return "*[PM Subagent — Live Audit]*\n" + truncate(out, maxWhatsAppReplyLen-40), nil
	}

	if customCmd := strings.TrimSpace(os.Getenv("ARGUS_PM_CMD")); customCmd != "" {
		out, err := a.runShellHook(ctx, 3*time.Minute, customCmd, arg)
		if err != nil {
			return "", fmt.Errorf("PM subagent hook failed: %w (%s)", err, truncate(out, 400))
		}
		return "*[PM Subagent]*\n" + truncate(out, maxWhatsAppReplyLen-30), nil
	}

	// Built-in PM subagent via Gemini grounded in PM SKILL.md + requirements + open issues.
	pmSkill := a.readRepoFile(".agents/skills/pm-agent/SKILL.md", 4000)
	reqs := a.readRepoFile("specs/03-requirements.md", 4000)
	issuesOut, _ := a.runNodeScript(ctx, 20*time.Second, ".agents/skills/pm-agent/scripts/gh-pm-issue.mjs", "list", "--state", "open")

	sysPrompt := fmt.Sprintf(
		"You are the ARGUS Product Manager (PM) Subagent responding in a WhatsApp team group.\n"+
			"Keep responses concise, scannable, and formatted for WhatsApp (*bold*, bullet points, under 1500 chars).\n\n"+
			"PM Skill Mandate:\n%s\n\nRequirements Summary:\n%s\n\nCurrent Open Issues:\n%s",
		pmSkill, reqs, truncate(issuesOut, 2500),
	)
	userPrompt := fmt.Sprintf("Request from %s: %s", senderName, arg)

	reply, err := a.gemini.ask(ctx, sysPrompt, userPrompt)
	if err != nil {
		return "", fmt.Errorf("PM subagent error: %w", err)
	}
	return "*[PM Subagent]*\n" + truncate(reply, maxWhatsAppReplyLen-30), nil
}

func (a *agentRouter) runSWESubagent(ctx context.Context, senderName, arg string) (string, error) {
	trimmed := strings.TrimSpace(arg)
	lower := strings.ToLower(trimmed)

	if trimmed == "" {
		return a.listSWETasks(ctx)
	}

	if strings.HasPrefix(lower, "worktree ") || strings.HasPrefix(lower, "prepare ") {
		m := issueNumRe.FindStringSubmatch(trimmed)
		if len(m) < 2 {
			return "Usage: *@argus swe worktree <issue_number>*", nil
		}
		out, err := a.runNodeScript(ctx, 60*time.Second, ".agents/skills/swe-agent/scripts/gh-swe-pr.mjs", "prepare-worktree", "--issue", m[1])
		if err != nil {
			return "", fmt.Errorf("failed to prepare worktree for #%s: %w (%s)", m[1], err, truncate(out, 400))
		}
		return fmt.Sprintf("*[SWE Subagent — Worktree Ready #%s]*\n%s", m[1], truncate(out, maxWhatsAppReplyLen-60)), nil
	}

	if customCmd := strings.TrimSpace(os.Getenv("ARGUS_SWE_CMD")); customCmd != "" {
		out, err := a.runShellHook(ctx, 5*time.Minute, customCmd, trimmed)
		if err != nil {
			return "", fmt.Errorf("SWE subagent hook failed: %w (%s)", err, truncate(out, 400))
		}
		return "*[SWE Subagent]*\n" + truncate(out, maxWhatsAppReplyLen-30), nil
	}

	// Built-in SWE subagent: fetch issue details if an issue # is mentioned, then plan via Gemini.
	var issueContext string
	if m := issueNumRe.FindStringSubmatch(trimmed); len(m) >= 2 {
		out, err := a.runNodeScript(ctx, 20*time.Second, ".agents/skills/swe-agent/scripts/gh-swe-pr.mjs", "view-task", m[1])
		if err != nil || strings.TrimSpace(out) == "" {
			out, _ = a.runNodeScript(ctx, 20*time.Second, ".agents/skills/pm-agent/scripts/gh-pm-issue.mjs", "view", m[1])
		}
		issueContext = truncate(out, 3000)
	} else {
		out, _ := a.runNodeScript(ctx, 20*time.Second, ".agents/skills/swe-agent/scripts/gh-swe-pr.mjs", "list-tasks")
		issueContext = truncate(out, 2000)
	}

	sweSkill := a.readRepoFile(".agents/skills/swe-agent/SKILL.md", 3500)
	agentsDoc := a.readRepoFile("AGENTS.md", 2500)

	sysPrompt := fmt.Sprintf(
		"You are the ARGUS Software Engineer (SWE) Subagent responding in a WhatsApp team group.\n"+
			"Follow spec-first development (AGENTS.md) and keep your answer concise and scannable for WhatsApp (*bold*, bullets, under 1800 chars).\n"+
			"Provide: 1) Spec files to check/update, 2) Target source files & implementation plan, 3) Verification commands (`npm test`, `npm run build`).\n\n"+
			"SWE Skill:\n%s\n\nAGENTS.md:\n%s\n\nIssue / Task Context:\n%s",
		sweSkill, agentsDoc, issueContext,
	)
	userPrompt := fmt.Sprintf("SWE request from %s: %s", senderName, trimmed)

	reply, err := a.gemini.ask(ctx, sysPrompt, userPrompt)
	if err != nil {
		return "", fmt.Errorf("SWE subagent error: %w", err)
	}
	return "*[SWE Subagent]*\n" + truncate(reply, maxWhatsAppReplyLen-30), nil
}

func (a *agentRouter) answerQuestion(ctx context.Context, senderName, question string, groupHistory []string) (string, error) {
	agentsDoc := a.readRepoFile("AGENTS.md", 2500)
	readmeDoc := a.readRepoFile("README.md", 2500)

	historyBlock := "(none)"
	if len(groupHistory) > 0 {
		historyBlock = strings.Join(groupHistory, "\n")
	}

	sysPrompt := fmt.Sprintf(
		"You are *@argus*, an AI teammate in the ARGUS hackathon WhatsApp group.\n"+
			"Answer clearly and concisely for WhatsApp (use *bold* for headings, keep under 1500 chars unless detail is requested).\n"+
			"If the user wants to list issues or run PM/SWE subagents, remind them they can also use `@argus issues`, `@argus pm ...`, or `@argus swe ...`.\n\n"+
			"Project Context (AGENTS.md):\n%s\n\nREADME:\n%s",
		agentsDoc, readmeDoc,
	)
	userPrompt := fmt.Sprintf(
		"Recent group messages:\n%s\n\nQuestion from %s:\n%s",
		historyBlock, senderName, question,
	)

	reply, err := a.gemini.ask(ctx, sysPrompt, userPrompt)
	if err != nil {
		return "", fmt.Errorf("error answering question: %w", err)
	}
	return truncate(reply, maxWhatsAppReplyLen), nil
}

func (a *agentRouter) runNodeScript(ctx context.Context, timeout time.Duration, relScript string, args ...string) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	scriptPath := filepath.Join(a.repoRoot, relScript)
	cmdArgs := append([]string{scriptPath}, args...)
	fmt.Printf("[Script] node %s %v\n", relScript, args)
	cmd := exec.CommandContext(cctx, "node", cmdArgs...)
	cmd.Dir = a.repoRoot

	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[ScriptError] %s err=%v out=%s\n", relScript, err, truncate(buf.String(), 400))
	}
	return strings.TrimSpace(buf.String()), err
}

func (a *agentRouter) runShellHook(ctx context.Context, timeout time.Duration, commandTemplate, prompt string) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(cctx, "sh", "-c", commandTemplate)
	cmd.Dir = a.repoRoot
	cmd.Env = append(os.Environ(), "ARGUS_PROMPT="+prompt)

	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	return strings.TrimSpace(buf.String()), err
}

func (a *agentRouter) readRepoFile(relPath string, maxChars int) string {
	data, err := os.ReadFile(filepath.Join(a.repoRoot, relPath))
	if err != nil {
		return ""
	}
	return truncate(string(data), maxChars)
}

func truncate(s string, maxLen int) string {
	s = strings.TrimSpace(s)
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return s[:maxLen]
	}
	return s[:maxLen-3] + "..."
}
