/**
 * ARGUS — Continuous Glucose Monitor (CGM) Mock Data for Crew (Issue #57)
 * Single Source of Truth: specs/01-data-schema.md §3
 *
 * Generates deterministic 5-minute interstitial glucose streams (288 readings / 24h)
 * for each member of DEFAULT_CREW_ROSTER, reflecting spaceflight metabolic profiles,
 * postprandial excursions, ARED exercise dips, and nocturnal baselines.
 *
 * Target glycemic range (70–140 mg/dL) and hypoglycemia (< 70 mg/dL) thresholds:
 * // Source: SRC-072 (ADA Standards of Care 2023 §2)
 * // Source: SRC-073 (ADA Standards of Care 2026 §16)
 */

import { DEFAULT_CREW_ROSTER } from './telemetryScenarios';

export type CgmTrendArrow =
  | 'double_up'
  | 'single_up'
  | 'forty_five_up'
  | 'flat'
  | 'forty_five_down'
  | 'single_down'
  | 'double_down';

export type CgmEventTag = 'sleep' | 'fasting' | 'post_meal' | 'ared_exercise' | 'eva_stress';

export interface CgmReading {
  timestampIso: string;
  missionDay: number;
  minuteOfDay: number;
  glucoseMgDl: number;
  trendArrow: CgmTrendArrow;
  rateOfChangeMgDlPerMin: number;
  eventTag?: CgmEventTag;
}

export interface CrewCgmMockDataset {
  crewId: string;
  callsign: string;
  sensorModel: string;
  sensorSerial: string;
  sampleIntervalMinutes: 5;
  meanGlucoseMgDl: number;
  timeInRangePct: number;
  lowPct: number;
  highPct: number;
  cvPct: number;
  readings: CgmReading[];
}

interface CrewMetabolicProfile {
  sensorSerial: string;
  fastingBaseline: number;
  mealPeakDelta: number;
  exerciseDipDelta: number;
  stressSurgeDelta: number;
  noiseSd: number;
  seed: number;
}

const CREW_METABOLIC_PROFILES: Record<string, CrewMetabolicProfile> = {
  'crew-vance': {
    sensorSerial: 'CGM-ARES-01-VLC',
    fastingBaseline: 88,
    mealPeakDelta: 34,
    exerciseDipDelta: 10,
    stressSurgeDelta: 0,
    noiseSd: 2.2,
    seed: 101,
  },
  'crew-chen': {
    sensorSerial: 'CGM-ARES-02-APX',
    fastingBaseline: 105,
    mealPeakDelta: 46,
    exerciseDipDelta: 8,
    stressSurgeDelta: 6,
    noiseSd: 2.8,
    seed: 202,
  },
  'crew-okafor': {
    sensorSerial: 'CGM-ARES-03-PLS',
    fastingBaseline: 79,
    mealPeakDelta: 30,
    exerciseDipDelta: 15,
    stressSurgeDelta: 0,
    noiseSd: 2.0,
    seed: 303,
  },
  'crew-lindqvist': {
    sensorSerial: 'CGM-ARES-04-SLR',
    fastingBaseline: 99,
    mealPeakDelta: 44,
    exerciseDipDelta: 9,
    stressSurgeDelta: 18,
    noiseSd: 3.1,
    seed: 404,
  },
};

const SAMPLE_INTERVAL_MIN = 5;
const SAMPLES_PER_DAY = (24 * 60) / SAMPLE_INTERVAL_MIN; // 288
const DEFAULT_MISSION_DAY = 30;
const BASE_DATE_UTC = '2026-11-15T00:00:00.000Z';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianPulse(minute: number, center: number, width: number): number {
  const diff = minute - center;
  return Math.exp(-(diff * diff) / (2 * width * width));
}

function classifyTrendArrow(ratePerMin: number): CgmTrendArrow {
  if (ratePerMin >= 3.0) return 'double_up';
  if (ratePerMin >= 2.0) return 'single_up';
  if (ratePerMin >= 1.0) return 'forty_five_up';
  if (ratePerMin <= -3.0) return 'double_down';
  if (ratePerMin <= -2.0) return 'single_down';
  if (ratePerMin <= -1.0) return 'forty_five_down';
  return 'flat';
}

function resolveEventTag(minute: number, hasStress: boolean): CgmEventTag | undefined {
  if (minute < 390 || minute >= 1380) return 'sleep';
  if (minute >= 390 && minute < 440) return 'fasting';
  if (minute >= 600 && minute <= 660) return 'ared_exercise';
  if (hasStress && minute >= 880 && minute <= 1020) return 'eva_stress';
  if (
    (minute >= 450 && minute <= 550) ||
    (minute >= 750 && minute <= 860) ||
    (minute >= 1140 && minute <= 1250)
  ) {
    return 'post_meal';
  }
  return undefined;
}

