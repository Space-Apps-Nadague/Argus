package main

import "testing"

func TestExtractTriggerPrompt(t *testing.T) {
	tests := []struct {
		name      string
		text      string
		botUser   string
		mentions  []string
		wantOK    bool
		wantClean string
	}{
		{
			name:      "literal @argus prefix",
			text:      "@argus list issues",
			wantOK:    true,
			wantClean: "list issues",
		},
		{
			name:      "case-insensitive @Argus with comma",
			text:      "hey @Argus, what is the radiation threshold?",
			wantOK:    true,
			wantClean: "hey what is the radiation threshold?",
		},
		{
			name:      "native WhatsApp mention of bot JID",
			text:      "@15551234567 pm audit",
			botUser:   "15551234567",
			mentions:  []string{"15551234567@s.whatsapp.net"},
			wantOK:    true,
			wantClean: "pm audit",
		},
		{
			name:     "unrelated group message",
			text:     "good morning everyone!",
			botUser:  "15551234567",
			mentions: []string{"19998887777@s.whatsapp.net"},
			wantOK:   false,
		},
		{
			name:   "email address should not trigger",
			text:   "email me at test@argus.space",
			wantOK: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := extractTriggerPrompt(tc.text, tc.botUser, tc.mentions)
			if ok != tc.wantOK {
				t.Fatalf("triggered = %v, want %v", ok, tc.wantOK)
			}
			if ok && got != tc.wantClean {
				t.Fatalf("prompt = %q, want %q", got, tc.wantClean)
			}
		})
	}
}

func TestRedactSecrets(t *testing.T) {
	t.Setenv("GEMINI_API_KEY", "secret-gemini-123")
	t.Setenv("GH_PROJECT_TOKEN", "ghp_secret_456")

	got := redactSecrets("error with secret-gemini-123 and ghp_secret_456")
	want := "error with [REDACTED] and [REDACTED]"
	if got != want {
		t.Fatalf("redactSecrets = %q, want %q", got, want)
	}
}
