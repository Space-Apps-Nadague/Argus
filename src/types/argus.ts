/**
 * ARGUS — Canonical TypeScript Data Models
 * Single Source of Truth: specs/01-data-schema.md
 */

export type GravityEnvironment = '0g_transit';

export type BodyZoneId = 'neuro' | 'cardio' | 'musculo' | 'immune' | 'behavioral';

export type AnatomicalLayer = 'all' | 'dermal' | 'skeletal' | 'organs';

export type TriageStatus = 'green' | 'yellow' | 'red';

export type ScenarioId = 'nominal' | 'sans_alert' | 'high_co2' | 'solar_storm';

export type MetricId =
  | 'onsd'
  | 'iop'
  | 'cabin_co2'
  | 'resting_hr'
  | 'hrv_rmssd'
  | 'spo2'
  | 'bmd_delta'
  | 'ared_load'
  | 'rad_dose'
  | 'wbc_lymph'
  | 'sleep_eff'
  | 'pvt_lapses';

export type HudTabId = 'biotwin' | 'trends' | 'checkin' | 'surgeon' | 'crew';

export type BloodType = 'O+' | 'O-' | 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-';

export type BiologicalSex = 'female' | 'male';

export type CrewRole =
  | 'Mission Commander'
  | 'Flight Engineer'
  | 'Flight Surgeon / Medical Officer'
  | 'Payload & Science Specialist'
  | 'EVA Surface Specialist';

export interface CrewMemberProfile {
  id: string;
  name: string;
  callsign: string;
  role: CrewRole | string;
  sex: BiologicalSex;
  age: number;
  bloodType: BloodType;
  restingHrBaselineBpm: number;
  preFlightOnsdMm: number;
  missionDaysLogged: number;
  countermeasureStreakSols: number;
  defaultScenarioId: ScenarioId;
  medicalNotes: string;
  isCustom?: boolean;
}

export interface ThresholdRange {
  nominalMin: number;
  nominalMax: number;
  yellowMin: number;
  yellowMax: number;
}

export interface TelemetryHistoryPoint {
  missionDay: number;
  dateLabel: string;
  value: number;
  source?: 'synthetic' | 'check_in';
}

export interface VitalSignReading {
  metricId: string;
  label: string;
  unit: string;
  currentValue: number;
  deltaFromBaseline: string;
  flightNormLabel: string;
  plainDescription: string;
  history: TelemetryHistoryPoint[];
}

export interface BodyZoneMetadata {
  id: BodyZoneId;
  name: string;
  shortLabel: string;
  anatomicalSubtitle: string;
  nasaHazardFocus: string;
}

export interface CountermeasureStep {
  id: string;
  stepNumber: number;
  title: string;
  plainInstruction: string;
  hardwareRequired: string;
  estimatedMinutes: number;
}

export interface FlightSurgeonGuidance {
  zoneId: BodyZoneId;
  environment: GravityEnvironment;
  scenarioId: ScenarioId;
  triageStatus: TriageStatus;
  headline: string;
  hazardContextSummary: string;
  plainLanguageExplanation: string;
  earthConsultUrgency: 'routine_downlink' | 'priority_packet' | 'immediate_emergency_packet';
  guidedSteps: CountermeasureStep[];
  source: 'live_ai' | 'offline_verified_cache';
}

export interface VisualExamSample {
  id: 'nominal_retina' | 'sans_ultrasound' | 'cabin_rash';
  title: string;
  zoneId: BodyZoneId;
  modality: string;
  previewSvgDataUrl: string;
  defaultFindingStatus: TriageStatus;
  clinicalSummary: string;
  plainCrewGuidance: string;
  recommendedAction: string;
}

export interface VisualExamAnalysis {
  sampleIdOrFileName: string;
  modality: string;
  findingStatus: TriageStatus;
  clinicalSummary: string;
  plainCrewGuidance: string;
  recommendedAction: string;
  analyzedAtIso: string;
  source: 'live_vision_ai' | 'offline_verified_cache';
}

export interface EarthTelemetryPacket {
  packetId: string;
  timestampIso: string;
  missionDay: number;
  commDelayLabel: string;
  crewMember: {
    id: string;
    name: string;
    callsign: string;
    role: string;
    age: number;
    bloodType: BloodType;
  };
  environment: GravityEnvironment;
  scenarioId: ScenarioId;
  readinessScore: number;
  focusZone: BodyZoneId;
  zoneStatuses: Record<BodyZoneId, TriageStatus>;
  completedSteps: string[];
  visualExamAttached?: VisualExamAnalysis | null;
  recentCheckIns?: CheckInEntry[];
  crewNotes: string;
}

export interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  shortTag: string;
  description: string;
  recommendedFocusZone: BodyZoneId;
  zones: Record<BodyZoneId, VitalSignReading[]>;
}

/** Personal-baseline drift & forecast (specs/01-data-schema.md §5) */
export interface PersonalBaseline {
  mean: number;
  sd: number;
  n: number;
}

export type DriftDirection = 'up' | 'down' | 'flat';

export type DriftLevel = 'steady' | 'watch' | 'drifting';

export interface DriftResult {
  baseline: PersonalBaseline;
  zScore: number;
  ewmaZ: number;
  direction: DriftDirection;
  level: DriftLevel;
}

export interface ForecastPoint {
  missionDay: number;
  dateLabel: string;
  mean: number;
  lower: number;
  upper: number;
}

export interface MetricLink {
  fromMetricId: MetricId;
  toMetricId: MetricId;
  lagDays: 0 | 1;
  r: number;
  n: number;
  expectedSign: 1 | -1;
  mechanism: string;
}

/** Daily crew check-in (specs/01-data-schema.md §6) */
export interface CheckInEntry {
  id: string;
  crewId: string;
  missionDay: number;
  timestampIso: string;
  values: Partial<Record<MetricId, number>>;
  note?: string;
}