function buildCrewCgmDataset(
  crewId: string,
  callsign: string,
  profile: CrewMetabolicProfile,
  missionDay = DEFAULT_MISSION_DAY,
): CrewCgmMockDataset {
  const rand = mulberry32(profile.seed);
  const baseMs = Date.parse(BASE_DATE_UTC);
  const rawValues: number[] = [];

  for (let i = 0; i < SAMPLES_PER_DAY; i++) {
    const minute = i * SAMPLE_INTERVAL_MIN;
    const dawnRise = 4 * gaussianPulse(minute, 370, 45);
    const breakfast = profile.mealPeakDelta * gaussianPulse(minute, 485, 38);
    const lunch = profile.mealPeakDelta * 1.08 * gaussianPulse(minute, 785, 42);
    const dinner = profile.mealPeakDelta * 0.95 * gaussianPulse(minute, 1175, 45);
    const aredDip = -profile.exerciseDipDelta * gaussianPulse(minute, 635, 30);
    const stressSurge = profile.stressSurgeDelta * gaussianPulse(minute, 945, 55);

    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    const noise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * profile.noiseSd;

    const glucose = Math.round(
      Math.min(400, Math.max(40, profile.fastingBaseline + dawnRise + breakfast + lunch + dinner + aredDip + stressSurge + noise)),
    );
    rawValues.push(glucose);
  }

  const readings: CgmReading[] = rawValues.map((glucoseMgDl, i) => {
    const minuteOfDay = i * SAMPLE_INTERVAL_MIN;
    const prev = i > 0 ? rawValues[i - 1] : glucoseMgDl;
    const rateOfChangeMgDlPerMin = Math.round(((glucoseMgDl - prev) / SAMPLE_INTERVAL_MIN) * 100) / 100;

    return {
      timestampIso: new Date(baseMs + minuteOfDay * 60_000).toISOString(),
      missionDay,
      minuteOfDay,
      glucoseMgDl,
      trendArrow: classifyTrendArrow(rateOfChangeMgDlPerMin),
      rateOfChangeMgDlPerMin,
      eventTag: resolveEventTag(minuteOfDay, profile.stressSurgeDelta > 10),
    };
  });

  const sum = rawValues.reduce((acc, v) => acc + v, 0);
  const mean = sum / rawValues.length;
  const variance = rawValues.reduce((acc, v) => acc + (v - mean) ** 2, 0) / rawValues.length;
  const sd = Math.sqrt(variance);

  // Source: SRC-072, SRC-073 (70–140 mg/dL target band, < 70 mg/dL hypoglycemia)
  const inRange = rawValues.filter((v) => v >= 70 && v <= 140).length;
  const low = rawValues.filter((v) => v < 70).length;
  const high = rawValues.filter((v) => v > 140).length;

  return {
    crewId,
    callsign,
    sensorModel: 'ARGUS-CGM Patch (5-min interstitial)',
    sensorSerial: profile.sensorSerial,
    sampleIntervalMinutes: 5,
    meanGlucoseMgDl: Math.round(mean * 10) / 10,
    timeInRangePct: Math.round((inRange / rawValues.length) * 1000) / 10,
    lowPct: Math.round((low / rawValues.length) * 1000) / 10,
    highPct: Math.round((high / rawValues.length) * 1000) / 10,
    cvPct: Math.round(((sd / mean) * 100) * 10) / 10,
    readings,
  };
}

export const CREW_CGM_MOCK_DATA: Record<string, CrewCgmMockDataset> = Object.fromEntries(
  DEFAULT_CREW_ROSTER.map((crew) => {
    const profile = CREW_METABOLIC_PROFILES[crew.id] ?? CREW_METABOLIC_PROFILES['crew-vance'];
    return [crew.id, buildCrewCgmDataset(crew.id, crew.callsign, profile)];
  }),
);

/** Returns the 24h 5-minute CGM mock dataset for a crew member (falls back to Commander Vance). */
export function getCrewCgmMockData(crewId: string, scenarioId?: string): CrewCgmMockDataset {
  if (scenarioId === 'unexplained_fatigue') {
    const baseProfile = CREW_METABOLIC_PROFILES[crewId] ?? CREW_METABOLIC_PROFILES['crew-vance'];
    const callsign = DEFAULT_CREW_ROSTER.find((c) => c.id === crewId)?.callsign ?? 'VALKYRIE';
    return buildCrewCgmDataset(crewId, callsign, {
      ...baseProfile,
      fastingBaseline: 118,
      stressSurgeDelta: 12,
    });
  }
  return CREW_CGM_MOCK_DATA[crewId] ?? CREW_CGM_MOCK_DATA['crew-vance'];
}

/** Returns all crew CGM mock datasets in roster order. */
export function getAllCrewCgmMockData(): CrewCgmMockDataset[] {
  return DEFAULT_CREW_ROSTER.map((crew) => getCrewCgmMockData(crew.id));
}
