/**
 * ARGUS — Unified Mission State Context & Reducer
 * Single Source of Truth: specs/00-architecture.md & specs/01-data-schema.md
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';
import {
  AnatomicalLayer,
  BiologicalSex,
  BodyZoneId,
  CheckInEntry,
  CrewMemberProfile,
  EarthTelemetryPacket,
  FlightSurgeonGuidance,
  GravityEnvironment,
  HudTabId,
  SpaceLocation,
  SpaceLocationId,
  MetricId,
  MetricLink,
  ReadinessMilestone,
  ScenarioId,
  ScheduledRoutineStatus,
  TriageStatus,
  VitalSignReading,
  VisualExamAnalysis,
  VisualExamSample,
} from '../types/argus';
import {
  DEFAULT_CREW_ROSTER,
  getCrewAdjustedZones,
  getOfflineFlightSurgeonGuidance,
  TELEMETRY_SCENARIOS,
} from '../data/telemetryScenarios';
import {
  calculateCrewReadinessScore,
  ENVIRONMENT_META,
  evaluateAllZones,
  evaluateMetricStatus,
  evaluateZoneStatus,
} from '../utils/triageEngine';
import {
  applyCheckIns,
  CHECKINS_STORAGE_KEY,
  checkInStreak,
  entriesForScenario,
  latestMissionDay,
  sanitizeCheckIns,
} from '../utils/checkIns';
import { crewApi, dataApi } from '../services/dataApi';
import { findMetricLinks } from '../utils/driftAnalytics';
import { DEFAULT_SPACE_LOCATION, environmentForLocation, formatCommDelay, isSpaceLocationId, SPACE_LOCATIONS } from '../data/spaceLocations';
import {
  createQuickRoutineCheckIn,
  evaluateReadinessMilestones,
  getScheduledRoutineStatus,
} from '../utils/routineMilestones';
import {
  analyzeVisualSelfExam,
  synthesizeFlightSurgeonGuidance,
} from '../services/flightSurgeonAi';

const CREW_STORAGE_KEY = 'argus_crew_roster_v1';
const GUIDANCE_SCENARIO_ORDER: ScenarioId[] = ['nominal', 'sans_alert', 'high_co2', 'solar_storm'];

const URGENCY_RANK: Record<FlightSurgeonGuidance['earthConsultUrgency'], number> = {
  routine_downlink: 0,
  priority_packet: 1,
  immediate_emergency_packet: 2,
};
const STALE_PREFIX = 'Check-in out of range — ';

/** Metrics of a zone whose own status equals `status` (what drives the zone to that status). */
function driverMetrics(
  readings: VitalSignReading[],
  status: TriageStatus,
  environment: GravityEnvironment
): string[] {
  return readings
    .filter((r) => evaluateMetricStatus(r.metricId, r.currentValue, environment) === status)
    .map((r) => r.metricId);
}

/** Step 2: keep the guidance content, but follow the live status and never downgrade urgency. */
function escalateStaleGuidance(
  guidance: FlightSurgeonGuidance,
  liveStatus: TriageStatus
): FlightSurgeonGuidance {
  const floor =
    liveStatus === 'red'
      ? 'immediate_emergency_packet'
      : liveStatus === 'yellow'
      ? 'priority_packet'
      : 'routine_downlink';
  return {
    ...guidance,
    triageStatus: liveStatus,
    earthConsultUrgency:
      URGENCY_RANK[floor] > URGENCY_RANK[guidance.earthConsultUrgency] ? floor : guidance.earthConsultUrgency,
    headline: guidance.headline.startsWith(STALE_PREFIX) ? guidance.headline : `${STALE_PREFIX}${guidance.headline}`,
  };
}

/**
 * Keeps Flight Surgeon guidance consistent with the live (check-in overlaid) zone status.
 * specs/01-data-schema.md §6 "Flight Surgeon guidance follows live status".
 */
export function resolveLiveGuidance(
  guidance: FlightSurgeonGuidance,
  liveReadings: VitalSignReading[],
  environment: GravityEnvironment,
  crewMember: CrewMemberProfile
): FlightSurgeonGuidance {
  const liveStatus = evaluateZoneStatus(liveReadings, environment);
  if (
    guidance.triageStatus === liveStatus ||
    guidance.headline.startsWith('Autonomous Triage:') ||
    guidance.headline.startsWith('CRITICAL MEDICAL EMERGENCY:') ||
    guidance.headline.startsWith('Autonomous Clinical Guidance:')
  ) {
    return guidance;
  }
  if (guidance.source === 'live_ai') return escalateStaleGuidance(guidance, liveStatus);

  const liveDrivers = driverMetrics(liveReadings, liveStatus, environment);
  for (const sc of GUIDANCE_SCENARIO_ORDER) {
    const g = getOfflineFlightSurgeonGuidance(sc, guidance.zoneId, environment, crewMember);
    if (g.triageStatus !== liveStatus) continue;
    const scenarioDrivers = driverMetrics(
      getCrewAdjustedZones(sc, crewMember)[guidance.zoneId],
      liveStatus,
      environment
    );
    if (liveDrivers.every((m) => scenarioDrivers.includes(m))) {
      return { ...g, scenarioId: guidance.scenarioId };
    }
  }
  return escalateStaleGuidance(guidance, liveStatus);
}
const TAB_STORAGE_KEY = 'argus_active_tab_v1';
const HUD_TABS: HudTabId[] = ['biotwin', 'trends', 'forecast', 'eyes', 'ai', 'emergency', 'cognition', 'crew', 'users'];
const LOCATIONS_STORAGE_KEY = 'argus_locations_v1';

function loadInitialLocations(): Record<string, SpaceLocationId> {
  try {
    const raw = localStorage.getItem(LOCATIONS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => isSpaceLocationId(v))
      ) as Record<string, SpaceLocationId>;
    }
  } catch {
    // Ignore storage errors in restricted environments
  }
  return {};
}

const ENV_STORAGE_KEY = 'argus_mission_environment_v1';
const VALID_ENVIRONMENTS: GravityEnvironment[] = [
  'iss_leo',
  'lunar_base',
  '0g_transit',
  'mars_base',
  'earth_1g',
];

