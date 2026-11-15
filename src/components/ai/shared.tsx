/**
 * ARGUS AI tab helpers: request context, per-crew local storage, result badges.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, Cpu, WifiOff } from 'lucide-react';
import { useMission } from '../../context/MissionContext';
import type { AiProviderStatus, AiResultMeta, CrewContextRequest } from '../../types/aiApi';
import { fetchAiStatus } from '../../services/argusApi';
import { wellbeingApi } from '../../services/dataApi';
import type { WellbeingCheckIn } from '../../types/aiApi';

/** Crew context sent with every AI request. */
export function useCrewContextRequest(): CrewContextRequest {
  const { activeCrewMember, scenarioId, environment, spaceLocationId, scenarioCheckIns } = useMission();
  return {
    crewMember: activeCrewMember,
    scenarioId,
    environment,
    locationId: spaceLocationId,
    telemetryCheckIns: scenarioCheckIns,
  };
}

/** `Record<crewId, T[]>` persisted in localStorage, scoped to the active crew member. */
export function usePerCrewList<T>(storageKey: string, crewId: string, max = 50): [T[], (update: (prev: T[]) => T[]) => void] {
  const read = useCallback((): Record<string, T[]> => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }, [storageKey]);

  const [items, setItems] = useState<T[]>(() => read()[crewId] ?? []);
  useEffect(() => {
    setItems(read()[crewId] ?? []);
  }, [crewId, read]);

  const update = useCallback(
    (fn: (prev: T[]) => T[]) => {
      setItems((prev) => {
        const next = fn(prev).slice(-max);
        try {
          const all = read();
          all[crewId] = next;
          localStorage.setItem(storageKey, JSON.stringify(all));
        } catch {
          // storage unavailable: keep in memory
        }
        return next;
      });
    },
    [crewId, max, read, storageKey]
  );

  return [items, update];
}

export function useAiStatus(runtimeApiKey?: string): { status: AiProviderStatus | null; checked: boolean; refresh: () => void } {
  const [status, setStatus] = useState<AiProviderStatus | null>(null);
  const [checked, setChecked] = useState(false);
  const refresh = useCallback(() => {
    fetchAiStatus({ runtimeApiKey }).then((s) => {
      setStatus(s);
      setChecked(true);
    });
  }, [runtimeApiKey]);
  useEffect(refresh, [refresh]);
  return { status, checked, refresh };
}

export const ProviderBadge: React.FC<{ status: AiProviderStatus | null; checked: boolean }> = ({ status, checked }) => {
  const first = status?.chain[0];
  if (!checked) return <span className="text-xs text-hud-muted">Checking AI…</span>;
  if (!status || !first) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-hud-line px-2.5 py-1 text-xs text-hud-muted" title={status ? 'No AI provider configured' : 'AI backend not running'}>
        <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
        Offline protocols
      </span>
    );
  }
  const Icon = first.isLocal ? Cpu : Cloud;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-status-green/40 bg-status-green/10 px-2.5 py-1 text-xs text-status-green"
      title={status.chain.map((p) => `${p.label} (${p.model})`).join(' → ') + ' → offline'}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {first.isLocal ? 'Local' : first.label} · {first.model}
    </span>
  );
};

export const SourceTag: React.FC<{ meta?: AiResultMeta | null }> = ({ meta }) => {
  if (!meta) return null;
  const live = meta.source === 'live_ai';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${live ? 'border-hud-accent/40 text-hud-accent' : 'border-hud-line text-hud-muted'}`}>
      {live ? `Live AI · ${meta.model}${meta.latencyMs ? ` · ${(meta.latencyMs / 1000).toFixed(1)}s` : ''}` : 'Offline protocol'}
    </span>
  );
};

export const ErrorNote: React.FC<{ error: string | null }> = ({ error }) =>
  error ? (
    <p role="alert" className="rounded-lg border border-status-red/40 bg-status-red/10 px-3 py-2 text-xs text-status-red">
      {error}
    </p>
  ) : null;

export const errorText = (err: unknown) =>
  err instanceof Error && /unreachable/i.test(err.message)
    ? 'The AI backend is not running. Start it with `npm run dev:all` (or `npm run dev:local`).'
    : 'The AI request failed. Try again.';

export const WELLBEING_STORAGE_KEY = 'argus_wellbeing_v1';

/**
 * Wellbeing check-in history for the active crew member. Server mode: `wellbeing_check_ins` table
 * (specs/05-data-platform.md §3.4); offline demo: this browser.
 */
export function useWellbeingHistory(crewId: string): [WellbeingCheckIn[], (entry: WellbeingCheckIn) => Promise<WellbeingCheckIn[]>] {
  const { serverBacked, canReadActiveCrew } = useMission();
  const [local, setLocal] = usePerCrewList<WellbeingCheckIn>(WELLBEING_STORAGE_KEY, crewId, 60);
  const [remote, setRemote] = useState<WellbeingCheckIn[]>([]);

  useEffect(() => {
    if (!serverBacked || !canReadActiveCrew) return;
    let alive = true;
    setRemote([]);
    wellbeingApi
      .list(crewId)
      .then((r) => alive && setRemote(r.checkIns))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [serverBacked, canReadActiveCrew, crewId]);

  const add = useCallback(
    async (entry: WellbeingCheckIn) => {
      if (serverBacked) {
        const { id: _id, crewId: _c, missionDay: _d, timestampIso: _t, ...scales } = entry;
        await wellbeingApi.add(crewId, scales);
        const { checkIns } = await wellbeingApi.list(crewId);
        setRemote(checkIns);
        return checkIns;
      }
      const next = [...local.filter((c) => c.missionDay !== entry.missionDay), entry];
      setLocal(() => next);
      return next;
    },
    [serverBacked, crewId, setLocal, local]
  );

  return [serverBacked ? remote : local, add];
}

