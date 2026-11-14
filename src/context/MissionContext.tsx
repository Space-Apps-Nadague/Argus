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
  MetricLink,
  ScenarioId,
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
} from '../utils/triageEngine';
import {
  applyCheckIns,
  CHECKINS_STORAGE_KEY,
  checkInStreak,
  latestMissionDay,
} from '../utils/checkIns';
import { findMetricLinks } from '../utils/driftAnalytics';
import { DEFAULT_SPACE_LOCATION, isSpaceLocationId, SPACE_LOCATIONS } from '../data/spaceLocations';
import {
  analyzeVisualSelfExam,
  synthesizeFlightSurgeonGuidance,
} from '../services/flightSurgeonAi';

const CREW_STORAGE_KEY = 'argus_crew_roster_v1';
const GUIDANCE_SCENARIO_ORDER: ScenarioId[] = ['nominal', 'sans_alert', 'high_co2', 'solar_storm'];

/**
 * Keeps Flight Surgeon guidance consistent with the live (check-in overlaid) zone status.
 * specs/01-data-schema.md §6 "Flight Surgeon guidance follows live status".
 */
export function resolveLiveGuidance(
  guidance: FlightSurgeonGuidance,
  liveStatus: TriageStatus,
  environment: GravityEnvironment,
  crewMember: CrewMemberProfile
): FlightSurgeonGuidance {
  if (guidance.source === 'live_ai' || guidance.triageStatus === liveStatus) return guidance;
  for (const sc of GUIDANCE_SCENARIO_ORDER) {
    const g = getOfflineFlightSurgeonGuidance(sc, guidance.zoneId, environment, crewMember);
    if (g.triageStatus === liveStatus) return { ...g, scenarioId: guidance.scenarioId };
  }
  return {
    ...guidance,
    triageStatus: liveStatus,
    earthConsultUrgency:
      liveStatus === 'red'
        ? 'immediate_emergency_packet'
        : liveStatus === 'yellow'
        ? 'priority_packet'
        : guidance.earthConsultUrgency,
    headline: `Check-in out of range — ${guidance.headline}`,
  };
}
const TAB_STORAGE_KEY = 'argus_active_tab_v1';
const HUD_TABS: HudTabId[] = ['biotwin', 'trends', 'forecast', 'eyes', 'ai', 'emergency', 'crew', 'users'];
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
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, CheckInEntry[]>;
      }
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
}

type MissionAction =
  | { type: 'SELECT_CREW_MEMBER'; payload: string }
  | { type: 'ADD_CREW_MEMBER'; payload: CrewMemberProfile }
  | { type: 'UPDATE_CREW_SEX'; payload: { crewId: string; sex: BiologicalSex } }
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
  | { type: 'SET_ACTIVE_TAB'; payload: HudTabId }
  | { type: 'ADD_CHECK_IN'; payload: CheckInEntry }
  | { type: 'DELETE_CHECK_IN'; payload: { crewId: string; entryId: string } };

const initialRoster = loadInitialCrewRoster();
const initialCrew = initialRoster[0] || DEFAULT_CREW_ROSTER[0];
const initialScenario: ScenarioId = initialCrew.defaultScenarioId || 'nominal';
const initialEnvironment: GravityEnvironment = '0g_transit';
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
};

