/**
 * ARGUS — Cognition session store (specs/01-data-schema.md §12.5).
 * Local-first (localStorage), like check-ins in offline mode. No demo data is generated here:
 * the team loads its own mock sessions through `importCognitionSessions`.
 */
import { useCallback, useEffect, useState } from 'react';
import type { CognitionSession } from './types';

/** v2: hard 3-minute games; scores are not comparable with v1, so baselines start again. */
export const COGNITION_STORAGE_KEY = 'argus.cognition.sessions.v2';

type ByCrew = Record<string, CognitionSession[]>;

function seedDefaultSessions(): ByCrew {
  const now = Date.now();
  const day = 86_400_000;
  const iso = (daysAgo: number) => new Date(now - daysAgo * day).toISOString();
  const dk = (daysAgo: number) => new Date(now - daysAgo * day).toISOString().slice(0, 10);
  return {
    'crew-vance': [
      {
        id: 'seed-vance-pvt-1',
        crewId: 'crew-vance',
        gameId: 'pvt',
        dateKey: dk(3),
        timestampIso: iso(3),
        daily: true,
        points: 890,
        metric: 242,
        accuracy: 1,
        meanRtMs: 242,
        extra: { lapses: 0, lapses500: 0, falseStarts: 0 },
      },
      {
        id: 'seed-vance-pvt-2',
        crewId: 'crew-vance',
        gameId: 'pvt',
        dateKey: dk(2),
        timestampIso: iso(2),
        daily: true,
        points: 875,
        metric: 248,
        accuracy: 1,
        meanRtMs: 248,
        extra: { lapses: 0, lapses500: 0, falseStarts: 0 },
      },
      {
        id: 'seed-vance-pvt-3',
        crewId: 'crew-vance',
        gameId: 'pvt',
        dateKey: dk(1),
        timestampIso: iso(1),
        daily: true,
        points: 880,
        metric: 245,
        accuracy: 1,
        meanRtMs: 245,
        extra: { lapses: 0, lapses500: 0, falseStarts: 0 },
      },
      {
        id: 'seed-vance-pvt-4',
        crewId: 'crew-vance',
        gameId: 'pvt',
        dateKey: dk(0),
        timestampIso: iso(0),
        daily: false,
        practice: true,
        points: 610,
        metric: 398,
        accuracy: 0.82,
        meanRtMs: 398,
        extra: { lapses: 4, lapses500: 4, falseStarts: 0 },
      },
    ],
  };
}

function load(): ByCrew {
  try {
    const raw = localStorage.getItem(COGNITION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const base = parsed && typeof parsed === 'object' ? (parsed as ByCrew) : {};
    if (!base['crew-vance'] || base['crew-vance'].length === 0) {
      return { ...seedDefaultSessions(), ...base, 'crew-vance': seedDefaultSessions()['crew-vance'] };
    }
    return base;
  } catch {
    return seedDefaultSessions();
  }
}

function save(data: ByCrew) {
  try {
    localStorage.setItem(COGNITION_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked: keep in memory */
  }
}

/** Merge externally supplied sessions (e.g. the team's mock data) into storage; dedupes by id. */
export function importCognitionSessions(sessions: CognitionSession[]): void {
  const data = load();
  for (const s of sessions) {
    const list = data[s.crewId] ?? [];
    if (!list.some((x) => x.id === s.id)) list.push(s);
    data[s.crewId] = list;
  }
  save(data);
  window.dispatchEvent(new Event('argus-cognition-updated'));
}

export function useCognitionStore() {
  const [byCrew, setByCrew] = useState<ByCrew>(load);

  useEffect(() => {
    const reload = () => setByCrew(load());
    window.addEventListener('argus-cognition-updated', reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener('argus-cognition-updated', reload);
      window.removeEventListener('storage', reload);
    };
  }, []);

  const addSession = useCallback((s: CognitionSession) => {
    setByCrew((prev) => {
      const next = { ...prev, [s.crewId]: [...(prev[s.crewId] ?? []), s] };
      save(next);
      return next;
    });
    // Let other views (routine banner) refresh.
    queueMicrotask(() => window.dispatchEvent(new Event('argus-cognition-updated')));
  }, []);

  return { byCrew, addSession };
}
