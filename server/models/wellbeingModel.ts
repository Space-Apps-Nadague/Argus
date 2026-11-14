/**
 * Deterministic behavioral-health (mental wellbeing) risk model and crisis-language detector
 * (specs/03-ai-backend.md §5). The LLM never sets the score, status or crisis flag.
 */

import type { BodyZoneId, TriageStatus, VitalSignReading } from '../../src/types/argus';
import type {
  EarthConsultUrgency,
  WellbeingCheckIn,
  WellbeingFactor,
  WellbeingTrend,
} from '../../src/types/aiApi';
import { evaluateMetricStatus, DEFAULT_ENVIRONMENT } from '../../src/utils/triageEngine';
import { linearRegression } from './trendModels';

// ── Crisis-language detection ────────────────────────────────────────────────

const CRISIS_PATTERNS: RegExp[] = [
  /\bsuicid/i,
  /\bkill(ing)?\s+my\s?self\b/i,
  /\bend(ing)?\s+(it\s+all|my\s+life)\b/i,
  /\b(hurt|harm|cut)(ing)?\s+my\s?self\b/i,
  /\bself[-\s]?harm/i,
  /\b(want|wish)(ed)?\s+(to\s+)?(die|be\s+dead)\b/i,
  /\bbetter\s+off\s+dead\b/i,
  /\bno\s+(reason|point)\s+(to|in)\s+(live|living|going\s+on)\b/i,
  /\bcan'?t\s+go\s+on\b/i,
  /\bdon'?t\s+want\s+to\s+(live|be\s+alive|wake\s+up)\b/i,
  // Hebrew (crew notes / chat may be bilingual)
  /להתאבד/,
  /התאבדות/,
  /לפגוע\s*בעצמי/,
  /רוצה\s*למות/,
  /אין\s*טעם\s*לחיות/,
];

export interface CrisisResult {
  crisis: boolean;
  matched: string[];
}

export function detectCrisisLanguage(...texts: Array<string | undefined>): CrisisResult {
  const matched: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const p of CRISIS_PATTERNS) {
      const m = text.match(p);
      if (m) matched.push(m[0]);
    }
  }
  return { crisis: matched.length > 0, matched };
}

export const CRISIS_ESCALATION_MESSAGE =
  'What you wrote matters, and you are not alone with it. Please tell your Crew Medical Officer or Commander right now, ' +
  'and request a private medical conference (PMC) with the Flight Surgeon and the behavioral health team — ARGUS has ' +
  'marked this as an immediate priority. Until then, stay with a crewmate and keep talking to me if it helps.';

// ── Risk score ───────────────────────────────────────────────────────────────

type Scale = 'mood' | 'stress' | 'energy' | 'sleepQuality' | 'motivation' | 'cohesion';

export const SCALE_WEIGHTS: Record<Scale, number> = {
  mood: 25,
  stress: 20,
  sleepQuality: 15,
  energy: 15,
  motivation: 15,
  cohesion: 10,
};