function missionReducer(
  state: MissionState,
  action: MissionAction
): MissionState {
  const getActiveCrew = (roster: CrewMemberProfile[], id: string) =>
    roster.find((c) => c.id === id) || roster[0];

  switch (action.type) {
    case 'SELECT_CREW_MEMBER': {
      const targetCrew = getActiveCrew(state.crewRoster, action.payload);
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
    case 'SET_ACTIVE_TAB':
      return {
        ...state,
        activeTab: action.payload,
      };
    case 'ADD_CHECK_IN': {
      const list = state.checkIns[action.payload.crewId] || [];
      return {
        ...state,
        checkIns: {
          ...state.checkIns,
          [action.payload.crewId]: [...list, action.payload],
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
    default:
      return state;
  }
}

interface MissionContextValue extends MissionState {
  activeCrewMember: CrewMemberProfile;
  /** Crew-adjusted zones with check-ins overlaid (single source for all tabs). */
  zones: Record<BodyZoneId, VitalSignReading[]>;
  activeCheckIns: CheckInEntry[];
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
  zoneStatuses: Record<BodyZoneId, TriageStatus>;
  currentZoneReadings: VitalSignReading[];
  readinessScore: number;
  selectCrewMember: (crewId: string) => void;
  createCrewMember: (
    newMember: Omit<CrewMemberProfile, 'id' | 'isCustom'>
  ) => CrewMemberProfile;
  updateCrewMemberSex: (crewId: string, sex: BiologicalSex) => void;
  deleteCrewMember: (crewId: string) => void;
  setCrewModalOpen: (open: boolean) => void;
  setScenario: (scenario: ScenarioId) => void;
  setSelectedZone: (zone: BodyZoneId) => void;
  setSelectedMetricId: (metricId: string) => void;
  setAnatomicalLayer: (layer: AnatomicalLayer) => void;
  setChartWindowDays: (days: 14 | 30) => void;
  toggleStepCompleted: (stepId: string) => void;
  requestLiveAiGuidance: () => Promise<void>;
  runSampleVisualExam: (sample: VisualExamSample) => Promise<void>;
  runUploadedVisualExam: (file: File) => Promise<void>;
  clearVisualExam: () => void;
  queueEarthPacket: (crewNotes?: string) => EarthTelemetryPacket;
  setRuntimeApiKey: (key: string) => void;
}

const MissionContext = createContext<MissionContextValue | undefined>(undefined);

interface MissionProviderProps {
  children: React.ReactNode;
  /** Crew users are locked to their own crew member (specs/02-ui-dashboard.md §6). */
  lockedCrewId?: string;
  /** Called after a crew member is deleted (e.g. to remove linked accounts). */
  onCrewDeleted?: (crewId: string) => void;
}

export const MissionProvider: React.FC<MissionProviderProps> = ({
  children,
  lockedCrewId,
  onCrewDeleted,
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
    try {
      localStorage.setItem(CREW_STORAGE_KEY, JSON.stringify(state.crewRoster));
    } catch {
      // Ignore storage errors
    }
  }, [state.crewRoster]);

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

  const activeCrewMember = useMemo(
    () =>
      state.crewRoster.find((c) => c.id === state.activeCrewId) ||
      state.crewRoster[0],
    [state.crewRoster, state.activeCrewId]
  );

  const spaceLocationId: SpaceLocationId = locations[activeCrewMember.id] ?? DEFAULT_SPACE_LOCATION;
  const spaceLocation = SPACE_LOCATIONS[spaceLocationId];

  const setSpaceLocation = useCallback(
    (id: SpaceLocationId) => setLocations((prev) => ({ ...prev, [activeCrewMember.id]: id })),
    [activeCrewMember.id]
  );

  const activeCheckIns = useMemo(
    () => state.checkIns[activeCrewMember.id] || [],
    [state.checkIns, activeCrewMember.id]
  );

  const adjustedZones = useMemo(
    () =>
      applyCheckIns(
        getCrewAdjustedZones(state.scenarioId, activeCrewMember),
        activeCheckIns
      ),
    [state.scenarioId, activeCrewMember, activeCheckIns]
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
        zoneStatuses[state.guidance.zoneId],
        state.environment,
        activeCrewMember
      ),
    [state.guidance, zoneStatuses, state.environment, activeCrewMember]
  );

  const readinessScore = useMemo(
    () =>
      calculateCrewReadinessScore(
        adjustedZones,
        state.environment,
        state.completedStepIds.length
      ),
    [adjustedZones, state.environment, state.completedStepIds.length]
  );

  const selectCrewMember = useCallback((crewId: string) => {
    if (lockedCrewId && crewId !== lockedCrewId) return;
    dispatch({ type: 'SELECT_CREW_MEMBER', payload: crewId });
  }, [lockedCrewId]);

  const createCrewMember = useCallback(
    (newMember: Omit<CrewMemberProfile, 'id' | 'isCustom'>) => {
      const created: CrewMemberProfile = {
        ...newMember,
        id: `crew-custom-${Date.now()}`,
        isCustom: true,
      };
      dispatch({ type: 'ADD_CREW_MEMBER', payload: created });
      return created;
    },
    []
  );

  const deleteCrewMember = useCallback(
    (crewId: string) => {
      if (lockedCrewId) return; // only admins manage the roster
      dispatch({ type: 'DELETE_CREW_MEMBER', payload: crewId });
      setLocations(({ [crewId]: _removed, ...rest }) => rest);
      onCrewDeleted?.(crewId);
    },
    [lockedCrewId, onCrewDeleted]
  );

  const updateCrewMemberSex = useCallback(
    (crewId: string, sex: BiologicalSex) => {
      dispatch({ type: 'UPDATE_CREW_SEX', payload: { crewId, sex } });
    },
    []
  );

  const setCrewModalOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_CREW_MODAL_OPEN', payload: open });
  }, []);

  const setScenario = useCallback((scenario: ScenarioId) => {
    dispatch({ type: 'SET_SCENARIO', payload: scenario });
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

  const addCheckIn = useCallback((entry: CheckInEntry) => {
    dispatch({ type: 'ADD_CHECK_IN', payload: entry });
  }, []);

  const deleteCheckIn = useCallback(
    (entryId: string) => {
      dispatch({
        type: 'DELETE_CHECK_IN',
        payload: { crewId: activeCrewMember.id, entryId },
      });
    },
    [activeCrewMember.id]
  );

  const requestLiveAiGuidance = useCallback(async () => {
    dispatch({ type: 'SET_SYNTHESIZING_AI', payload: true });
    try {
      const updated = await synthesizeFlightSurgeonGuidance({
        scenarioId: state.scenarioId,
        zoneId: state.selectedZone,
        environment: state.environment,
        crewMember: activeCrewMember,
        runtimeApiKey: state.runtimeApiKey,
        forceLiveAi: true,
      });
      dispatch({ type: 'SET_GUIDANCE', payload: updated });
    } finally {
      dispatch({ type: 'SET_SYNTHESIZING_AI', payload: false });
    }
  }, [
    state.scenarioId,
    state.selectedZone,
    state.environment,
    activeCrewMember,
    state.runtimeApiKey,
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

  const queueEarthPacket = useCallback(
    (crewNotes: string = 'Autonomous bio-twin telemetry & countermeasure log.') => {
      const envMeta = ENVIRONMENT_META[state.environment];
      const packet: EarthTelemetryPacket = {
        packetId: `PKT-${Math.floor(100000 + Math.random() * 900000)}`,
        timestampIso: new Date().toISOString(),
        missionDay: activeCrewMember.missionDaysLogged,
        commDelayLabel: envMeta.commDelay,
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
        completedSteps: state.completedStepIds,
        visualExamAttached: state.visualExamAnalysis,
        recentCheckIns: [...activeCheckIns]
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
      state.completedStepIds,
      state.visualExamAnalysis,
      activeCheckIns,
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

  const value = useMemo<MissionContextValue>(
    () => ({
      ...state,
      guidance: liveGuidance,
      activeCrewMember,
      zones: adjustedZones,
      activeCheckIns,
      checkInStreakDays,
      latestDay,
      metricLinks,
      setActiveTab,
      isCrewLocked: Boolean(lockedCrewId),
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
      deleteCrewMember,
      setCrewModalOpen,
      setScenario,
      setSelectedZone,
      setSelectedMetricId,
      setAnatomicalLayer,
      setChartWindowDays,
      toggleStepCompleted,
      requestLiveAiGuidance,
      runSampleVisualExam,
      runUploadedVisualExam,
      clearVisualExam,
      queueEarthPacket,
      setRuntimeApiKey,
    }),
    [
      state,
      liveGuidance,
      activeCrewMember,
      adjustedZones,
      activeCheckIns,
      checkInStreakDays,
      latestDay,
      metricLinks,
      setActiveTab,
      lockedCrewId,
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
      deleteCrewMember,
      setCrewModalOpen,
      setScenario,
      setSelectedZone,
      setSelectedMetricId,
      setAnatomicalLayer,
      setChartWindowDays,
      toggleStepCompleted,
      requestLiveAiGuidance,
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
