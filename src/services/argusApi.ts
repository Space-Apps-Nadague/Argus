/**
 * ARGUS AI backend client (specs/04-ai-backend.md §4).
 * The browser never holds a provider key unless the crew types one into the HUD; it is then
 * forwarded per request in `X-AI-Key` and never stored server-side.
 */

import type {
  AiEnvelope,
  AiProviderStatus,
  ChatRequest,
  ChatStreamEvent,
  CrewContextRequest,
  DiagnosticsReport,
  CountermeasurePlan,
  WellbeingAssessment,
  WellbeingRequest,
  GuidanceRequest,
  VisionRequest,
} from '../types/aiApi';
import type { FlightSurgeonGuidance, VisualExamAnalysis } from '../types/argus';

export const API_BASE = (import.meta.env.VITE_ARGUS_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

export class ArgusApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'ArgusApiError';
  }
}

function headers(runtimeApiKey?: string): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (runtimeApiKey?.trim()) h['X-AI-Key'] = runtimeApiKey.trim();
  return h;
}

async function postJson<T>(path: string, body: unknown, runtimeApiKey?: string, signal?: AbortSignal): Promise<AiEnvelope<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: headers(runtimeApiKey),
      body: JSON.stringify(body),
      signal,
      credentials: 'include',
    });
  } catch (err) {
    throw new ArgusApiError(`ARGUS backend unreachable: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new ArgusApiError(`ARGUS backend error ${res.status}`, res.status);
  }
  return (await res.json()) as AiEnvelope<T>;
}

let cachedStatus: AiProviderStatus | null = null;

export async function fetchAiStatus(options: { probe?: boolean; runtimeApiKey?: string } = {}): Promise<AiProviderStatus | null> {
  try {
    const res = await fetch(`${API_BASE}/api/health${options.probe ? '?probe=1' : ''}`, {
      headers: headers(options.runtimeApiKey),
    });
    if (!res.ok) return null;
    cachedStatus = (await res.json()) as AiProviderStatus;
    return cachedStatus;
  } catch {
    return null;
  }
}

/** Last known backend status (null until the first `fetchAiStatus` resolves or if the backend is down). */
export function getCachedAiStatus(): AiProviderStatus | null {
  return cachedStatus;
}

export const argusApi = {
  guidance: (req: GuidanceRequest, key?: string, signal?: AbortSignal) =>
    postJson<FlightSurgeonGuidance>('/api/ai/guidance', req, key, signal),
  vision: (req: VisionRequest, key?: string, signal?: AbortSignal) =>
    postJson<VisualExamAnalysis>('/api/ai/vision', req, key, signal),
  diagnostics: (req: CrewContextRequest, key?: string, signal?: AbortSignal) =>
    postJson<DiagnosticsReport>('/api/ai/diagnostics', req, key, signal),
  recommendations: (req: CrewContextRequest, key?: string, signal?: AbortSignal) =>
    postJson<CountermeasurePlan>('/api/ai/recommendations', req, key, signal),
  wellbeing: (req: WellbeingRequest, key?: string, signal?: AbortSignal) =>
    postJson<WellbeingAssessment>('/api/ai/wellbeing', req, key, signal),
};

/**
 * Streams the crew companion reply. Calls `onEvent` for every SSE event and resolves when done.
 */
export async function streamCrewChat(
  req: ChatRequest,
  onEvent: (event: ChatStreamEvent) => void,
  options: { runtimeApiKey?: string; signal?: AbortSignal } = {}
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/ai/chat`, {
    method: 'POST',
    headers: headers(options.runtimeApiKey),
    body: JSON.stringify(req),
    signal: options.signal,
    credentials: 'include',
  }).catch((err: Error) => {
    throw new ArgusApiError(`ARGUS backend unreachable: ${err.message}`);
  });
  if (!res.ok || !res.body) throw new ArgusApiError(`ARGUS backend error ${res.status}`, res.status);

  const reader = res.body.getReader();
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
      if (data) onEvent(JSON.parse(data) as ChatStreamEvent);
    }
  }
}