function loadInitialEnvironment(): GravityEnvironment {
  try {
    const raw = localStorage.getItem(ENV_STORAGE_KEY) as GravityEnvironment | null;
    if (raw && VALID_ENVIRONMENTS.includes(raw)) return raw;
  } catch {
    // Ignore storage errors in restricted environments
  }
  return '0g_transit';
}

function loadInitialTab(): HudTabId {
  try {
    const raw = localStorage.getItem(TAB_STORAGE_KEY) as HudTabId | null;
    if (raw && HUD_TABS.includes(raw)) return raw;
  } catch {
    // Ignore storage errors in restricted environments
  }
  return 'biotwin';
}

function loadInitialCheckIns(): Record<string, CheckInEntry[]> {
  try {
    const raw = localStorage.getItem(CHECKINS_STORAGE_KEY);
    if (raw) {
      return sanitizeCheckIns(JSON.parse(raw));
    }
  } catch {
    // Ignore storage errors in restricted environments
  }
  return {};
}

function loadInitialCrewRoster(): CrewMemberProfile[] {
  try {
    const raw = localStorage.getItem(CREW_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((member: CrewMemberProfile) => ({
          ...member,
          sex:
            member.sex === 'male' || member.sex === 'female'
              ? member.sex
              : member.id === 'crew-chen'
              ? 'male'
              : 'female',
        }));
      }
    }
  } catch {
    // Ignore storage errors in restricted environments
  }
  return DEFAULT_CREW_ROSTER;
}

interface MissionState {
  crewRoster: CrewMemberProfile[];
  activeCrewId: string;
  isCrewModalOpen: boolean;
  environment: GravityEnvironment;
  scenarioId: ScenarioId;
  selectedZone: BodyZoneId;
  selectedMetricId: string;
  anatomicalLayer: AnatomicalLayer;
  chartWindowDays: 14 | 30;
  completedStepIds: string[];
  countermeasureStreakSols: number;
  guidance: FlightSurgeonGuidance;
  isSynthesizingAi: boolean;
  visualExamAnalysis: VisualExamAnalysis | null;
  activePreviewImageUrl: string | null;
  isAnalyzingVisual: boolean;
  queuedPackets: EarthTelemetryPacket[];
  runtimeApiKey: string;
  activeTab: HudTabId;
  checkIns: Record<string, CheckInEntry[]>;
  crewSymptoms: string;
  isCompanionOpen: boolean;
}

type MissionAction =
  | { type: 'SELECT_CREW_MEMBER'; payload: string }
  | { type: 'SET_ROSTER'; payload: { roster: CrewMemberProfile[]; selectId?: string } }
  | { type: 'ADD_CREW_MEMBER'; payload: CrewMemberProfile }
  | { type: 'UPDATE_CREW_SEX'; payload: { crewId: string; sex: BiologicalSex } }
  | { type: 'REPLACE_CREW_MEMBER'; payload: CrewMemberProfile }
  | { type: 'DELETE_CREW_MEMBER'; payload: string }
  | { type: 'SET_CREW_MODAL_OPEN'; payload: boolean }
  | { type: 'SET_SCENARIO'; payload: ScenarioId }
  | { type: 'SET_SELECTED_ZONE'; payload: BodyZoneId }
  | { type: 'SET_SELECTED_METRIC'; payload: string }
  | { type: 'SET_ANATOMICAL_LAYER'; payload: AnatomicalLayer }
  | { type: 'SET_CHART_WINDOW'; payload: 14 | 30 }
  | { type: 'TOGGLE_STEP_COMPLETED'; payload: string }
  | { type: 'SET_GUIDANCE'; payload: FlightSurgeonGuidance }
  | { type: 'SET_SYNTHESIZING_AI'; payload: boolean }
  | {
      type: 'SET_VISUAL_EXAM_RESULT';
      payload: { analysis: VisualExamAnalysis | null; previewUrl: string | null };
    }
  | { type: 'SET_ANALYZING_VISUAL'; payload: boolean }
  | { type: 'QUEUE_EARTH_PACKET'; payload: EarthTelemetryPacket }
  | { type: 'SET_RUNTIME_API_KEY'; payload: string }
  | { type: 'SET_ENVIRONMENT'; payload: GravityEnvironment }
  | { type: 'SET_ACTIVE_TAB'; payload: HudTabId }
  | { type: 'ADD_CHECK_IN'; payload: CheckInEntry }
  | { type: 'DELETE_CHECK_IN'; payload: { crewId: string; entryId: string } }
  | { type: 'SET_CREW_SYMPTOMS'; payload: string }
  | { type: 'SET_COMPANION_OPEN'; payload: boolean };

const initialRoster = loadInitialCrewRoster();
const initialCrew = initialRoster[0] || DEFAULT_CREW_ROSTER[0];
const initialScenario: ScenarioId = initialCrew.defaultScenarioId || 'nominal';
const initialEnvironment: GravityEnvironment = loadInitialEnvironment();
const initialZone: BodyZoneId =
  TELEMETRY_SCENARIOS[initialScenario].recommendedFocusZone;

const initialState: MissionState = {
  crewRoster: initialRoster,
  activeCrewId: initialCrew.id,
  isCrewModalOpen: false,
  environment: initialEnvironment,
  scenarioId: initialScenario,
  selectedZone: initialZone,
  selectedMetricId:
    TELEMETRY_SCENARIOS[initialScenario].zones[initialZone][0].metricId,
  anatomicalLayer: 'all',
  chartWindowDays: 14,
  completedStepIds: [],
  countermeasureStreakSols: initialCrew.countermeasureStreakSols,
  guidance: getOfflineFlightSurgeonGuidance(
    initialScenario,
    initialZone,
    initialEnvironment,
    initialCrew
  ),
  isSynthesizingAi: false,
  visualExamAnalysis: null,
  activePreviewImageUrl: null,
  isAnalyzingVisual: false,
  queuedPackets: [],
  runtimeApiKey: '',
  activeTab: loadInitialTab(),
  checkIns: loadInitialCheckIns(),
  crewSymptoms: '',
  isCompanionOpen: false,
};

