/**
 * ARGUS — Cognition session store (specs/01-data-schema.md §12.5).
 * Local-first (localStorage), like check-ins in offline mode. No demo data is generated here:
 * the team loads its own mock sessions through `importCognitionSessions`.
 */
import { useCallback, useEffect, useState } from 'react';
import type { CognitionSession } from './types';

export const COGNITION_STORAGE_KEY = 'argus.cognition.sessions.v1';

type ByCrew = Record<string, CognitionSession[]>;

function load(): ByCrew {
  try {
    const raw = localStorage.getItem(COGNITION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as ByCrew) : {};
  } catch {
    return {};
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
