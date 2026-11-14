package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

type geminiClient struct {
	apiKey     string
	model      string
	httpClient *http.Client
}

func newGeminiClient() *geminiClient {
	model := strings.TrimSpace(os.Getenv("GEMINI_MODEL"))
	if model == "" {
		model = "gemini-3.1-flash-lite"
	}
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: 5 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 25 * time.Second,
		DisableKeepAlives:     true,
		ForceAttemptHTTP2:     false,
	}
	return &geminiClient{
		apiKey: strings.TrimSpace(os.Getenv("GEMINI_API_KEY")),
		model:  model,
		httpClient: &http.Client{
			Timeout:   30 * time.Second,
			Transport: transport,
		},
	}
}

func (g *geminiClient) configured() bool {
	return g.apiKey != ""
}

type geminiRequest struct {
	SystemInstruction *geminiContent    `json:"systemInstruction,omitempty"`
	Contents          []geminiContent   `json:"contents"`
	GenerationConfig  *geminiGenConfig  `json:"generationConfig,omitempty"`
}

type geminiGenConfig struct {
	ThinkingConfig *geminiThinkingConfig `json:"thinkingConfig,omitempty"`
}

type geminiThinkingConfig struct {
	ThinkingBudget int `json:"thinkingBudget"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiResponse struct {
	Candidates []struct {
		Content geminiContent `json:"content"`
	} `json:"candidates"`
	Error *struct {
		Message string `json:"message"`
		Code    int    `json:"code"`
	} `json:"error,omitempty"`
}

func (g *geminiClient) ask(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	if !g.configured() {
		return "", fmt.Errorf("GEMINI_API_KEY is not set in environment or .env")
	}

	reqBody := geminiRequest{
		Contents: []geminiContent{
			{
				Role:  "user",
				Parts: []geminiPart{{Text: userPrompt}},
			},
		},
		GenerationConfig: &geminiGenConfig{
			ThinkingConfig: &geminiThinkingConfig{ThinkingBudget: 0},
		},
	}
	if strings.TrimSpace(systemPrompt) != "" {
		reqBody.SystemInstruction = &geminiContent{
			Parts: []geminiPart{{Text: systemPrompt}},
		}
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	endpoint := fmt.Sprintf(
		"https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent",
		g.model,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", g.apiKey)

	start := time.Now()
	fmt.Printf("[Gemini] POST model=%s promptBytes=%d\n", g.model, len(payload))
	resp, err := g.httpClient.Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[GeminiError] model=%s elapsed=%s err=%v\n", g.model, time.Since(start).Round(time.Millisecond), err)
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[GeminiReadError] model=%s status=%d err=%v\n", g.model, resp.StatusCode, err)
		return "", err
	}

	var parsed geminiResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		fmt.Fprintf(os.Stderr, "[GeminiDecodeError] model=%s status=%d err=%v body=%s\n", g.model, resp.StatusCode, err, string(body))
		return "", fmt.Errorf("gemini decode error (status %d): %w", resp.StatusCode, err)
	}
	if parsed.Error != nil {
		fmt.Fprintf(os.Stderr, "[GeminiAPIError] model=%s code=%d msg=%s\n", g.model, parsed.Error.Code, parsed.Error.Message)
		return "", fmt.Errorf("gemini API error (%d): %s", parsed.Error.Code, parsed.Error.Message)
	}
	if resp.StatusCode >= 400 {
		fmt.Fprintf(os.Stderr, "[GeminiHTTPError] model=%s status=%d body=%s\n", g.model, resp.StatusCode, strings.TrimSpace(string(body)))
		return "", fmt.Errorf("gemini HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if len(parsed.Candidates) == 0 || len(parsed.Candidates[0].Content.Parts) == 0 {
		fmt.Fprintf(os.Stderr, "[GeminiEmpty] model=%s body=%s\n", g.model, strings.TrimSpace(string(body)))
		return "", fmt.Errorf("gemini returned an empty response")
	}

	fmt.Printf("[Gemini] OK model=%s elapsed=%s\n", g.model, time.Since(start).Round(time.Millisecond))

	var out strings.Builder
	for _, part := range parsed.Candidates[0].Content.Parts {
		out.WriteString(part.Text)
	}
	return strings.TrimSpace(out.String()), nil
}