function missionReducer(
  state: MissionState,
  action: MissionAction
): MissionState {
  const getActiveCrew = (roster: CrewMemberProfile[], id: string) =>
    roster.find((c) => c.id === id) || roster[0];

  switch (action.type) {
    case 'SET_ROSTER': {
      if (action.payload.roster.length === 0) return state;
      const withRoster = { ...state, crewRoster: action.payload.roster };
      const keep = action.payload.selectId ?? state.activeCrewId;
      const target = action.payload.roster.some((c) => c.id === keep) ? keep : action.payload.roster[0].id;
      return missionReducer(withRoster, { type: 'SELECT_CREW_MEMBER', payload: target });
    }
    case 'SELECT_CREW_MEMBER': {
      const targetCrew = getActiveCrew(state.crewRoster, action.payload);
      // Re-selecting the active crew member (strip click, SET_ROSTER refresh) keeps the session (spec §6).
      if (targetCrew.id === state.activeCrewId) {
        return targetCrew.countermeasureStreakSols === state.countermeasureStreakSols
          ? state
          : { ...state, countermeasureStreakSols: targetCrew.countermeasureStreakSols };
      }
      const nextScenario = targetCrew.defaultScenarioId;
      const scenarioDef = TELEMETRY_SCENARIOS[nextScenario];
      const nextZone = scenarioDef.recommendedFocusZone;
      const firstMetric = scenarioDef.zones[nextZone][0]?.metricId || 'onsd';
      const nextGuidance = getOfflineFlightSurgeonGuidance(
        nextScenario,
        nextZone,
        state.environment,
        targetCrew
      );
      return {
        ...state,
        activeCrewId: targetCrew.id,
        scenarioId: nextScenario,
        selectedZone: nextZone,
        selectedMetricId: firstMetric,
        countermeasureStreakSols: targetCrew.countermeasureStreakSols,
        completedStepIds: [],
        guidance: nextGuidance,
      };
    }
    case 'ADD_CREW_MEMBER': {
      const nextRoster = [...state.crewRoster, action.payload];
      const nextScenario = action.payload.defaultScenarioId;
      const scenarioDef = TELEMETRY_SCENARIOS[nextScenario];
      const nextZone = scenarioDef.recommendedFocusZone;
      const firstMetric = scenarioDef.zones[nextZone][0]?.metricId || 'onsd';
      const nextGuidance = getOfflineFlightSurgeonGuidance(
        nextScenario,
        nextZone,
        state.environment,
        action.payload
      );
      return {
        ...state,
        crewRoster: nextRoster,
        activeCrewId: action.payload.id,
        scenarioId: nextScenario,
        selectedZone: nextZone,
        selectedMetricId: firstMetric,
        countermeasureStreakSols: action.payload.countermeasureStreakSols,
        completedStepIds: [],
        guidance: nextGuidance,
      };
    }
    case 'UPDATE_CREW_SEX': {
      const nextRoster = state.crewRoster.map((c) =>
        c.id === action.payload.crewId ? { ...c, sex: action.payload.sex } : c
      );
      return {
        ...state,
        crewRoster: nextRoster,
      };
    }
    case 'REPLACE_CREW_MEMBER':
      return {
        ...state,
        crewRoster: state.crewRoster.map((c) => (c.id === action.payload.id ? action.payload : c)),
      };
    case 'DELETE_CREW_MEMBER': {
      const filtered = state.crewRoster.filter(
        (c) => c.id !== action.payload || !c.isCustom
      );
      if (filtered.length === 0) return state;
      const deletedIsCustom = state.crewRoster.some(
        (c) => c.id === action.payload && c.isCustom
      );
      const nextCheckIns = { ...state.checkIns };
      if (deletedIsCustom) delete nextCheckIns[action.payload];
      const nextActiveCrew =
        state.activeCrewId === action.payload
          ? filtered[0]
          : getActiveCrew(filtered, state.activeCrewId);
      const nextScenario = nextActiveCrew.defaultScenarioId;
      const nextZone = TELEMETRY_SCENARIOS[nextScenario].recommendedFocusZone;
      return {
        ...state,
        crewRoster: filtered,
        checkIns: nextCheckIns,
        activeCrewId: nextActiveCrew.id,
        scenarioId: nextScenario,
        selectedZone: nextZone,
        countermeasureStreakSols: nextActiveCrew.countermeasureStreakSols,
        guidance: getOfflineFlightSurgeonGuidance(
          nextScenario,
          nextZone,
          state.environment,
          nextActiveCrew
        ),
      };
    }
    case 'SET_CREW_MODAL_OPEN':
      return {
        ...state,
        isCrewModalOpen: action.payload,
      };
    case 'SET_SCENARIO': {
      const activeCrew = getActiveCrew(state.crewRoster, state.activeCrewId);
      const scenarioDef = TELEMETRY_SCENARIOS[action.payload];
      const nextZone = scenarioDef.recommendedFocusZone;
      const firstMetric = scenarioDef.zones[nextZone][0]?.metricId || 'onsd';
      const nextGuidance = getOfflineFlightSurgeonGuidance(
        action.payload,
        nextZone,
        state.environment,
        activeCrew
      );
      return {
        ...state,
        scenarioId: action.payload,
        selectedZone: nextZone,
        selectedMetricId: firstMetric,
        completedStepIds: [],
        guidance: nextGuidance,
      };
    }
    case 'SET_SELECTED_ZONE': {
      const activeCrew = getActiveCrew(state.crewRoster, state.activeCrewId);
      const scenarioDef = TELEMETRY_SCENARIOS[state.scenarioId];
      const firstMetric =
        scenarioDef.zones[action.payload][0]?.metricId || state.selectedMetricId;
      const nextGuidance = getOfflineFlightSurgeonGuidance(
        state.scenarioId,
        action.payload,
        state.environment,
        activeCrew
      );
      return {
        ...state,
        selectedZone: action.payload,
        selectedMetricId: firstMetric,
        guidance: nextGuidance,
      };
    }
    case 'SET_SELECTED_METRIC':
      return {
        ...state,
        selectedMetricId: action.payload,
      };
    case 'SET_ANATOMICAL_LAYER':
      return {
        ...state,
        anatomicalLayer: action.payload,
      };
    case 'SET_CHART_WINDOW':
      return {
        ...state,
        chartWindowDays: action.payload,
      };
    case 'TOGGLE_STEP_COMPLETED': {
      const exists = state.completedStepIds.includes(action.payload);
      const updated = exists
        ? state.completedStepIds.filter((id) => id !== action.payload)
        : [...state.completedStepIds, action.payload];
      return {
        ...state,
        completedStepIds: updated,
      };
    }
    case 'SET_GUIDANCE':
      return {
        ...state,
        guidance: action.payload,
      };
    case 'SET_SYNTHESIZING_AI':
      return {
        ...state,
        isSynthesizingAi: action.payload,
      };
    case 'SET_VISUAL_EXAM_RESULT':
      return {
        ...state,
        visualExamAnalysis: action.payload.analysis,
        activePreviewImageUrl: action.payload.previewUrl,
      };
    case 'SET_ANALYZING_VISUAL':
      return {
        ...state,
        isAnalyzingVisual: action.payload,
      };
    case 'QUEUE_EARTH_PACKET':
      return {
        ...state,
        queuedPackets: [action.payload, ...state.queuedPackets],
      };
    case 'SET_RUNTIME_API_KEY':
      return {
        ...state,
        runtimeApiKey: action.payload,
      };
    case 'SET_ENVIRONMENT': {
      const activeCrew = getActiveCrew(state.crewRoster, state.activeCrewId);
      const nextGuidance = getOfflineFlightSurgeonGuidance(
        state.scenarioId,
        state.selectedZone,
        action.payload,
        activeCrew
      );
      return {
        ...state,
        environment: action.payload,
        guidance: nextGuidance,
      };
    }
    case 'SET_ACTIVE_TAB':
      return {
        ...state,
        activeTab: action.payload,
      };
    case 'ADD_CHECK_IN': {
      const list = state.checkIns[action.payload.crewId] || [];
      const entry = { ...action.payload, scenarioId: action.payload.scenarioId ?? state.scenarioId };
      return {
        ...state,
        checkIns: {
          ...state.checkIns,
          [action.payload.crewId]: [...list, entry],
        },
      };
    }
    case 'DELETE_CHECK_IN': {
      const list = state.checkIns[action.payload.crewId] || [];
      return {
        ...state,
        checkIns: {
          ...state.checkIns,
          [action.payload.crewId]: list.filter(
            (e) => e.id !== action.payload.entryId
          ),
        },
      };
    }
    case 'SET_CREW_SYMPTOMS':
      return {
        ...state,
        crewSymptoms: action.payload,
      };
    case 'SET_COMPANION_OPEN':
      return {
        ...state,
        isCompanionOpen: action.payload,
      };
    default:
      return state;
  }
}

