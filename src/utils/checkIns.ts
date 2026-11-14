/**
 * ARGUS — Daily Crew Check-In Logic
 * Single Source of Truth: specs/01-data-schema.md §6
 *
 * Ported from the ARGOS prototype daily check-in (chk/chkV/submit/streak).
 * Pure + deterministic: manual readings are overlaid on the synthetic series and
 * flow through the existing triage → readiness → drift pipeline unchanged.
 */

import {
  BodyZoneId,
  CheckInEntry,
  MetricId,
  TelemetryHistoryPoint,
  VitalSignReading,
} from '../types/argus';
import { METRIC_INPUT_RANGES, isMetricId } from './triageEngine';

export const CHECKINS_STORAGE_KEY = 'argus_checkins_v1';

export type CheckInValidation =
  | { ok: true; value: number }
  | { ok: false; error: string }
  | { ok: 'empty' };

/** Rejects non-finite values and values outside METRIC_INPUT_RANGES. Empty input is skipped. */
export function validateCheckInValue(
  metricId: MetricId,
  raw: string | number | null | undefined
): CheckInValidation {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { ok: 'empty' };
  }
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
  const range = METRIC_INPUT_RANGES[metricId];
  if (!Number.isFinite(value)) {
    return { ok: false, error: 'Enter a number' };
  }
  if (value < range.min || value > range.max) {
    return { ok: false, error: `Allowed ${range.min}–${range.max}` };
  }
  return { ok: true, value };
}

export interface CheckInBuildResult {
  entry: CheckInEntry | null;
  errors: Partial<Record<MetricId, string>>;
}

/** Builds an entry from raw form strings; entry is null if any value is invalid or none are filled. */
export function buildCheckInEntry(params: {
  crewId: string;
  missionDay: number;
  rawValues: Partial<Record<MetricId, string>>;
  note?: string;
  now?: Date;
  id?: string;
}): CheckInBuildResult {
  const { crewId, missionDay, rawValues, note } = params;
  const values: Partial<Record<MetricId, number>> = {};
  const errors: Partial<Record<MetricId, string>> = {};
  (Object.keys(rawValues) as MetricId[]).forEach((k) => {
    if (!isMetricId(k)) return;
    const v = validateCheckInValue(k, rawValues[k]);
    if (v.ok === true) values[k] = v.value;
    else if (v.ok === false) errors[k] = v.error;
  });
  if (Object.keys(errors).length || !Object.keys(values).length) {
    return { entry: null, errors };
  }
  const now = params.now ?? new Date();
  return {
    entry: {
      id: params.id ?? `ci-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      crewId,
      missionDay,
      timestampIso: now.toISOString(),
      values,
      note: note?.trim() ? note.trim() : undefined,
    },
    errors,
  };
}

function sortEntries(entries: CheckInEntry[]): CheckInEntry[] {
  return [...entries].sort(
    (a, b) => a.missionDay - b.missionDay || a.timestampIso.localeCompare(b.timestampIso)
  );
}

function overlayReading(reading: VitalSignReading, entries: CheckInEntry[]): VitalSignReading {
  if (!isMetricId(reading.metricId)) return reading;
  const metricId = reading.metricId;
  const relevant = entries.filter((e) => e.values[metricId] !== undefined);
  if (!relevant.length) return reading;
  const byDay = new Map<number, TelemetryHistoryPoint>(
    reading.history.map((p) => [p.missionDay, { ...p }])
  );
  for (const e of relevant) {
    byDay.set(e.missionDay, {
      missionDay: e.missionDay,
      dateLabel: `MD-${e.missionDay}`,
      value: e.values[metricId] as number,
      source: 'check_in',
    });
  }
  const history = [...byDay.values()].sort((a, b) => a.missionDay - b.missionDay);
  return { ...reading, history, currentValue: history[history.length - 1].value };
}

/** Overlays check-in values onto zone telemetry (replace same day, append beyond series). */
export function applyCheckIns(
  zones: Record<BodyZoneId, VitalSignReading[]>,
  entries: CheckInEntry[]
): Record<BodyZoneId, VitalSignReading[]> {
  if (!entries.length) return zones;
  const sorted = sortEntries(entries);
  const out = {} as Record<BodyZoneId, VitalSignReading[]>;
  (Object.keys(zones) as BodyZoneId[]).forEach((z) => {
    out[z] = zones[z].map((r) => overlayReading(r, sorted));
  });
  return out;
}

/** Highest mission day present in any metric history. */
export function latestMissionDay(zones: Record<BodyZoneId, VitalSignReading[]>): number {
  let max = 0;
  Object.values(zones)
    .flat()
    .forEach((r) => r.history.forEach((p) => (max = Math.max(max, p.missionDay))));
  return max;
}

/** Consecutive mission days with ≥ 1 entry, ending at the most recent logged day. */
export function checkInStreak(entries: CheckInEntry[]): number {
  if (!entries.length) return 0;
  const days = new Set(entries.map((e) => e.missionDay));
  let day = Math.max(...days);
  let n = 0;
  while (days.has(day)) {
    n++;
    day--;
  }
  return n;
}

export function lastLoggedDay(entries: CheckInEntry[]): number | null {
  return entries.length ? Math.max(...entries.map((e) => e.missionDay)) : null;
}