const SCALE_LABELS: Record<Scale, string> = {
  mood: 'Low mood',
  stress: 'High stress',
  sleepQuality: 'Poor sleep quality',
  energy: 'Low energy',
  motivation: 'Low motivation',
  cohesion: 'Low team cohesion',
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 0 (best) … 1 (worst) for a 1–5 scale; stress is the only scale where 5 is worst. */
export function badness(scale: Scale, value: number): number {
  const v = clamp(value, 1, 5);
  return scale === 'stress' ? (v - 1) / 4 : (5 - v) / 4;
}

function compositeBadness(c: WellbeingCheckIn): number {
  const total = Object.values(SCALE_WEIGHTS).reduce((a, b) => a + b, 0);
  return (Object.keys(SCALE_WEIGHTS) as Scale[]).reduce(
    (sum, s) => sum + badness(s, c[s]) * SCALE_WEIGHTS[s],
    0
  ) / total;
}

export interface WellbeingModelResult {
  riskScore: number;
  status: TriageStatus;
  trend: WellbeingTrend;
  factors: WellbeingFactor[];
  crisisFlag: boolean;
  crisisMatches: string[];
  earthConsultUrgency: EarthConsultUrgency;
}

export function statusFromRisk(score: number): TriageStatus {
  if (score >= 60) return 'red';
  if (score >= 35) return 'yellow';
  return 'green';
}

export function computeWellbeing(
  checkIns: WellbeingCheckIn[],
  zones?: Record<BodyZoneId, VitalSignReading[]>,
  extraTexts: string[] = []
): WellbeingModelResult {
  const sorted = [...checkIns].sort((a, b) => a.missionDay - b.missionDay);
  const recent = sorted.slice(-3);
  const factors: WellbeingFactor[] = [];
  let score = 0;

  // Self-report (up to 70 pts)
  if (recent.length) {
    for (const s of Object.keys(SCALE_WEIGHTS) as Scale[]) {
      const avg = recent.reduce((sum, c) => sum + c[s], 0) / recent.length;
      const pts = badness(s, avg) * SCALE_WEIGHTS[s] * 0.7;
      score += pts;
      if (badness(s, avg) >= 0.5) {
        factors.push({
          id: s,
          label: SCALE_LABELS[s],
          impact: Math.round(pts),
          detail: `3-day average ${avg.toFixed(1)}/5`,
        });
      }
    }
  }

  // Trend over the last 7 check-ins (up to +10)
  let trend: WellbeingTrend = 'stable';
  const window = sorted.slice(-7);
  const fit = linearRegression(
    window.map((c) => c.missionDay),
    window.map(compositeBadness)
  );
  if (fit) {
    if (fit.slope > 0.02) trend = 'worsening';
    else if (fit.slope < -0.02) trend = 'improving';
    if (trend === 'worsening') {
      const pts = clamp(fit.slope * 200, 0, 10);
      score += pts;
      factors.push({
        id: 'trend',
        label: 'Worsening week',
        impact: Math.round(pts),
        detail: 'Self-reported wellbeing has declined over recent check-ins',
      });
    }
  }

  // Objective behavioral telemetry (up to +20)
  if (zones?.behavioral) {
    for (const r of zones.behavioral) {
      if (r.metricId !== 'sleep_eff' && r.metricId !== 'pvt_lapses') continue;
      const st = evaluateMetricStatus(r.metricId, r.currentValue, DEFAULT_ENVIRONMENT);
      const pts = st === 'red' ? 10 : st === 'yellow' ? 5 : 0;
      if (pts) {
        score += pts;
        factors.push({
          id: r.metricId,
          label: r.metricId === 'sleep_eff' ? 'Sleep efficiency off-nominal' : 'Reaction-time lapses',
          impact: pts,
          detail: `${r.label}: ${r.currentValue} ${r.unit} (${st.toUpperCase()})`,
        });
      }
    }
  }

  const crisis = detectCrisisLanguage(...recent.map((c) => c.note), ...extraTexts);
  const riskScore = Math.round(clamp(score, 0, 100));
  const status: TriageStatus = crisis.crisis ? 'red' : statusFromRisk(riskScore);
  if (crisis.crisis) {
    factors.unshift({
      id: 'crisis_language',
      label: 'Crisis language detected',
      impact: 0,
      detail: 'Wording suggests possible self-harm or hopelessness — immediate human follow-up required',
    });
  }

  return {
    riskScore,
    status,
    trend,
    factors: factors.sort((a, b) => b.impact - a.impact),
    crisisFlag: crisis.crisis,
    crisisMatches: crisis.matched,
    earthConsultUrgency: crisis.crisis
      ? 'immediate_emergency_packet'
      : status === 'red'
        ? 'priority_packet'
        : 'routine_downlink',
  };
}

const OFFLINE_MESSAGES: Record<TriageStatus, string> = {
  green: 'Your check-ins look steady. Keep the routines that are working — sleep schedule, exercise and time with the crew.',
  yellow:
    'Your recent check-ins show some strain. That is common on long missions. Small changes help: protect your sleep window, take a real break today, and talk with a crewmate.',
  red: 'Your check-ins show significant strain. Please talk with the Crew Medical Officer today and schedule a private conference with the behavioral health team.',
};

const OFFLINE_ACTIONS: Record<TriageStatus, string[]> = {
  green: ['Keep your regular sleep window', 'Schedule one shared crew meal or movie this week'],
  yellow: [
    'Take a 15-minute break with no tasks today',
    'Use the sleep-shift lighting and keep caffeine to mornings',
    'Plan a private family conference or message',
  ],
  red: [
    'Talk with the Crew Medical Officer today',
    'Request a private medical conference with behavioral health',
    'Ask the Commander to lighten non-critical tasks for 48 hours',
  ],
};

export function offlineSupport(result: WellbeingModelResult): { message: string; actions: string[] } {
  if (result.crisisFlag) {
    return { message: CRISIS_ESCALATION_MESSAGE, actions: OFFLINE_ACTIONS.red };
  }
  return { message: OFFLINE_MESSAGES[result.status], actions: OFFLINE_ACTIONS[result.status] };
}

/** Synthetic 14-day check-in history for demos and tests (deterministic). */
export function demoCheckIns(crewId: string, endMissionDay = 30, decline = false): WellbeingCheckIn[] {
  return Array.from({ length: 14 }, (_, i) => {
    const day = endMissionDay - 13 + i;
    const dip = decline ? Math.floor(i / 4) : 0;
    const wobble = (i % 3) - 1;
    const v = (base: number, dir = -1) => clamp(Math.round(base + dir * dip + (i % 5 === 0 ? wobble : 0)), 1, 5);
    return {
      id: `demo-${crewId}-${day}`,
      crewId,
      missionDay: day,
      timestampIso: new Date(Date.UTC(2026, 0, day)).toISOString(),
      mood: v(4),
      stress: v(2, 1),
      energy: v(4),
      sleepQuality: v(4),
      cohesion: v(4),
      motivation: v(4),
    };
  });
}