interface MissionContextValue extends MissionState {
  activeCrewMember: CrewMemberProfile;
  /** Crew-adjusted zones with check-ins overlaid (single source for all tabs). From the database in server mode. */
  zones: Record<BodyZoneId, VitalSignReading[]>;
  /** Where `zones` came from: the ARGUS database, or the synthetic demo series. */
  zonesSource: 'database' | 'demo';
  /** Zones for any crew member; null in server mode when this user may not see that astronaut's data. */
  zonesForCrew: (member: CrewMemberProfile, scenario?: ScenarioId) => Record<BodyZoneId, VitalSignReading[]> | null;
  activeCheckIns: CheckInEntry[];
  /** `activeCheckIns` logged in the active scenario: overlaid on zones and sent to AI / Earth packets. */
  scenarioCheckIns: CheckInEntry[];
  checkInStreakDays: number;
  latestDay: number;
  metricLinks: MetricLink[];
  setActiveTab: (tab: HudTabId) => void;
  /** True when a crew user is signed in: the active crew member can't be changed. */
  isCrewLocked: boolean;
  spaceLocationId: SpaceLocationId;
  spaceLocation: SpaceLocation;
  setSpaceLocation: (id: SpaceLocationId) => void;
  addCheckIn: (entry: CheckInEntry) => void;
  deleteCheckIn: (entryId: string) => void;
  routineStatus: ScheduledRoutineStatus;
  milestones: ReadinessMilestone[];
  completeScheduledRoutine: () => void;
  zoneStatuses: Record<BodyZoneId, TriageStatus>;
  currentZoneReadings: VitalSignReading[];
  readinessScore: number;
  selectCrewMember: (crewId: string) => void;
  createCrewMember: (newMember: Omit<CrewMemberProfile, 'id' | 'isCustom'>) => void;
  /** True when roster, data and chat come from the ARGUS database (specs/05-data-platform.md). */
  serverBacked: boolean;
  /** True when the signed-in user is allowed to fetch health/chat/wellbeing data for `activeCrewMember`. */
  canReadActiveCrew: boolean;
  updateCrewMemberSex: (crewId: string, sex: BiologicalSex) => void;
  /** Server mode: turns cloud AI on/off for one astronaut (`ai_consent`, specs/05 §6). Rejects on a server error. */
  setCrewAiConsent: (crewId: string, consent: boolean) => Promise<void>;
  deleteCrewMember: (crewId: string) => void;
  setCrewModalOpen: (open: boolean) => void;
  setScenario: (scenario: ScenarioId) => void;
  setEnvironment: (env: GravityEnvironment) => void;
  setSelectedZone: (zone: BodyZoneId) => void;
  setSelectedMetricId: (metricId: string) => void;
  setAnatomicalLayer: (layer: AnatomicalLayer) => void;
  setChartWindowDays: (days: 14 | 30) => void;
  toggleStepCompleted: (stepId: string) => void;
  requestLiveAiGuidance: () => Promise<void>;
  setCrewSymptoms: (symptoms: string) => void;
  consultFlightSurgeon: (symptoms?: string) => Promise<void>;
  runSampleVisualExam: (sample: VisualExamSample) => Promise<void>;
  runUploadedVisualExam: (file: File) => Promise<void>;
  clearVisualExam: () => void;
  queueEarthPacket: (crewNotes?: string) => EarthTelemetryPacket;
  setRuntimeApiKey: (key: string) => void;
  logVitalReading: (zoneId: BodyZoneId, metricKey: string, value: number) => Promise<void>;
  setCompanionOpen: (open: boolean) => void;
}

const MissionContext = createContext<MissionContextValue | undefined>(undefined);

