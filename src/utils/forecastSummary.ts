/**
 * ARGUS — Readable 3-day forecast summary (specs/02-ui-dashboard.md §2.3)
 * Pure and deterministic: built on `forecastMetric` (driftAnalytics) and the triage engine.
 */

import type { BodyZoneId, GravityEnvironment, TriageStatus, VitalSignReading } from '../types/argus';
import { forecastMetric } from './driftAnalytics';
import { calculateCrewReadinessScore, evaluateMetricStatus, getMetricThreshold } from './triageEngine';

export type ForecastDirection = 'worse' | 'steady' | 'better';

export interface MetricForecastRow {
  metricId: string;
  label: string;
  unit: string;
  zoneId: BodyZoneId;
  today: number;
  /** Mean projection for +1, +2, +3 days (null when there isn't enough history). */
  projected: Array<number | null>;
  /** 90% interval for +3 days. */
  lower: number | null;
  upper: number | null;
  statusToday: TriageStatus;
  statusDay3: TriageStatus;
  direction: ForecastDirection;
}

export interface ForecastSummary {
  rows: MetricForecastRow[];
  /** Readiness score for today, +1, +2, +3 days. */
  readiness: number[];
}

const SEVERITY: Record<TriageStatus, number> = { green: 0, yellow: 1, red: 2 };

/** How far a value sits outside the nominal band, in band widths (0 inside the band). */
export function nominalDistance(metricId: string, value: number, environment?: GravityEnvironment): number {
  const t = getMetricThreshold(metricId, environment);
  const width = Math.max(t.nominalMax - t.nominalMin, 1e-6);
  if (value < t.nominalMin) return (t.nominalMin - value) / width;
  if (value > t.nominalMax) return (value - t.nominalMax) / width;
  return 0;
}

export function forecastDirection(
  metricId: string,
  today: number,
  day3: number | null,
  environment?: GravityEnvironment
): ForecastDirection {
  if (day3 === null) return 'steady';
  const s0 = evaluateMetricStatus(metricId, today, environment ?? '0g_transit');
  const s3 = evaluateMetricStatus(metricId, day3, environment ?? '0g_transit');
  if (SEVERITY[s3] > SEVERITY[s0]) return 'worse';
  if (SEVERITY[s3] < SEVERITY[s0]) return 'better';
  const delta = nominalDistance(metricId, day3, environment) - nominalDistance(metricId, today, environment);
  if (delta > 0.05) return 'worse';
  if (delta < -0.05) return 'better';
  return 'steady';
}

const round = (v: number) => Math.round(v * 100) / 100;

export function buildForecastSummary(
  zones: Record<BodyZoneId, VitalSignReading[]>,
  environment: GravityEnvironment
): ForecastSummary {
  const rows: MetricForecastRow[] = [];
  const projectedZones: Array<Record<BodyZoneId, VitalSignReading[]>> = [1, 2, 3].map(
    () => ({ neuro: [], cardio: [], musculo: [], metabolic: [], immune: [], behavioral: [] })
  );

  (Object.keys(zones) as BodyZoneId[]).forEach((zoneId) => {
    zones[zoneId].forEach((reading) => {
      const fc = forecastMetric(reading.metricId, reading.history);
      const projected = [0, 1, 2].map((i) => (fc?.[i] ? round(fc[i].mean) : null));
      const day3 = projected[2];
      rows.push({
        metricId: reading.metricId,
        label: reading.label,
        unit: reading.unit,
        zoneId,
        today: reading.currentValue,
        projected,
        lower: fc?.[2] ? round(fc[2].lower) : null,
        upper: fc?.[2] ? round(fc[2].upper) : null,
        statusToday: evaluateMetricStatus(reading.metricId, reading.currentValue, environment),
        statusDay3: evaluateMetricStatus(reading.metricId, day3 ?? reading.currentValue, environment),
        direction: forecastDirection(reading.metricId, reading.currentValue, day3, environment),
      });
      projected.forEach((value, i) => {
        projectedZones[i][zoneId].push({ ...reading, currentValue: value ?? reading.currentValue });
      });
    });
  });

  const order: Record<ForecastDirection, number> = { worse: 0, steady: 1, better: 2 };
  rows.sort(
    (a, b) =>
      order[a.direction] - order[b.direction] ||
      SEVERITY[b.statusDay3] - SEVERITY[a.statusDay3] ||
      nominalDistance(b.metricId, b.projected[2] ?? b.today) - nominalDistance(a.metricId, a.projected[2] ?? a.today)
  );

  return {
    rows,
    readiness: [
      calculateCrewReadinessScore(zones, environment),
      ...projectedZones.map((z) => calculateCrewReadinessScore(z, environment)),
    ],
  };
}

/** Compact number formatting for the forecast sentences. */
export function formatValue(v: number, unit: string): string {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}
