/**
 * ARGOS — The Thousand Eyes: build a `Person` for the ring from the HUD's real data. No demo values.
 *
 * Each HUD metric history point becomes a check-in on its mission day. A HUD metric feeds the ring
 * when its `metricId` is mapped in METRIC_TO_INDICATOR, or when it already uses the indicator key
 * (e.g. `sbp`, `mood`, `grip` from `indicators.ts`), so new mock/real data only needs matching ids.
 * Indicators with no readings stay grey ("No data").
 */

import type { SpaceLocationId } from '../../types/argus';
import { INDICATOR_BY_KEY } from './indicators';
import { DAY } from './science';
import type { CheckIn, LocationKey, Person, Phase } from './types';

/** HUD location -> prototype location key. */
export const LOCATION_KEY: Record<SpaceLocationId, LocationKey> = {
  earth_pre: 'earth',
  earth_post: 'earth',
  leo: 'leo',
  gateway: 'gate',
  lunar_surface: 'moon',
  mars_transit: 'mtr',
  mars_surface: 'mars',
  rover: 'rov',
};

/** HUD metric ids that differ from the ring's indicator keys (same units). */
export const METRIC_TO_INDICATOR: Readonly<Record<string, string>> = {
  resting_hr: 'rhr',
  hrv_rmssd: 'hrv',
  systolic_bp: 'sbp',
  diastolic_bp: 'dbp',
  spo2: 'spo2',
  sleep_resp_rate: 'resp',
  daily_sleep_hours: 'sleep',
  core_temp: 'temp',
  caloric_intake: 'kcal',
  hydration_intake: 'fluid',
  grip_strength: 'grip',
  rad_dose: 'dose',
};

export function indicatorKeyFor(metricId: string): string | null {
  if (METRIC_TO_INDICATOR[metricId]) return METRIC_TO_INDICATOR[metricId];
  return INDICATOR_BY_KEY[metricId] ? metricId : null;
}

export interface PersonSourceMetric {
  metricId: string;
  history: Array<{ missionDay: number; value: number }>;
}

export interface BuildPersonInput {
  locationId: SpaceLocationId;
  metrics: PersonSourceMetric[];
  now: number;
}

export function buildPerson({ locationId, metrics, now }: BuildPersonInput): Person {
  const env = LOCATION_KEY[locationId];
  const preFlight = locationId === 'earth_pre';
  const back = locationId === 'earth_post';

  const lastDay = Math.max(1, ...metrics.flatMap((m) => m.history.map((h) => h.missionDay)));
  const launch = now - lastDay * DAY;
  const phase: Phase = preFlight ? 'pre' : 'mis';

  const byDay = new Map<number, CheckIn>();
  metrics.forEach((m) => {
    const key = indicatorKeyFor(m.metricId);
    if (!key) return;
    m.history.forEach((h) => {
      if (!Number.isFinite(h.value)) return;
      let c = byDay.get(h.missionDay);
      if (!c) {
        c = { t: launch + (h.missionDay - 0.5) * DAY, phase, env: back ? undefined : env, values: {} };
        byDay.set(h.missionDay, c);
      }
      c.values[key] = h.value;
    });
  });

  const checkIns = [...byDay.values()].sort((a, b) => a.t - b.t);
  return {
    checkIns,
    env,
    created: launch - DAY,
    launch: preFlight ? now + DAY : launch,
  };
}
