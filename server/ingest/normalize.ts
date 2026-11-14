/**
 * Silver-layer normalization (specs/05-data-platform.md §5.3): plausibility and artifact flags.
 * Pure function; raw data is kept untouched in `raw_readings`.
 */

import { METRIC_BY_ID } from '../db/catalog';

export interface IncomingReading {
  metric: string;
  ts: string | Date;
  value: number;
}

export interface NormalizedReading {
  metricId: string;
  ts: Date;
  value: number;
  quality: 'ok' | 'artifact' | 'out_of_range';
}

/** Metrics where a > 40% jump from the previous minute is treated as a motion/contact artifact. */
export const ARTIFACT_METRICS = new Set(['heart_rate', 'spo2']);
export const ARTIFACT_JUMP = 0.4;

export function normalizeReadings(readings: IncomingReading[]): { rows: NormalizedReading[]; unknown: string[] } {
  const unknown = new Set<string>();
  const rows: NormalizedReading[] = [];
  const sorted = [...readings].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const prev = new Map<string, { ts: number; value: number }>();
  for (const r of sorted) {
    const def = METRIC_BY_ID.get(r.metric);
    const ts = new Date(r.ts);
    if (!def || !Number.isFinite(r.value) || Number.isNaN(ts.getTime())) {
      unknown.add(r.metric);
      continue;
    }
    let quality: NormalizedReading['quality'] = 'ok';
    if (r.value < def.plausibleMin || r.value > def.plausibleMax) quality = 'out_of_range';
    else if (ARTIFACT_METRICS.has(r.metric)) {
      const p = prev.get(r.metric);
      if (p && ts.getTime() - p.ts <= 120_000 && p.value > 0 && Math.abs(r.value - p.value) / p.value > ARTIFACT_JUMP) {
        quality = 'artifact';
      }
    }
    if (quality === 'ok') prev.set(r.metric, { ts: ts.getTime(), value: r.value });
    rows.push({ metricId: r.metric, ts, value: r.value, quality });
  }
  return { rows, unknown: [...unknown] };
}
