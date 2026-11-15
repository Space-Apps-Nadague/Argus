/**
 * Client for the unified ARGUS assistant (specs/04-ai-backend.md §4.2–§4.4):
 * the conversation stream, live-session setup, speech, voices, mental-state history and
 * reports to Earth.
 */

import type { AiEnvelope, VoiceSttRequest, VoiceSttResponse, VoiceTtsRequest, VoiceTtsResponse } from '../types/aiApi';
import type {
  AssessRequest,
  AssessResponse,
  AssistantToolRequest,
  AssistantToolResponse,
  ConverseEvent,
  ConverseRequest,
  EarthReport,
  LiveSessionRequest,
  LiveSessionResponse,
  MentalStateAssessment,
  NewEarthReport,
  VoicesResponse,
} from '../types/assistant';
import { API_BASE, ArgusApiError } from './argusApi';
import { apiJson } from './dataApi';

function headers(runtimeApiKey?: string): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (runtimeApiKey?.trim()) h['X-AI-Key'] = runtimeApiKey.trim();
  return h;
}

async function post<T>(path: string, body: unknown, key?: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: headers(key), body: JSON.stringify(body), signal, credentials: 'include' });
  } catch (err) {
    throw new ArgusApiError(`ARGUS backend unreachable: ${(err as Error).message}`);
  }
  if (!res.ok) throw new ArgusApiError(`ARGUS backend error ${res.status}`, res.status);
  return (await res.json()) as T;
}

/** Parses an SSE byte stream into events. Exported for tests. */
export async function readSse<T>(body: ReadableStream<Uint8Array>, onEvent: (event: T) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) onEvent(JSON.parse(data) as T);
    }
  }
}

/** Streams one conversation turn. Resolves when the server sends `done` or the stream ends. */
export async function streamConverse(
  req: ConverseRequest,
  onEvent: (event: ConverseEvent) => void,
  options: { runtimeApiKey?: string; signal?: AbortSignal } = {}
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ai/converse`, {
    method: 'POST',
    headers: headers(options.runtimeApiKey),
    body: JSON.stringify(req),
    signal: options.signal,
    credentials: 'include',
  }).catch((err: Error) => {
    if (err.name === 'AbortError') throw err;
    throw new ArgusApiError(`ARGUS backend unreachable: ${err.message}`);
  });
  if (!res.ok || !res.body) throw new ArgusApiError(`ARGUS backend error ${res.status}`, res.status);
  await readSse<ConverseEvent>(res.body, onEvent);
}

export const assistantApi = {
  liveSession: (req: LiveSessionRequest, key?: string, signal?: AbortSignal) => post<LiveSessionResponse>('/api/ai/live-session', req, key, signal),
  tool: (req: AssistantToolRequest, key?: string) => post<AssistantToolResponse>('/api/ai/assistant-tool', req, key),
  assess: (req: AssessRequest, key?: string) => post<AssessResponse>('/api/ai/assess', req, key),
  stt: (req: VoiceSttRequest, key?: string, signal?: AbortSignal) => post<AiEnvelope<VoiceSttResponse>>('/api/ai/stt', req, key, signal),
  tts: (req: VoiceTtsRequest, key?: string, signal?: AbortSignal) => post<AiEnvelope<VoiceTtsResponse>>('/api/ai/tts', req, key, signal),
  voices: async (key?: string): Promise<VoicesResponse | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/ai/voices`, { headers: headers(key), credentials: 'include' });
      return res.ok ? ((await res.json()) as VoicesResponse) : null;
    } catch {
      return null;
    }
  },
};

/** Reports to the doctors on Earth and mental-state history (server mode only). */
export const earthApi = {
  send: (crewId: string, report: NewEarthReport) =>
    apiJson<{ report: EarthReport }>(`/api/astronauts/${encodeURIComponent(crewId)}/packets`, { body: report }),
  mine: (crewId: string) => apiJson<{ reports: EarthReport[] }>(`/api/astronauts/${encodeURIComponent(crewId)}/packets`),
  inbox: () => apiJson<{ reports: EarthReport[] }>('/api/packets/inbox'),
  markRead: (packetId: string) => apiJson<{ ok: true }>(`/api/packets/${encodeURIComponent(packetId)}/read`, { body: {} }),
  reply: (packetId: string, text: string) =>
    apiJson<{ report: EarthReport }>(`/api/packets/${encodeURIComponent(packetId)}/reply`, { body: { text } }),
  saveAssessment: (crewId: string, assessment: MentalStateAssessment) =>
    apiJson<{ ok: true }>(`/api/astronauts/${encodeURIComponent(crewId)}/mental-state`, { body: assessment }),
  history: (crewId: string) => apiJson<{ history: MentalStateAssessment[] }>(`/api/astronauts/${encodeURIComponent(crewId)}/mental-state`),
};
