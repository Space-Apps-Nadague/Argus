/**
 * ARGUS data-platform client (specs/05-data-platform.md §8). Session cookie auth; same origin via the Vite proxy.
 */

import type { CrewChatMessage, WellbeingCheckIn } from '../types/aiApi';
import type { BodyZoneId, CrewMemberProfile, UserAccount, UserRole, VitalSignReading } from '../types/argus';
import { API_BASE } from './argusApi';

export class DataApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'DataApiError';
  }
}

export async function apiJson<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'include',
      signal: init.signal,
    });
  } catch (err) {
    throw new DataApiError(`ARGUS server unreachable: ${(err as Error).message}`);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new DataApiError(data.error ?? `ARGUS server error ${res.status}`, res.status);
  return data as T;
}

export interface MeResponse {
  mode: 'server';
  user: UserAccount | null;
  setupNeeded: boolean;
  minPasswordLength: number;
}

/** `null` = no database on the server (or server unreachable): run in offline demo mode. */
export async function fetchMe(): Promise<MeResponse | null> {
  try {
    return await apiJson<MeResponse>('/api/auth/me');
  } catch (err) {
    if (err instanceof DataApiError && err.status !== undefined && err.status !== 503 && err.status !== 404 && err.status < 500) throw err;
    return null;
  }
}

export const authApi = {
  setup: (username: string, password: string) => apiJson<{ user: UserAccount }>('/api/auth/setup', { body: { username, password } }),
  login: (username: string, password: string) => apiJson<{ user: UserAccount }>('/api/auth/login', { body: { username, password } }),
  logout: () => apiJson<{ ok: true }>('/api/auth/logout', { body: {} }),
  /** Face ID: issues a device sign-in token for the signed-in user (only its hash is stored). */
  faceEnroll: () => apiJson<{ token: string }>('/api/auth/face/enroll', { body: {} }),
  faceLogin: (token: string) => apiJson<{ user: UserAccount }>('/api/auth/face/login', { body: { token } }),
  faceRemove: (token: string) => apiJson<{ ok: true }>('/api/auth/face/remove', { body: { token } }),
};

export const adminApi = {
  listUsers: () => apiJson<{ users: UserAccount[] }>('/api/admin/users'),
  createUser: (input: { username: string; password: string; role: UserRole; crewId?: string }) =>
    apiJson<{ user: UserAccount }>('/api/admin/users', { body: input }),
  updateUser: (id: string, patch: { password?: string; disabled?: boolean; crewId?: string | null }) =>
    apiJson<{ user: UserAccount }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  deleteUser: (id: string) => apiJson<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const crewApi = {
  list: () => apiJson<{ crew: CrewMemberProfile[] }>('/api/astronauts'),
  create: (profile: Omit<CrewMemberProfile, 'id' | 'missionDaysLogged' | 'isCustom'>) =>
    apiJson<{ crewMember: CrewMemberProfile }>('/api/astronauts', { body: profile }),
  update: (id: string, patch: { sex?: CrewMemberProfile['sex']; aiConsent?: boolean; medicalNotes?: string }) =>
    apiJson<{ crewMember: CrewMemberProfile }>(`/api/astronauts/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  archive: (id: string) => apiJson<{ ok: true }>(`/api/astronauts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const chatHistoryApi = {
  latest: (crewId: string) =>
    apiJson<{ conversationId: string | null; messages: CrewChatMessage[] }>(`/api/astronauts/${encodeURIComponent(crewId)}/conversations/latest`),
  startNew: (crewId: string) =>
    apiJson<{ conversationId: string }>(`/api/astronauts/${encodeURIComponent(crewId)}/conversations`, { body: {} }),
};

export interface AnalyticsResponse {
  computedAt: string | null;
  current: Array<{
    metricId: string;
    day: string;
    value: number;
    /** Measured on Earth before launch (falls back to early flight when no Earth data). */
    preflight: { mean: number; sd: number; n: number; windowStart: string; windowEnd: string } | null;
    earlyFlight: { mean: number; sd: number; n: number } | null;
    normal: { median: number; p05: number; p95: number; mean: number; n: number } | null;
    zVsPreflight: number | null;
  }>;
  circadian: Array<{ metricId: string; hour: number; median: number; p05: number; p95: number; n: number }>;
  anomalies: Array<{ metricId: string; detector: 'robust_z' | 'ewma' | 'cusum'; severity: 'watch' | 'drifting'; score: number; tsStart: string; tsEnd: string; detail: unknown }>;
}

export const dataApi = {
  zones: (crewId: string) =>
    apiJson<{ zones: Record<BodyZoneId, VitalSignReading[]>; hasData: boolean; missionDay: number }>(
      `/api/astronauts/${encodeURIComponent(crewId)}/zones`
    ),
  analytics: (crewId: string) => apiJson<AnalyticsResponse>(`/api/astronauts/${encodeURIComponent(crewId)}/analytics`),
  checkIn: (crewId: string, values: Record<string, number>, note?: string) =>
    apiJson(`/api/astronauts/${encodeURIComponent(crewId)}/check-ins`, { body: { values, note } }),
};

export const wellbeingApi = {
  list: (crewId: string) => apiJson<{ checkIns: WellbeingCheckIn[] }>(`/api/astronauts/${encodeURIComponent(crewId)}/wellbeing`),
  add: (crewId: string, scales: Omit<WellbeingCheckIn, 'id' | 'crewId' | 'missionDay' | 'timestampIso'>) =>
    apiJson<{ id: string }>(`/api/astronauts/${encodeURIComponent(crewId)}/wellbeing`, { body: scales }),
};

/** Photobooth family email (server/routes/family.ts). */
export interface FamilyMailStatus {
  id: string;
  status: 'scheduled' | 'sent' | 'failed';
  sendAtIso: string;
  mode?: 'smtp' | 'test';
  previewUrl?: string;
  error?: string;
}

export const familyApi = {
  send: (body: {
    id: string;
    crewId: string;
    callsign: string;
    place: string;
    to: { name: string; email: string }[];
    message: string;
    image: string;
    delaySeconds: number;
  }) => apiJson<FamilyMailStatus>('/api/family/mail', { body }),
  status: (id: string) => apiJson<FamilyMailStatus>(`/api/family/mail/${encodeURIComponent(id)}`),
};
