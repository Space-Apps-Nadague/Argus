/**
 * Builds the deterministic crew/telemetry/triage context every AI prompt is grounded in.
 */

import type {
  BodyZoneId,
  CrewMemberProfile,
  GravityEnvironment,
  ScenarioId,
  TriageStatus,
  VitalSignReading,
} from '../../src/types/argus';
import type { CrewContextRequest, MetricTrend } from '../../src/types/aiApi';
import { BODY_ZONES, getCrewAdjustedZones, TELEMETRY_SCENARIOS } from '../../src/data/telemetryScenarios';
import {
  calculateCrewReadinessScore,
  DEFAULT_ENVIRONMENT,
  ENVIRONMENT_META,
  evaluateAllZones,
} from '../../src/utils/triageEngine';
import { analyzeAllTrends, isFlagged } from './trendModels';

export interface CrewSnapshot {
  crewMember?: CrewMemberProfile;
  scenarioId: ScenarioId;
  scenarioLabel: string;
  environment: GravityEnvironment;
  zones: Record<BodyZoneId, VitalSignReading[]>;
  zoneStatuses: Record<BodyZoneId, TriageStatus>;
  readinessScore: number;
  trends: MetricTrend[];
  flaggedTrends: MetricTrend[];
}

export function buildCrewSnapshot(req: CrewContextRequest): CrewSnapshot {
  const environment = req.environment ?? DEFAULT_ENVIRONMENT;
  const scenario = TELEMETRY_SCENARIOS[req.scenarioId];
  const zones = getCrewAdjustedZones(req.scenarioId, req.crewMember);
  const trends = analyzeAllTrends(zones, environment);
  return {
    crewMember: req.crewMember,
    scenarioId: req.scenarioId,
    scenarioLabel: scenario.label,
    environment,
    zones,
    zoneStatuses: evaluateAllZones(zones, environment),
    readinessScore: calculateCrewReadinessScore(zones, environment),
    trends,
    flaggedTrends: trends.filter(isFlagged),
  };
}

export function describeCrew(crew?: CrewMemberProfile): string {
  if (!crew) return 'Crew member: standard astronaut Bio-Twin (no individual profile).';
  return [
    `Crew member: ${crew.name} (callsign "${crew.callsign}"), ${crew.role}, ${crew.sex}, age ${crew.age}, blood type ${crew.bloodType}.`,
    `Pre-flight baselines: resting HR ${crew.restingHrBaselineBpm} bpm, ONSD ${crew.preFlightOnsdMm} mm.`,
    `Mission days logged: ${crew.missionDaysLogged}; countermeasure streak: ${crew.countermeasureStreakSols} sols.`,
    crew.medicalNotes ? `Medical notes: ${crew.medicalNotes}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatTrend(t: MetricTrend): string {
  const toRed = t.daysToRed === null ? '' : t.daysToRed === 0 ? ', IN RED BAND' : `, ~${t.daysToRed} days to red`;
  return `- [${t.metricId}] ${t.label}: ${t.currentValue} ${t.unit} — ${t.status.toUpperCase()}; ${t.level} (${t.zScore >= 0 ? '+' : ''}${t.zScore}σ vs baseline), slope ${t.slopePerDay >= 0 ? '+' : ''}${t.slopePerDay}/day${toRed}`;
}

/** Compact, plain-text snapshot for system prompts. */
export function formatSnapshotForPrompt(s: CrewSnapshot, opts: { allMetrics?: boolean } = {}): string {
  const env = ENVIRONMENT_META[s.environment];
  const zoneLines = (Object.keys(s.zoneStatuses) as BodyZoneId[])
    .map((z) => `- ${BODY_ZONES[z].name}: ${s.zoneStatuses[z].toUpperCase()} (HRP focus: ${BODY_ZONES[z].nasaHazardFocus})`)
    .join('\n');
  const metrics = (opts.allMetrics ? s.trends : s.flaggedTrends).map(formatTrend).join('\n');

  return [
    describeCrew(s.crewMember),
    `Environment: ${env.label} (${env.gravityG}), Earth comm delay ${env.commDelay}, phase ${env.missionPhase}.`,
    `Active scenario: ${s.scenarioLabel}.`,
    `Crew Readiness Score (deterministic): ${s.readinessScore}%.`,
    `Zone triage (deterministic — authoritative, never change it):\n${zoneLines}`,
    `${opts.allMetrics ? 'All metrics' : 'Flagged metrics'} with trend models:\n${metrics || '- none flagged; all metrics steady and nominal'}`,
  ].join('\n\n');
}
