/**
 * Gemini Live session setup for the `live` comm tier (specs/04-ai-backend.md §4.2).
 * The browser connects straight to Gemini with a short-lived token; the API key never
 * leaves the server.
 */

export interface LiveToken {
  token: string;
  wsUrl: string;
  expiresAtIso: string;
}

/** Mints a single-use ephemeral token. Returns `null` on any failure. */
export async function mintLiveToken(geminiKey: string): Promise<LiveToken | null> {
  try {
    const expiresAtIso = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        uses: 1,
        expireTime: expiresAtIso,
        newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(`[ARGUS live] token request failed (${res.status})`);
      return null;
    }
    const token = ((await res.json()) as { name?: string }).name?.trim();
    if (!token) return null;
    return {
      token,
      expiresAtIso,
      wsUrl: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`,
    };
  } catch (err) {
    console.warn('[ARGUS live] token request failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** First WebSocket message of a Live session: model, voice, persona and tools. */
export function buildAssistantLiveSetup(params: {
  model: string;
  voice: string;
  systemInstruction: string;
  tools: Array<{ name: string; description: string; parameters: unknown; behavior: 'NON_BLOCKING' }>;
}) {
  return {
    setup: {
      model: `models/${params.model.replace(/^models\//, '')}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: params.voice } } },
      },
      systemInstruction: { parts: [{ text: params.systemInstruction }] },
      tools: [{ functionDeclarations: params.tools }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}
