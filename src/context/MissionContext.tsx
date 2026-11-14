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
} from 'react';
import {
  AnatomicalLayer,
  BiologicalSex,
  BodyZoneId,
  CrewMemberProfile,
  EarthTelemetryPacket,
  FlightSurgeonGuidance,
  GravityEnvironment,
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
  analyzeVisualSelfExam,
  synthesizeFlightSurgeonGuidance,
} from '../services/flightSurgeonAi';

const CREW_STORAGE_KEY = 'argus_crew_roster_v1';

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
  | { type: 'SET_RUNTIME_API_KEY'; payload: string };

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
      const nextActiveCrew =
        state.activeCrewId === action.payload
          ? filtered[0]
          : getActiveCrew(filtered, state.activeCrewId);
      const nextScenario = nextActiveCrew.defaultScenarioId;
      const nextZone = TELEMETRY_SCENARIOS[nextScenario].recommendedFocusZone;
      return {
        ...state,
        crewRoster: filtered,
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
    default:
      return state;
  }
}

interface MissionContextValue extends MissionState {
  activeCrewMember: CrewMemberProfile;
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

export const MissionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(missionReducer, initialState);

  useEffect(() => {
    try {
      localStorage.setItem(CREW_STORAGE_KEY, JSON.stringify(state.crewRoster));
    } catch {
      // Ignore storage errors
    }
  }, [state.crewRoster]);

  const activeCrewMember = useMemo(
    () =>
      state.crewRoster.find((c) => c.id === state.activeCrewId) ||
      state.crewRoster[0],
    [state.crewRoster, state.activeCrewId]
  );

  const adjustedZones = useMemo(
    () => getCrewAdjustedZones(state.scenarioId, activeCrewMember),
    [state.scenarioId, activeCrewMember]
  );

  const zoneStatuses = useMemo(
    () => evaluateAllZones(adjustedZones, state.environment),
    [adjustedZones, state.environment]
  );

  const currentZoneReadings = useMemo(
    () => adjustedZones[state.selectedZone],
    [adjustedZones, state.selectedZone]
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
    dispatch({ type: 'SELECT_CREW_MEMBER', payload: crewId });
  }, []);

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

  const deleteCrewMember = useCallback((crewId: string) => {
    dispatch({ type: 'DELETE_CREW_MEMBER', payload: crewId });
  }, []);

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
      activeCrewMember,
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
      activeCrewMember,
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
