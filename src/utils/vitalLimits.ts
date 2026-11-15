/**
 * ARGUS — Physiological limits & life-threat detection
 * Single Source of Truth: specs/01-data-schema.md §2 ("Check-In Input Ranges" and `LIFE_THREAT_LIMITS`)
 *
 * Two different questions:
 *  1. Is the value physically possible for a living person? `METRIC_INPUT_RANGES` holds the
 *     survivable extremes. A value outside them (e.g. 50 °C body temperature) is a typo or a
 *     sensor fault and never reaches triage, charts or the AI.
 *  2. Is a possible value immediately dangerous to life? `LIFE_THREAT_LIMITS` below.
 *     These values are rare but real (e.g. 42 °C in heat stroke) and raise the full-screen alarm.
 */

import { BodyZoneId, MetricId, VitalSignReading } from '../types/argus';
import { METRIC_INPUT_RANGES, isMetricId } from './triageEngine';

export interface LifeThreatLimit {
  /** At or below this value the reading is immediately dangerous to life. */
  low?: number;
  /** At or above this value the reading is immediately dangerous to life. */
  high?: number;
  /** What the crew should do now, in plain words. */
  action: string;
}

/**
 * Acute, life-threatening cut-offs. Only metrics that can kill within hours are listed;
 * slow metrics (bone density, sleep, mood) stay with normal red triage.
 * Clinical anchors: heat stroke ≥ 40 °C, moderate hypothermia < 32 °C; severe hypoxaemia
 * SpO₂ ≤ 85 %; hypertensive crisis ≥ 180 mmHg, shock ≤ 80 mmHg; ADA level 2 hypoglycaemia
 * < 54 mg/dL; NIOSH CO₂ IDLH 40,000 ppm ≈ 30 mmHg; CDC acute radiation syndrome > 0.7 Gy.
 */
export const LIFE_THREAT_LIMITS: Partial<Record<MetricId, LifeThreatLimit>> = {
  core_temp: { low: 32.0, high: 40.0, action: 'Stop all work. Start active cooling (or warming) and call the crew medical officer now.' },
  spo2: { low: 85, action: 'Put on supplemental oxygen now, check the cabin O₂ and CO₂, and call the crew medical officer.' },
  resting_hr: { low: 40, high: 150, action: 'Lie down, recheck the pulse by hand for 30 s and call the crew medical officer now.' },
  systolic_bp: { low: 80, high: 180, action: 'Lie down, recheck with a cuff and call the crew medical officer now.' },
  blood_glucose: { low: 54, high: 400, action: 'Low: take 15 g fast sugar now and recheck in 15 min. High: recheck and call the crew medical officer.' },
  cabin_co2: { high: 30, action: 'Put on an oxygen mask, leave the module and start emergency CO₂ scrubbing now.' },
  rad_dose: { high: 700, action: 'Go to the storm shelter now and report the dosimeter reading to the flight surgeon.' },
};

export type ReadingClass = 'impossible' | 'life_threat' | 'ok';

/** Classifies one value: physically impossible, immediately dangerous, or neither. */
export function classifyReading(metricId: string, value: number): ReadingClass {
  if (!isMetricId(metricId)) return 'ok';
  const range = METRIC_INPUT_RANGES[metricId];
  if (!Number.isFinite(value) || value < range.min || value > range.max) return 'impossible';
  const lim = LIFE_THREAT_LIMITS[metricId];
  if (lim && ((lim.low !== undefined && value <= lim.low) || (lim.high !== undefined && value >= lim.high))) {
    return 'life_threat';
  }
  return 'ok';
}

export interface LifeThreat {
  zoneId: BodyZoneId;
  metricId: MetricId;
  label: string;
  unit: string;
  value: number;
  direction: 'low' | 'high';
  limit: number;
  action: string;
  /** Stable id: a new value for the same metric is a new alarm. */
  key: string;
}

/**
 * Drops physically impossible points from every series. `currentValue` becomes the latest
 * possible point; a reading with no possible point left is removed.
 */
export function sanitizeZones(
  zones: Record<BodyZoneId, VitalSignReading[]>
): Record<BodyZoneId, VitalSignReading[]> {
  const out = {} as Record<BodyZoneId, VitalSignReading[]>;
  for (const zoneId of Object.keys(zones) as BodyZoneId[]) {
    out[zoneId] = [];
    for (const reading of zones[zoneId]) {
      const ok = (v: number) => classifyReading(reading.metricId, v) !== 'impossible';
      const history = reading.history.filter((p) => ok(p.value));
      if (history.length === reading.history.length && ok(reading.currentValue)) {
        out[zoneId].push(reading);
        continue;
      }
      const currentValue = ok(reading.currentValue)
        ? reading.currentValue
        : history.length
          ? history[history.length - 1].value
          : NaN;
      if (Number.isNaN(currentValue)) continue;
      out[zoneId].push({ ...reading, history, currentValue });
    }
  }
  return out;
}

/** Latest readings that are possible but immediately dangerous to life. */
export function findLifeThreats(zones: Record<BodyZoneId, VitalSignReading[]>, crewId = ''): LifeThreat[] {
  const threats: LifeThreat[] = [];
  for (const zoneId of Object.keys(zones) as BodyZoneId[]) {
    for (const r of zones[zoneId]) {
      if (!isMetricId(r.metricId) || classifyReading(r.metricId, r.currentValue) !== 'life_threat') continue;
      const lim = LIFE_THREAT_LIMITS[r.metricId]!;
      const direction: 'low' | 'high' = lim.low !== undefined && r.currentValue <= lim.low ? 'low' : 'high';
      threats.push({
        zoneId,
        metricId: r.metricId,
        label: r.label,
        unit: r.unit,
        value: r.currentValue,
        direction,
        limit: direction === 'low' ? lim.low! : lim.high!,
        action: lim.action,
        key: `${crewId}|${r.metricId}|${r.currentValue}`,
      });
    }
  }
  return threats;
}