interface MissionProviderProps {
  children: React.ReactNode;
  /** Crew users are locked to their own crew member (specs/02-ui-dashboard.md §6). */
  lockedCrewId?: string;
  /** False for plain server admins who manage accounts/roster without health access (specs/05-data-platform.md §6). */
  canViewHealth?: boolean;
  /** Called after a crew member is deleted (e.g. to remove linked accounts). */
  onCrewDeleted?: (crewId: string) => void;
  /** Load and save the roster (and later data) through the ARGUS server instead of localStorage. */
  serverBacked?: boolean;
}

export const MissionProvider: React.FC<MissionProviderProps> = ({
  children,
  lockedCrewId,
  canViewHealth = true,
  onCrewDeleted,
  serverBacked = false,
}) => {
  const [state, dispatch] = useReducer(missionReducer, initialState, (s) =>
    lockedCrewId && lockedCrewId !== s.activeCrewId && s.crewRoster.some((c) => c.id === lockedCrewId)
      ? missionReducer(s, { type: 'SELECT_CREW_MEMBER', payload: lockedCrewId })
      : s
  );
  const [locations, setLocations] = useState<Record<string, SpaceLocationId>>(loadInitialLocations);

  useEffect(() => {
    try {
      localStorage.setItem(LOCATIONS_STORAGE_KEY, JSON.stringify(locations));
    } catch {
      // Ignore storage errors
    }
  }, [locations]);

  useEffect(() => {
    if (serverBacked) return; // the database is the system of record
    try {
      localStorage.setItem(CREW_STORAGE_KEY, JSON.stringify(state.crewRoster));
    } catch {
      // Ignore storage errors
    }
  }, [state.crewRoster, serverBacked]);

  // Server mode: the roster comes from the database (pseudonymized per role, spec 05 §6).
  useEffect(() => {
    if (!serverBacked) return;
    let cancelled = false;
    crewApi
      .list()
      .then(({ crew }) => {
        if (!cancelled) dispatch({ type: 'SET_ROSTER', payload: { roster: crew, selectId: lockedCrewId } });
      })
      .catch((err) => console.warn('[ARGUS] could not load crew roster', err));
    return () => {
      cancelled = true;
    };
  }, [serverBacked, lockedCrewId]);

  useEffect(() => {
    try {
      localStorage.setItem(CHECKINS_STORAGE_KEY, JSON.stringify(state.checkIns));
    } catch {
      // Ignore storage errors
    }
  }, [state.checkIns]);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, state.activeTab);
    } catch {
      // Ignore storage errors
    }
  }, [state.activeTab]);

  useEffect(() => {
    try {
      localStorage.setItem(ENV_STORAGE_KEY, state.environment);
    } catch {
      // Ignore storage errors
    }
  }, [state.environment]);

  const activeCrewMember = useMemo(
    () =>
      state.crewRoster.find((c) => c.id === state.activeCrewId) ||
      state.crewRoster[0],
    [state.crewRoster, state.activeCrewId]
  );

  const spaceLocationId: SpaceLocationId = locations[activeCrewMember.id] ?? DEFAULT_SPACE_LOCATION;
  const spaceLocation = SPACE_LOCATIONS[spaceLocationId];

  // The location selector drives the threshold set (iss_leo / lunar_base / 0g_transit / mars_base).
  useEffect(() => {
    const env = environmentForLocation(spaceLocationId);
    if (env !== state.environment) dispatch({ type: 'SET_ENVIRONMENT', payload: env });
  }, [spaceLocationId, state.environment]);

  const setSpaceLocation = useCallback(
    (id: SpaceLocationId) => setLocations((prev) => ({ ...prev, [activeCrewMember.id]: id })),
    [activeCrewMember.id]
  );

  const activeCheckIns = useMemo(
    () => state.checkIns[activeCrewMember.id] || [],
    [state.checkIns, activeCrewMember.id]
  );

  /** Active crew's check-ins logged in the active scenario: the ones overlaid and sent to AI (spec §6). */
  const scenarioCheckIns = useMemo(
    () => entriesForScenario(activeCheckIns, state.scenarioId, activeCrewMember.defaultScenarioId),
    [activeCheckIns, state.scenarioId, activeCrewMember.defaultScenarioId]
  );

  // Server mode: zones per astronaut come from `daily_metrics` (spec 05 §8), refreshed every minute.
  const [serverZones, setServerZones] = useState<Record<string, Record<BodyZoneId, VitalSignReading[]>>>({});
  const readableCrewIds = useMemo(
    () => (lockedCrewId ? [lockedCrewId] : state.crewRoster.map((c) => c.id)).join(','),
    [lockedCrewId, state.crewRoster]
  );
  const refreshServerZones = useCallback(
    async (ids: string[]) => {
      const results = await Promise.all(
        ids.map((id) =>
          dataApi
            .zones(id)
            .then((r) => (r.hasData ? ([id, r.zones] as const) : null))
            .catch(() => null)
        )
      );
      setServerZones((prev) => {
        const next = { ...prev };
        for (const r of results) if (r) next[r[0]] = r[1];
        return next;
      });
    },
    []
  );
  useEffect(() => {
    if (!serverBacked || !canViewHealth || !readableCrewIds) return;
    const ids = readableCrewIds.split(',');
    void refreshServerZones(ids);
    const timer = setInterval(() => void refreshServerZones(ids), 60_000);
    return () => clearInterval(timer);
  }, [serverBacked, canViewHealth, readableCrewIds, refreshServerZones]);

  const zonesForCrew = useCallback(
    (member: CrewMemberProfile, scenario: ScenarioId = member.defaultScenarioId) => {
      if (serverBacked) return serverZones[member.id] ?? null;
      return applyCheckIns(
        getCrewAdjustedZones(scenario, member),
        entriesForScenario(state.checkIns[member.id] || [], scenario, member.defaultScenarioId)
      );
    },
    [serverBacked, serverZones, state.checkIns]
  );

  const activeServerZones = serverBacked ? serverZones[activeCrewMember.id] : undefined;
  const zonesSource: 'database' | 'demo' = activeServerZones ? 'database' : 'demo';
  const adjustedZones = useMemo(
    () =>
      activeServerZones ??
      applyCheckIns(
        getCrewAdjustedZones(state.scenarioId, activeCrewMember),
        scenarioCheckIns
      ),
    [activeServerZones, state.scenarioId, activeCrewMember, scenarioCheckIns]
  );

  const checkInStreakDays = useMemo(
    () => checkInStreak(activeCheckIns),
    [activeCheckIns]
  );

  const latestDay = useMemo(() => latestMissionDay(adjustedZones), [adjustedZones]);

  const metricLinks = useMemo(() => findMetricLinks(adjustedZones), [adjustedZones]);

  const zoneStatuses = useMemo(
    () => evaluateAllZones(adjustedZones, state.environment),
    [adjustedZones, state.environment]
  );

  const currentZoneReadings = useMemo(
    () => adjustedZones[state.selectedZone],
    [adjustedZones, state.selectedZone]
  );

  const liveGuidance = useMemo(
    () =>
      resolveLiveGuidance(
        state.guidance,
        adjustedZones[state.guidance.zoneId],
        state.environment,
        activeCrewMember
      ),
    [state.guidance, adjustedZones, state.environment, activeCrewMember]
  );

  /** Completed steps that belong to the guidance on screen (spec §6 "Completed steps follow the shown guidance"). */
  const shownCompletedStepIds = useMemo(
    () => state.completedStepIds.filter((id) => liveGuidance.guidedSteps.some((s) => s.id === id)),
    [state.completedStepIds, liveGuidance.guidedSteps]
  );

  const readinessScore = useMemo(
    () =>
      calculateCrewReadinessScore(
        adjustedZones,
        state.environment,
        shownCompletedStepIds.length
      ),
    [adjustedZones, state.environment, shownCompletedStepIds.length]
  );

  const routineStatus = useMemo(
    () =>
      getScheduledRoutineStatus({
        activeCheckIns,
        latestDay,
        countermeasureStreakSols: activeCrewMember.countermeasureStreakSols,
      }),
    [activeCheckIns, latestDay, activeCrewMember.countermeasureStreakSols]
  );

  const milestones = useMemo(
    () =>
      evaluateReadinessMilestones({
        activeCheckIns,
        streakDays: routineStatus.streakDays,
        readinessScore,
        completedStepCount: shownCompletedStepIds.length,
        crewMember: activeCrewMember,
      }),
    [
      activeCheckIns,
      routineStatus.streakDays,
      readinessScore,
      shownCompletedStepIds.length,
      activeCrewMember,
    ]
  );

  const completeScheduledRoutine = useCallback(() => {
    const entry = createQuickRoutineCheckIn({
      crewId: activeCrewMember.id,
      missionDay: latestDay || 30,
      crewProfile: activeCrewMember,
    });
    dispatch({ type: 'ADD_CHECK_IN', payload: entry });
  }, [activeCrewMember, latestDay]);

  const selectCrewMember = useCallback((crewId: string) => {
    if (lockedCrewId && crewId !== lockedCrewId) return;
    dispatch({ type: 'SELECT_CREW_MEMBER', payload: crewId });
  }, [lockedCrewId]);

  const createCrewMember = useCallback(
    (newMember: Omit<CrewMemberProfile, 'id' | 'isCustom'>) => {
      if (serverBacked) {
        const { missionDaysLogged: _days, ...profile } = newMember;
        crewApi
          .create(profile)
          .then(({ crewMember }) => dispatch({ type: 'ADD_CREW_MEMBER', payload: crewMember }))
          .catch((err) => console.warn('[ARGUS] could not create crew member', err));
        return;
      }
      dispatch({
        type: 'ADD_CREW_MEMBER',
        payload: { ...newMember, id: `crew-custom-${Date.now()}`, isCustom: true },
      });
    },
    [serverBacked]
  );

  const deleteCrewMember = useCallback(
    (crewId: string) => {
      if (lockedCrewId) return; // only admins manage the roster
      if (serverBacked) void crewApi.archive(crewId).catch((err) => console.warn('[ARGUS] could not archive', err));
      dispatch({ type: 'DELETE_CREW_MEMBER', payload: crewId });
      setLocations(({ [crewId]: _removed, ...rest }) => rest);
      onCrewDeleted?.(crewId);
    },
    [lockedCrewId, onCrewDeleted, serverBacked]
  );

  const updateCrewMemberSex = useCallback(
    (crewId: string, sex: BiologicalSex) => {
      if (serverBacked) void crewApi.update(crewId, { sex }).catch((err) => console.warn('[ARGUS] could not update', err));
      dispatch({ type: 'UPDATE_CREW_SEX', payload: { crewId, sex } });
    },
    [serverBacked]
  );

  const setCrewAiConsent = useCallback(
    async (crewId: string, consent: boolean) => {
      if (!serverBacked) return;
      const { crewMember } = await crewApi.update(crewId, { aiConsent: consent });
      dispatch({ type: 'REPLACE_CREW_MEMBER', payload: crewMember });
    },
    [serverBacked]
  );

  const setCrewModalOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_CREW_MODAL_OPEN', payload: open });
  }, []);

  const setScenario = useCallback((scenario: ScenarioId) => {
    dispatch({ type: 'SET_SCENARIO', payload: scenario });
  }, []);

  const setEnvironment = useCallback((env: GravityEnvironment) => {
    dispatch({ type: 'SET_ENVIRONMENT', payload: env });
  }, []);

  const setSelectedZone = useCallback((zone: BodyZoneId) => {
    dispatch({ type: 'SET_SELECTED_ZONE', payload: zone });
  }, []);

  const setSelectedMetricId = useCallback((metricId: string) => {
    dispatch({ type: 'SET_SELECTED_METRIC', payload: metricId });
  }, []);

  const setAnatomicalLayer = useCallback((layer: AnatomicalLayer) => {
    dispatch({ type: 'SET_ANATOMICAL_LAYER', payload: layer });
  }, []);

  const setChartWindowDays = useCallback((days: 14 | 30) => {
    dispatch({ type: 'SET_CHART_WINDOW', payload: days });
  }, []);

  const toggleStepCompleted = useCallback((stepId: string) => {
    dispatch({ type: 'TOGGLE_STEP_COMPLETED', payload: stepId });
  }, []);

  const setRuntimeApiKey = useCallback((key: string) => {
    dispatch({ type: 'SET_RUNTIME_API_KEY', payload: key });
  }, []);

  const setActiveTab = useCallback((tab: HudTabId) => {
    dispatch({ type: 'SET_ACTIVE_TAB', payload: tab });
  }, []);

  const addCheckIn = useCallback(
    (entry: CheckInEntry) => {
      if (serverBacked) {
        // Stored as observations (origin check_in); zones are re-read from the database.
        dataApi
          .checkIn(entry.crewId, entry.values as Record<string, number>, entry.note)
          .then(() => refreshServerZones([entry.crewId]))
          .catch((err) => console.warn('[ARGUS] could not save check-in', err));
        return;
      }
      dispatch({ type: 'ADD_CHECK_IN', payload: entry });
    },
    [serverBacked, refreshServerZones]
  );

  const deleteCheckIn = useCallback(
    (entryId: string) => {
      dispatch({
        type: 'DELETE_CHECK_IN',
        payload: { crewId: activeCrewMember.id, entryId },
      });
    },
    [activeCrewMember.id]
  );

  const logVitalReading = useCallback(
    async (zoneId: BodyZoneId, metricKey: string, value: number) => {
      const now = new Date();
      const targetDay = latestDay || 30;
      const entry: CheckInEntry = {
        id: `vital-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        crewId: activeCrewMember.id,
        missionDay: targetDay,
        timestampIso: now.toISOString(),
        values: {
          [metricKey as MetricId]: value,
        },
        note: `Interactive vital reading: ${metricKey} = ${value}`,
        scenarioId: state.scenarioId,
      };
      if (serverBacked) {
        await dataApi.checkIn(
          entry.crewId,
          entry.values as Record<string, number>,
          entry.note
        );
        await refreshServerZones([entry.crewId]);
      } else {
        dispatch({ type: 'ADD_CHECK_IN', payload: entry });
      }
      dispatch({ type: 'SET_SELECTED_ZONE', payload: zoneId });
      dispatch({ type: 'SET_SELECTED_METRIC', payload: metricKey });

      dispatch({ type: 'SET_SYNTHESIZING_AI', payload: true });
      try {
        const updated = await synthesizeFlightSurgeonGuidance({
          scenarioId: state.scenarioId,
          zoneId,
          environment: state.environment,
          locationId: spaceLocationId,
          crewMember: activeCrewMember,
          telemetryCheckIns: [...scenarioCheckIns, entry],
          runtimeApiKey: state.runtimeApiKey,
          forceLiveAi: true,
        });
        dispatch({ type: 'SET_GUIDANCE', payload: updated });
      } catch (err) {
        console.warn('[ARGUS AI] Guidance synthesis failed after vital log:', err);
      } finally {
        dispatch({ type: 'SET_SYNTHESIZING_AI', payload: false });
      }
    },
    [
      activeCrewMember,
      scenarioCheckIns,
      latestDay,
      spaceLocationId,
      state.scenarioId,
      state.environment,
      state.runtimeApiKey,
      serverBacked,
      refreshServerZones,
    ]
  );

  const setCrewSymptoms = useCallback((symptoms: string) => {
    dispatch({ type: 'SET_CREW_SYMPTOMS', payload: symptoms });
  }, []);

  const consultFlightSurgeon = useCallback(
    async (customSymptoms?: string) => {
      const activeSymptoms = customSymptoms !== undefined ? customSymptoms : state.crewSymptoms;
      if (customSymptoms !== undefined) {
        dispatch({ type: 'SET_CREW_SYMPTOMS', payload: customSymptoms });
      }
      dispatch({ type: 'SET_SYNTHESIZING_AI', payload: true });
      try {
        const updated = await synthesizeFlightSurgeonGuidance({
          scenarioId: state.scenarioId,
          zoneId: state.selectedZone,
          environment: state.environment,
          locationId: spaceLocationId,
          crewMember: activeCrewMember,
          telemetryCheckIns: scenarioCheckIns,
          runtimeApiKey: state.runtimeApiKey,
          forceLiveAi: true,
          crewSymptoms: activeSymptoms,
        });
        dispatch({ type: 'SET_GUIDANCE', payload: updated });
        if (updated.zoneId && updated.zoneId !== state.selectedZone) {
          dispatch({ type: 'SET_SELECTED_ZONE', payload: updated.zoneId });
        }
      } catch (err) {
        console.warn('[ARGUS AI] Guidance synthesis error:', err);
      } finally {
        dispatch({ type: 'SET_SYNTHESIZING_AI', payload: false });
      }
    },
    [
      state.crewSymptoms,
      state.scenarioId,
      state.selectedZone,
      state.environment,
      spaceLocationId,
      activeCrewMember,
      scenarioCheckIns,
      state.runtimeApiKey,
    ]
  );

  const requestLiveAiGuidance = useCallback(async () => {
    dispatch({ type: 'SET_SYNTHESIZING_AI', payload: true });
    try {
      const updated = await synthesizeFlightSurgeonGuidance({
        scenarioId: state.scenarioId,
        zoneId: state.selectedZone,
        environment: state.environment,
        locationId: spaceLocationId,
        crewMember: activeCrewMember,
        telemetryCheckIns: scenarioCheckIns,
        runtimeApiKey: state.runtimeApiKey,
        forceLiveAi: true,
        crewSymptoms: state.crewSymptoms,
      });
      dispatch({ type: 'SET_GUIDANCE', payload: updated });
    } finally {
      dispatch({ type: 'SET_SYNTHESIZING_AI', payload: false });
    }
  }, [
    state.scenarioId,
    state.selectedZone,
    state.environment,
    spaceLocationId,
    activeCrewMember,
    scenarioCheckIns,
    state.runtimeApiKey,
    state.crewSymptoms,
  ]);

  const runSampleVisualExam = useCallback(
    async (sample: VisualExamSample) => {
      dispatch({ type: 'SET_ANALYZING_VISUAL', payload: true });
      try {
        const result = await analyzeVisualSelfExam({
          sample,
          environment: state.environment,
          runtimeApiKey: state.runtimeApiKey,
        });
        dispatch({
          type: 'SET_VISUAL_EXAM_RESULT',
          payload: {
            analysis: result,
            previewUrl: sample.previewSvgDataUrl,
          },
        });
      } finally {
        dispatch({ type: 'SET_ANALYZING_VISUAL', payload: false });
      }
    },
    [state.environment, state.runtimeApiKey]
  );

  const runUploadedVisualExam = useCallback(
    async (file: File) => {
      dispatch({ type: 'SET_ANALYZING_VISUAL', payload: true });
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const base64Data = dataUrl.includes(',')
          ? dataUrl.split(',')[1]
          : dataUrl;

        const result = await analyzeVisualSelfExam({
          uploadedFile: {
            fileName: file.name,
            base64Data,
            mimeType: file.type || 'image/jpeg',
          },
          environment: state.environment,
          runtimeApiKey: state.runtimeApiKey,
        });
        dispatch({
          type: 'SET_VISUAL_EXAM_RESULT',
          payload: {
            analysis: result,
            previewUrl: dataUrl,
          },
        });
      } finally {
        dispatch({ type: 'SET_ANALYZING_VISUAL', payload: false });
      }
    },
    [state.environment, state.runtimeApiKey]
  );

  const clearVisualExam = useCallback(() => {
    dispatch({
      type: 'SET_VISUAL_EXAM_RESULT',
      payload: { analysis: null, previewUrl: null },
    });
  }, []);

  const setCompanionOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_COMPANION_OPEN', payload: open });
  }, []);

  const queueEarthPacket = useCallback(
    (crewNotes: string = 'Autonomous bio-twin telemetry & countermeasure log.') => {
      const envMeta = ENVIRONMENT_META[state.environment];
      const packet: EarthTelemetryPacket = {
        packetId: `PKT-${Math.floor(100000 + Math.random() * 900000)}`,
        timestampIso: new Date().toISOString(),
        missionDay: activeCrewMember.missionDaysLogged,
        commDelayLabel: `${formatCommDelay(spaceLocation)} ONE-WAY`,
        crewMember: {
          id: activeCrewMember.id,
          name: activeCrewMember.name,
          callsign: activeCrewMember.callsign,
          role: activeCrewMember.role,
          age: activeCrewMember.age,
          bloodType: activeCrewMember.bloodType,
        },
        environment: state.environment,
        scenarioId: state.scenarioId,
        readinessScore,
        focusZone: state.selectedZone,
        zoneStatuses,
        completedSteps: shownCompletedStepIds,
        visualExamAttached: state.visualExamAnalysis,
        recentCheckIns: [...scenarioCheckIns]
          .sort((a, b) => b.timestampIso.localeCompare(a.timestampIso))
          .slice(0, 5),
        crewNotes,
      };
      dispatch({ type: 'QUEUE_EARTH_PACKET', payload: packet });
      return packet;
    },
    [
      state.environment,
      state.scenarioId,
      activeCrewMember,
      readinessScore,
      state.selectedZone,
      zoneStatuses,
      shownCompletedStepIds,
      state.visualExamAnalysis,
      scenarioCheckIns,
      spaceLocation,
    ]
  );

  useEffect(() => {
    if (
      !currentZoneReadings.some((m) => m.metricId === state.selectedMetricId) &&
      currentZoneReadings.length > 0
    ) {
      dispatch({
        type: 'SET_SELECTED_METRIC',
        payload: currentZoneReadings[0].metricId,
      });
    }
  }, [currentZoneReadings, state.selectedMetricId]);

  const canReadActiveCrew =
    !serverBacked || (canViewHealth && (!lockedCrewId || activeCrewMember.id === lockedCrewId));

  const value = useMemo<MissionContextValue>(
    () => ({
      ...state,
      guidance: liveGuidance,
      completedStepIds: shownCompletedStepIds,
      activeCrewMember,
      zones: adjustedZones,
      activeCheckIns,
      scenarioCheckIns,
      checkInStreakDays,
      latestDay,
      metricLinks,
      routineStatus,
      milestones,
      completeScheduledRoutine,
      setActiveTab,
      isCrewLocked: Boolean(lockedCrewId),
      serverBacked,
      canReadActiveCrew,
      zonesSource,
      zonesForCrew,
      spaceLocationId,
      spaceLocation,
      setSpaceLocation,
      addCheckIn,
      deleteCheckIn,
      zoneStatuses,
      currentZoneReadings,
      readinessScore,
      selectCrewMember,
      createCrewMember,
      updateCrewMemberSex,
      setCrewAiConsent,
      deleteCrewMember,
      setCrewModalOpen,
      setScenario,
      setEnvironment,
      setSelectedZone,
      setSelectedMetricId,
      setAnatomicalLayer,
      setChartWindowDays,
      toggleStepCompleted,
      requestLiveAiGuidance,
      setCrewSymptoms,
      consultFlightSurgeon,
      runSampleVisualExam,
      runUploadedVisualExam,
      clearVisualExam,
      queueEarthPacket,
      setRuntimeApiKey,
      logVitalReading,
      setCompanionOpen,
    }),
    [
      state,
      liveGuidance,
      shownCompletedStepIds,
      activeCrewMember,
      adjustedZones,
      activeCheckIns,
      scenarioCheckIns,
      checkInStreakDays,
      latestDay,
      metricLinks,
      routineStatus,
      milestones,
      completeScheduledRoutine,
      setActiveTab,
      lockedCrewId,
      serverBacked,
      canReadActiveCrew,
      zonesSource,
      zonesForCrew,
      spaceLocationId,
      spaceLocation,
      setSpaceLocation,
      addCheckIn,
      deleteCheckIn,
      logVitalReading,
      setCompanionOpen,
      zoneStatuses,
      currentZoneReadings,
      readinessScore,
      selectCrewMember,
      createCrewMember,
      updateCrewMemberSex,
      setCrewAiConsent,
      deleteCrewMember,
      setCrewModalOpen,
      setScenario,
      setEnvironment,
      setSelectedZone,
      setSelectedMetricId,
      setAnatomicalLayer,
      setChartWindowDays,
      toggleStepCompleted,
      requestLiveAiGuidance,
      setCrewSymptoms,
      consultFlightSurgeon,
      runSampleVisualExam,
      runUploadedVisualExam,
      clearVisualExam,
      queueEarthPacket,
      setRuntimeApiKey,
    ]
  );

  return (
    <MissionContext.Provider value={value}>{children}</MissionContext.Provider>
  );
};

export function useMission(): MissionContextValue {
  const ctx = useContext(MissionContext);
  if (!ctx) {
    throw new Error('useMission must be used inside a MissionProvider');
  }
  return ctx;
}
