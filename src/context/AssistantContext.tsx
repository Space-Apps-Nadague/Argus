/**
 * ARGUS assistant state (specs/02-ui-dashboard.md §2.4, specs/04-ai-backend.md §4.2–§4.4).
 *
 * One provider, mounted above the tabs so nothing is lost on a tab switch:
 * - the single conversation thread (text, voice, Earth replies), saved per crew member
 * - the comm tier, from live light time, the network and the crew's override
 * - voice in/out for that tier (Earth live session, Earth relay, or on-ship engines)
 * - the camera and its on-device observation (emotion, fatigue, posture, pulse estimate)
 * - actions the assistant takes: emergency protocol, steps, readings, countermeasures,
 *   close-up requests and reports to the doctors on Earth
 * - the mental-state assessment and its history
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { COMM_TIER_PROFILES, type CommTier, resolveCommTier, roundTripSeconds, tierForDelay, mostAutonomous } from '../../shared/commProfile';
import { combineAssessment, reportTimingFor, shouldAutoReport, urgencyForConcern } from '../../shared/mentalState';
import { detectRedFlags } from '../../shared/redFlags';
import { pickCountermeasure } from '../../shared/countermeasures';
import { useCrewContextRequest, useWellbeingHistory } from '../components/ai/shared';
import { EMERGENCY_PROTOCOLS } from '../data/emergencyProtocols';
import { commDelayAt } from '../data/spaceLocations';
import { assistantApi, earthApi, streamConverse } from '../services/assistantApi';
import { chatHistoryApi } from '../services/dataApi';
import { MicCapture, type Utterance } from '../services/speech/micCapture';
import { LiveSession, type LiveToolCall } from '../services/speech/liveSession';
import { SpeechOutput, primaryVoiceEngine } from '../services/speech/speechOutput';
import { loadVoicePrefs, saveVoicePrefs, type VoicePrefs } from '../services/speech/voicePrefs';
import { CameraObserver, captureFrame } from '../services/vision/observer';
import { generateOfflineCompanionReply } from '../utils/companionBrain';
import type { BodyZoneId, EarthTelemetryPacket, MetricId } from '../types/argus';
import { isMetricId } from '../utils/triageEngine';
import type { EarthConsultUrgency } from '../types/aiApi';
import type {
  AssistantAction,
  AssistantMessage,
  AssistantModality,
  BehavioralHealthReport,
  ConverseEvent,
  ConverseRequest,
  CountermeasureSuggestion,
  EarthReport,
  EarthReportKind,
  MentalStateAssessment,
  VisualObservation,
  VoiceEngineId,
  VoicesResponse,
} from '../types/assistant';
import type { RedFlagProtocolId } from '../../shared/redFlags';
import { useMission } from './MissionContext';

// ── Persisted per-crew state ─────────────────────────────────────────────────

const THREAD_KEY = 'argus_assistant_thread_v1';
const RUN_KEY = 'argus_assistant_emergency_v1';
const SESSION_KEY = 'argus_assistant_session_v1';
const LOCAL_REPORTS_KEY = 'argus_assistant_reports_v1';
const MIGRATED_KEY = 'argus_assistant_migrated_v1';
const MAX_MESSAGES = 200;

function readAll<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeOne<T>(key: string, crewId: string, value: T | null): void {
  try {
    const all = readAll<T>(key);
    if (value === null) delete all[crewId];
    else all[crewId] = value;
    localStorage.setItem(key, JSON.stringify(all));
  } catch {
    // storage unavailable: state lasts for this page view
  }
}

/** One-time import of the three old chat stores into the single thread. */
function migrateLegacy(crewId: string): AssistantMessage[] {
  try {
    const done = readAll<boolean>(MIGRATED_KEY);
    if (done[crewId]) return [];
    writeOne(MIGRATED_KEY, crewId, true);
    const out: AssistantMessage[] = [];
    const chat = readAll<Array<{ role: 'user' | 'assistant'; content: string; timestampIso?: string }>>('argus_chat_v1')[crewId] ?? [];
    for (const m of chat) out.push({ id: uid(), role: m.role, content: m.content, timestampIso: m.timestampIso ?? new Date(0).toISOString() });
    const raw = localStorage.getItem(`argus_companion_chat_${crewId}`);
    const companion = raw ? (JSON.parse(raw) as Array<{ role: 'crew' | 'argus'; text: string; timestampIso?: string }>) : [];
    for (const m of companion) out.push({ id: uid(), role: m.role === 'crew' ? 'user' : 'assistant', content: m.text, timestampIso: m.timestampIso ?? new Date(0).toISOString() });
    return out.sort((a, b) => a.timestampIso.localeCompare(b.timestampIso)).slice(-MAX_MESSAGES);
  } catch {
    return [];
  }
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ── Types exposed to the console ─────────────────────────────────────────────

export interface EmergencyRunState {
  protocolId: RedFlagProtocolId;
  title: string;
  steps: string[];
  startedAtIso: string;
  reason: string;
  /** 1-based step number → time done. */
  completed: Record<number, string>;
}

export interface GuidedStepsState {
  title: string;
  steps: string[];
  completed: number[];
}

export interface CountermeasureEntry {
  suggestion: CountermeasureSuggestion;
  suggestedAtIso: string;
  helped?: boolean;
}

/** Session state that is not the thread: kept so a reload does not forget what is on screen. */
interface SessionState {
  guidedSteps: GuidedStepsState | null;
  countermeasures: CountermeasureEntry[];
  assessment: MentalStateAssessment | null;
  lastReportedConcern: MentalStateAssessment['concernLevel'] | null;
  lastDigestIso: string | null;
  seenReplyIds: string[];
}

const EMPTY_SESSION: SessionState = {
  guidedSteps: null,
  countermeasures: [],
  assessment: null,
  lastReportedConcern: null,
  lastDigestIso: null,
  seenReplyIds: [],
};

export type AssistantStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';
export type CameraState = 'off' | 'needs_consent' | 'starting' | 'on' | 'blocked';
export type VoiceMode = 'off' | 'push' | 'conversation';

export interface TierInfo {
  /** Tier from distance and network alone. */
  physical: CommTier;
  /** Tier actually in use (after the crew override and any failure fallback). */
  effective: CommTier;
  oneWaySec: number;
  roundTripSec: number;
  override: CommTier | null;
  /** Why the effective tier is further from Earth than the physical one, if it is. */
  note: string | null;
}

export interface Latency {
  firstTokenMs: number | null;
  firstAudioMs: number | null;
}

interface AssistantContextValue {
  messages: AssistantMessage[];
  status: AssistantStatus;
  interim: string;
  micLevel: number;
  latency: Latency;
  error: string | null;
  tier: TierInfo;
  setTierOverride: (tier: CommTier | null) => void;

  send: (text: string, opts?: { modality?: AssistantModality; withCloseUp?: boolean }) => Promise<void>;
  stop: () => void;
  clearThread: () => Promise<void>;

  voiceMode: VoiceMode;
  startConversation: () => Promise<void>;
  stopConversation: () => void;
  /** Push-to-talk: first call starts listening, second sends. */
  togglePushToTalk: () => Promise<void>;
  liveConnected: boolean;
  speechEngine: VoiceEngineId | 'live' | null;
  speaking: boolean;
  interrupt: () => void;

  prefs: VoicePrefs;
  updatePrefs: (patch: Partial<VoicePrefs>) => void;
  voices: VoicesResponse | null;
  previewVoice: (engine: VoiceEngineId, voiceId: string) => void;

  camera: CameraState;
  attachVideo: (el: HTMLVideoElement | null) => void;
  enableCamera: () => Promise<void>;
  disableCamera: () => void;
  grantCameraConsent: () => Promise<void>;
  observation: VisualObservation | null;
  closeUpRequest: string | null;
  sendCloseUp: () => Promise<void>;
  dismissCloseUp: () => void;

  emergency: EmergencyRunState | null;
  startEmergency: (protocolId: RedFlagProtocolId, reason?: string) => void;
  toggleEmergencyStep: (stepNumber: number) => void;
  endEmergency: () => void;
  emergencyPickerOpen: boolean;
  setEmergencyPickerOpen: (open: boolean) => void;

  guidedSteps: GuidedStepsState | null;
  toggleGuidedStep: (stepNumber: number) => void;
  clearGuidedSteps: () => void;

  countermeasures: CountermeasureEntry[];
  rateCountermeasure: (id: string, helped: boolean) => void;
  dismissCountermeasure: (id: string) => void;

  assessment: MentalStateAssessment | null;
  assessmentHistory: MentalStateAssessment[];

  reports: EarthReport[];
  sendReport: (opts: { urgency: EarthConsultUrgency; kind: EarthReportKind; note: string; crewNote?: string }) => Promise<EarthReport | null>;
  lastReportNotice: string | null;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error('useAssistant must be used inside <AssistantProvider>');
  return ctx;
}

function formatEta(sec: number): string {
  if (sec < 1) return 'under a second';
  if (sec < 90) return `${Math.round(sec)} s`;
  return `${Math.round(sec / 60)} min`;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export const AssistantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mission = useMission();
  const {
    activeCrewMember,
    spaceLocation,
    runtimeApiKey,
    serverBacked,
    canReadActiveCrew,
    setActiveTab,
    logVitalReading,
    queueEarthPacket,
    zones,
    zoneStatuses,
    readinessScore,
    environment,
    scenarioId,
    scenarioCheckIns,
  } = mission;
  const crewId = activeCrewMember.id;
  const crewContext = useCrewContextRequest();
  const [wellbeingCheckIns] = useWellbeingHistory(crewId);

  // ── Thread & session ───────────────────────────────────────────────────────
  const [messages, setMessagesState] = useState<AssistantMessage[]>([]);
  const [session, setSessionState] = useState<SessionState>(EMPTY_SESSION);
  const [emergency, setEmergencyState] = useState<EmergencyRunState | null>(null);
  const [localReports, setLocalReports] = useState<EarthReport[]>([]);
  const [serverReports, setServerReports] = useState<EarthReport[]>([]);
  const [assessmentHistory, setAssessmentHistory] = useState<MentalStateAssessment[]>([]);
  const messagesRef = useRef<AssistantMessage[]>([]);
  const sessionRef = useRef<SessionState>(EMPTY_SESSION);
  const emergencyRef = useRef<EmergencyRunState | null>(null);

  const setMessages = useCallback(
    (fn: (prev: AssistantMessage[]) => AssistantMessage[]) => {
      setMessagesState((prev) => {
        const next = fn(prev).slice(-MAX_MESSAGES);
        messagesRef.current = next;
        // Streaming placeholders are not persisted half-written.
        writeOne(THREAD_KEY, crewId, next.filter((m) => !m.streaming));
        return next;
      });
    },
    [crewId]
  );
  const setSession = useCallback(
    (fn: (prev: SessionState) => SessionState) => {
      setSessionState((prev) => {
        const next = fn(prev);
        sessionRef.current = next;
        writeOne(SESSION_KEY, crewId, next);
        return next;
      });
    },
    [crewId]
  );
  const setEmergency = useCallback(
    (run: EmergencyRunState | null) => {
      emergencyRef.current = run;
      setEmergencyState(run);
      writeOne(RUN_KEY, crewId, run);
    },
    [crewId]
  );

  // Load everything for the active crew member.
  useEffect(() => {
    const stored = readAll<AssistantMessage[]>(THREAD_KEY)[crewId] ?? [];
    const thread = stored.length ? stored : migrateLegacy(crewId);
    messagesRef.current = thread;
    setMessagesState(thread);
    const s = { ...EMPTY_SESSION, ...(readAll<SessionState>(SESSION_KEY)[crewId] ?? {}) };
    sessionRef.current = s;
    setSessionState(s);
    const run = readAll<EmergencyRunState>(RUN_KEY)[crewId] ?? null;
    emergencyRef.current = run;
    setEmergencyState(run);
    setLocalReports(readAll<EarthReport[]>(LOCAL_REPORTS_KEY)[crewId] ?? []);
    setServerReports([]);
    setAssessmentHistory([]);

    if (serverBacked && canReadActiveCrew) {
      let alive = true;
      // Server thread wins when this browser has nothing yet (another device, cleared storage).
      if (!thread.length) {
        chatHistoryApi
          .latest(crewId)
          .then((r) => {
            if (!alive || !r.messages.length || messagesRef.current.length) return;
            const fromServer = r.messages.map<AssistantMessage>((m) => ({ id: uid(), role: m.role, content: m.content, timestampIso: m.timestampIso ?? new Date().toISOString() }));
            messagesRef.current = fromServer;
            setMessagesState(fromServer);
          })
          .catch(() => {});
      }
      earthApi
        .history(crewId)
        .then((r) => alive && setAssessmentHistory(r.history))
        .catch(() => {});
      return () => {
        alive = false;
      };
    }
    return undefined;
  }, [crewId, serverBacked, canReadActiveCrew]);

  // ── Comm tier ──────────────────────────────────────────────────────────────
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [override, setOverride] = useState<CommTier | null>(null);
  const [failedDown, setFailedDown] = useState<{ tier: CommTier; reason: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(t);
    };
  }, []);

  const tier = useMemo<TierInfo>(() => {
    const oneWaySec = commDelayAt(spaceLocation, new Date(now)).seconds;
    const physical = tierForDelay(oneWaySec);
    let effective = resolveCommTier({ oneWayDelaySec: oneWaySec, online, override });
    let note: string | null = null;
    if (!online) note = 'No network: running on the ship.';
    else if (override && effective !== physical) note = 'Crew override.';
    if (failedDown && mostAutonomous(effective, failedDown.tier) === failedDown.tier && failedDown.tier !== effective) {
      effective = failedDown.tier;
      note = failedDown.reason;
    }
    return { physical, effective, oneWaySec, roundTripSec: roundTripSeconds(oneWaySec), override, note };
  }, [spaceLocation, now, online, override, failedDown]);
  const tierRef = useRef(tier);
  tierRef.current = tier;

  // A location change or override gives the faster tier another chance.
  useEffect(() => setFailedDown(null), [spaceLocation.id, override]);

  const setTierOverride = useCallback((t: CommTier | null) => setOverride(t), []);

  // ── Preferences & voices ───────────────────────────────────────────────────
  const [prefs, setPrefs] = useState<VoicePrefs>(loadVoicePrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const updatePrefs = useCallback((patch: Partial<VoicePrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch, voices: { ...prev.voices, ...(patch.voices ?? {}) } };
      saveVoicePrefs(next);
      return next;
    });
  }, []);
  const [voices, setVoices] = useState<VoicesResponse | null>(null);
  useEffect(() => {
    let alive = true;
    void assistantApi.voices(runtimeApiKey).then((v) => alive && setVoices(v));
    return () => {
      alive = false;
    };
  }, [runtimeApiKey]);

  // ── UI state ───────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<AssistantStatus>('idle');
  const [interim, setInterim] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [latency, setLatency] = useState<Latency>({ firstTokenMs: null, firstAudioMs: null });
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [speechEngine, setSpeechEngine] = useState<VoiceEngineId | 'live' | null>(null);
  const [emergencyPickerOpen, setEmergencyPickerOpen] = useState(false);
  const [lastReportNotice, setLastReportNotice] = useState<string | null>(null);
  const [closeUpRequest, setCloseUpRequest] = useState<string | null>(null);

  // ── Speech output ──────────────────────────────────────────────────────────
  const speechRef = useRef<SpeechOutput | null>(null);
  if (!speechRef.current) {
    speechRef.current = new SpeechOutput({
      synthesize: async (text, signal) => {
        const t = tierRef.current.effective;
        const engine = primaryVoiceEngine(t);
        const env = await assistantApi.tts({ text, tier: t, voice: prefsRef.current.voices[engine] }, runtimeKeyRef.current, signal);
        return {
          audioBase64: env.result.audioBase64,
          mimeType: env.result.mimeType,
          useBrowserSpeechFallback: env.result.useBrowserSpeechFallback,
          engine: env.meta.provider === 'local' ? 'local' : 'gemini',
        };
      },
      onSpeakingChange: (s) => setSpeaking(s),
      onEngine: (e) => setSpeechEngine(e),
      onFirstAudio: (ms) => setLatency((l) => ({ ...l, firstAudioMs: ms })),
    });
  }
  const runtimeKeyRef = useRef(runtimeApiKey);
  runtimeKeyRef.current = runtimeApiKey;
  useEffect(() => {
    if (speechRef.current) speechRef.current.settings = { rate: prefs.rate, browserVoiceName: prefs.voices.browser };
  }, [prefs.rate, prefs.voices.browser]);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const observerRef = useRef<CameraObserver | null>(null);
  const [camera, setCamera] = useState<CameraState>(() => (loadVoicePrefs().cameraConsent ? 'off' : 'needs_consent'));
  const [observation, setObservation] = useState<VisualObservation | null>(null);
  const observationRef = useRef<VisualObservation | null>(null);
  observationRef.current = observation;

  const stopCameraStream = useCallback(() => {
    observerRef.current?.stop();
    observerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setObservation(null);
  }, []);

  const startCameraStream = useCallback(async () => {
    if (streamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('blocked');
      return;
    }
    setCamera('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play().catch(() => {});
        observerRef.current = new CameraObserver(v, { onObservation: setObservation });
        void observerRef.current.start();
      }
      setCamera('on');
    } catch {
      setCamera('blocked');
    }
  }, []);

  const attachVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      if (el && streamRef.current) {
        el.srcObject = streamRef.current;
        void el.play().catch(() => {});
        if (!observerRef.current) {
          observerRef.current = new CameraObserver(el, { onObservation: setObservation });
          void observerRef.current.start();
        }
      } else if (!el) {
        // The console is not on screen: release the camera.
        stopCameraStream();
        setCamera((c) => (c === 'on' || c === 'starting' ? 'off' : c));
      }
    },
    [stopCameraStream]
  );

  // Camera on by default once consented, whenever the self-view is on screen.
  useEffect(() => {
    if (prefs.cameraConsent && prefs.cameraOn && camera === 'off' && videoRef.current) void startCameraStream();
  }, [prefs.cameraConsent, prefs.cameraOn, camera, startCameraStream]);

  const enableCamera = useCallback(async () => {
    updatePrefs({ cameraOn: true });
    await startCameraStream();
  }, [startCameraStream, updatePrefs]);
  const disableCamera = useCallback(() => {
    updatePrefs({ cameraOn: false });
    stopCameraStream();
    setCamera('off');
  }, [stopCameraStream, updatePrefs]);
  const grantCameraConsent = useCallback(async () => {
    updatePrefs({ cameraConsent: true, cameraOn: true });
    await startCameraStream();
  }, [startCameraStream, updatePrefs]);

  useEffect(() => () => stopCameraStream(), [stopCameraStream]);

  // ── Earth reports ──────────────────────────────────────────────────────────
  const reports = serverBacked ? serverReports : localReports;

  const refreshReports = useCallback(async () => {
    if (!serverBacked || !canReadActiveCrew) return;
    try {
      const { reports: mine } = await earthApi.mine(crewId);
      setServerReports(mine);
      // Replies that have arrived join the conversation once.
      const seen = new Set(sessionRef.current.seenReplyIds);
      const fresh = mine.filter((r) => r.reply?.arrived && !seen.has(r.id));
      if (fresh.length) {
        setMessages((prev) => [
          ...prev,
          ...fresh.map<AssistantMessage>((r) => ({
            id: uid(),
            role: 'earth',
            author: r.reply!.author,
            content: r.reply!.text,
            timestampIso: r.reply!.arrivesAtIso,
          })),
        ]);
        setSession((s) => ({ ...s, seenReplyIds: [...s.seenReplyIds, ...fresh.map((r) => r.id)].slice(-200) }));
      }
    } catch {
      // try again on the next poll
    }
  }, [serverBacked, canReadActiveCrew, crewId, setMessages, setSession]);

  useEffect(() => {
    void refreshReports();
    if (!serverBacked) return undefined;
    const t = setInterval(() => void refreshReports(), 15_000);
    return () => clearInterval(t);
  }, [refreshReports, serverBacked]);

  const buildBehavioral = useCallback(
    (crewNote?: string): BehavioralHealthReport | null => {
      const a = sessionRef.current.assessment;
      if (!a) return null;
      return {
        assessment: a,
        countermeasures: sessionRef.current.countermeasures.map((c) => ({ id: c.suggestion.id, title: c.suggestion.title, suggestedAtIso: c.suggestedAtIso, helped: c.helped })),
        history: [...assessmentHistory, a].slice(-14).map((h) => ({ atIso: h.assessedAtIso, concernLevel: h.concernLevel, score: h.score })),
        crewNote,
      };
    },
    [assessmentHistory]
  );

  const sendReport = useCallback<AssistantContextValue['sendReport']>(
    async ({ urgency, kind, note, crewNote }) => {
      const base = queueEarthPacket(note);
      const payload: EarthTelemetryPacket = {
        ...base,
        urgency,
        kind,
        behavioralHealth: buildBehavioral(crewNote),
        visualObservation: observationRef.current,
        crewNotes: [note, crewNote].filter(Boolean).join('\n\n'),
      };
      const summary = note.slice(0, 1200);
      const t = tierRef.current;
      const eta = formatEta(t.oneWaySec);
      try {
        let report: EarthReport;
        if (serverBacked) {
          report = (await earthApi.send(crewId, { urgency, kind, summary, payload, locationId: spaceLocation.id })).report;
          setServerReports((prev) => [report, ...prev]);
        } else {
          const created = new Date();
          report = {
            id: payload.packetId,
            astronautId: crewId,
            createdAtIso: created.toISOString(),
            urgency,
            kind,
            summary,
            oneWayDelaySec: t.oneWaySec,
            deliverAtIso: new Date(created.getTime() + t.oneWaySec * 1000).toISOString(),
            delivered: t.oneWaySec < 1,
            payload,
            reply: null,
          };
          setLocalReports((prev) => {
            const next = [report, ...prev].slice(0, 50);
            writeOne(LOCAL_REPORTS_KEY, crewId, next);
            return next;
          });
        }
        setLastReportNotice(`Report sent to Earth${urgency === 'immediate_emergency_packet' ? ' (emergency)' : ''}. Arrives in ${eta}.`);
        return report;
      } catch {
        setLastReportNotice('Could not send the report. It is saved here; try again.');
        return null;
      }
    },
    [queueEarthPacket, buildBehavioral, serverBacked, crewId, spaceLocation.id]
  );

  // ── Actions ────────────────────────────────────────────────────────────────
  const startEmergency = useCallback(
    (protocolId: RedFlagProtocolId, reason = 'Started by crew') => {
      const protocol = EMERGENCY_PROTOCOLS.find((p) => p.id === protocolId);
      if (!protocol) return;
      if (emergencyRef.current?.protocolId === protocolId) return;
      setEmergency({ protocolId, title: protocol.title, steps: protocol.steps, startedAtIso: new Date().toISOString(), reason, completed: {} });
      setEmergencyPickerOpen(false);
      setActiveTab('console');
    },
    [setEmergency, setActiveTab]
  );
  const toggleEmergencyStep = useCallback(
    (n: number) => {
      const run = emergencyRef.current;
      if (!run) return;
      const completed = { ...run.completed };
      if (completed[n]) delete completed[n];
      else completed[n] = new Date().toISOString();
      setEmergency({ ...run, completed });
    },
    [setEmergency]
  );
  const endEmergency = useCallback(() => {
    const run = emergencyRef.current;
    if (run) {
      const log = run.steps.map((s, i) => `${run.completed[i + 1] ? `done ${new Date(run.completed[i + 1]).toLocaleTimeString()}` : 'not done'}: ${s}`).join('\n');
      void sendReport({ urgency: 'priority_packet', kind: 'emergency', note: `Emergency protocol closed: ${run.title}. Started ${new Date(run.startedAtIso).toLocaleTimeString()} (${run.reason}).\n${log}` });
    }
    setEmergency(null);
  }, [setEmergency, sendReport]);

  const toggleGuidedStep = useCallback(
    (n: number) =>
      setSession((s) =>
        s.guidedSteps
          ? { ...s, guidedSteps: { ...s.guidedSteps, completed: s.guidedSteps.completed.includes(n) ? s.guidedSteps.completed.filter((x) => x !== n) : [...s.guidedSteps.completed, n] } }
          : s
      ),
    [setSession]
  );
  const clearGuidedSteps = useCallback(() => setSession((s) => ({ ...s, guidedSteps: null })), [setSession]);

  const rateCountermeasure = useCallback(
    (id: string, helped: boolean) => setSession((s) => ({ ...s, countermeasures: s.countermeasures.map((c) => (c.suggestion.id === id ? { ...c, helped } : c)) })),
    [setSession]
  );
  const dismissCountermeasure = useCallback(
    (id: string) => setSession((s) => ({ ...s, countermeasures: s.countermeasures.map((c) => (c.suggestion.id === id && c.helped === undefined ? { ...c, helped: false } : c)) })),
    [setSession]
  );

  const applyAction = useCallback(
    (action: AssistantAction, messageId?: string) => {
      if (messageId) {
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, actions: [...(m.actions ?? []), action] } : m)));
      }
      switch (action.type) {
        case 'start_emergency_protocol':
          startEmergency(action.protocolId, action.reason);
          break;
        case 'mark_step_done': {
          const run = emergencyRef.current;
          if (run) {
            if (!run.completed[action.stepNumber]) setEmergency({ ...run, completed: { ...run.completed, [action.stepNumber]: new Date().toISOString() } });
          } else {
            setSession((s) => (s.guidedSteps && !s.guidedSteps.completed.includes(action.stepNumber) ? { ...s, guidedSteps: { ...s.guidedSteps, completed: [...s.guidedSteps.completed, action.stepNumber] } } : s));
          }
          break;
        }
        case 'log_checkin_reading':
          if (action.ok && isMetricId(action.metricId) && Number.isFinite(action.value)) {
            void logVitalReading((action.zoneId ?? 'cardio') as BodyZoneId, action.metricId as MetricId, action.value).catch(() =>
              setError('The reading could not be saved.')
            );
          }
          break;
        case 'set_guided_steps':
          setSession((s) => ({ ...s, guidedSteps: { title: action.title, steps: action.steps, completed: [] } }));
          break;
        case 'suggest_countermeasure':
          setSession((s) =>
            s.countermeasures.some((c) => c.suggestion.id === action.suggestion.id && c.helped === undefined)
              ? s
              : { ...s, countermeasures: [...s.countermeasures, { suggestion: action.suggestion, suggestedAtIso: new Date().toISOString() }].slice(-12) }
          );
          break;
        case 'request_visual_check':
          setCloseUpRequest(action.target);
          if (prefsRef.current.cameraConsent && !streamRef.current) void startCameraStream();
          break;
        case 'queue_earth_packet': {
          const kind: EarthReportKind =
            action.urgency === 'immediate_emergency_packet' && emergencyRef.current ? 'emergency' : action.note.startsWith('Behavioural health') ? 'behavioral' : 'medical';
          void sendReport({ urgency: action.urgency, kind, note: action.note });
          if (kind === 'behavioral') setSession((s) => ({ ...s, lastReportedConcern: s.assessment?.concernLevel ?? s.lastReportedConcern }));
          break;
        }
      }
    },
    [setMessages, startEmergency, setEmergency, setSession, logVitalReading, startCameraStream, sendReport]
  );

  // A life-threatening reading opens the matching protocol and tells Earth at once.
  const handledThreats = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = (mission.lifeThreats ?? []).filter((t) => !handledThreats.current.has(t.key));
    if (!fresh.length) return;
    fresh.forEach((t) => handledThreats.current.add(t.key));
    const first = fresh[0];
    const protocolId: RedFlagProtocolId = first.metricId === 'cabin_co2' ? 'co2' : first.metricId === 'rad_dose' ? 'radiation' : 'medical';
    if (!emergencyRef.current) startEmergency(protocolId, `${first.label} ${first.value} ${first.unit}`);
    void sendReport({
      urgency: 'immediate_emergency_packet',
      kind: 'emergency',
      note: `Life-threatening reading: ${fresh.map((t) => `${t.label} ${t.value} ${t.unit}`).join(', ')}. ${first.action}`,
    });
  }, [mission.lifeThreats, startEmergency, sendReport]);

  const acceptAssessment = useCallback(
    (a: MentalStateAssessment) => {
      const prev = sessionRef.current.assessment;
      setSession((s) => ({ ...s, assessment: a }));
      setAssessmentHistory((h) => [...h, a].slice(-60));
      if (serverBacked && canReadActiveCrew && (!prev || prev.concernLevel !== a.concernLevel || Math.abs(prev.score - a.score) >= 5)) {
        void earthApi.saveAssessment(crewId, a).catch(() => {});
      }
      // Daily digest for the doctors when nothing urgent has gone out.
      const last = sessionRef.current.lastDigestIso;
      if (reportTimingFor(a.concernLevel) === 'digest' && (!last || Date.now() - Date.parse(last) > 24 * 3600_000)) {
        setSession((s) => ({ ...s, lastDigestIso: new Date().toISOString() }));
        void sendReport({ urgency: 'routine_downlink', kind: 'digest', note: `Daily check-in digest. ${a.summary}` });
      }
    },
    [setSession, serverBacked, canReadActiveCrew, crewId, sendReport]
  );

  // ── Request building ───────────────────────────────────────────────────────
  const buildRequest = useCallback(
    (thread: AssistantMessage[], modality: AssistantModality, frame?: { base64Data: string; mimeType: string }): ConverseRequest => {
      const t = tierRef.current;
      const run = emergencyRef.current;
      const s = sessionRef.current;
      const turns = COMM_TIER_PROFILES[t.effective].historyTurns;
      return {
        ...crewContext,
        messages: thread
          .filter((m) => !m.streaming && m.content.trim())
          .slice(-turns)
          .map((m) => ({ role: m.role, content: m.content.slice(0, 6000), timestampIso: m.timestampIso })),
        modality,
        tierOverride: t.effective,
        frame,
        observation: observationRef.current?.facePresent ? observationRef.current : undefined,
        activeProtocol: run
          ? { protocolId: run.protocolId, title: run.title, steps: run.steps, completedSteps: Object.keys(run.completed).map(Number) }
          : undefined,
        guidedSteps: s.guidedSteps?.steps,
        checkIns: wellbeingCheckIns.slice(-30),
        previousAssessment: s.assessment ?? undefined,
        countermeasureLog: s.countermeasures.map((c) => ({ id: c.suggestion.id, title: c.suggestion.title, helped: c.helped })),
      };
    },
    [crewContext, wellbeingCheckIns]
  );

  /** Answer from the HUD alone when the ARGUS server cannot be reached at all. */
  const offlineTurn = useCallback(
    (thread: AssistantMessage[], text: string): { reply: string; actions: AssistantAction[]; assessment: MentalStateAssessment } => {
      const s = sessionRef.current;
      const userMessages = thread.filter((m) => m.role === 'user').map((m) => m.content);
      const assessment = combineAssessment({ userMessages, observation: observationRef.current, physiology: { behavioralStatus: zoneStatuses.behavioral }, previous: s.assessment });
      const flags = detectRedFlags(text);
      const actions: AssistantAction[] = [];
      if (flags.flagged && flags.protocolId && emergencyRef.current?.protocolId !== flags.protocolId) {
        actions.push({ origin: 'fast_path', type: 'start_emergency_protocol', protocolId: flags.protocolId, reason: `Detected: ${flags.matched.slice(0, 2).join(', ')}` });
        actions.push({ origin: 'fast_path', type: 'queue_earth_packet', urgency: 'immediate_emergency_packet', note: `Red flag in conversation: "${text.slice(0, 300)}"` });
      } else if (assessment.concernLevel !== 'none') {
        const pick = pickCountermeasure(assessment.cues, s.countermeasures.map((c) => c.suggestion.id));
        if (pick) actions.push({ origin: 'fast_path', type: 'suggest_countermeasure', suggestion: pick });
        if (shouldAutoReport(assessment.concernLevel, s.lastReportedConcern)) {
          actions.push({ origin: 'fast_path', type: 'queue_earth_packet', urgency: urgencyForConcern(assessment.concernLevel), note: `Behavioural health: ${assessment.summary}` });
        }
      }
      const reply = generateOfflineCompanionReply(text, {
        crewMember: activeCrewMember,
        environment,
        scenarioId,
        readinessScore,
        zoneStatuses,
        zones,
        checkIns: scenarioCheckIns,
        commDelay: formatEta(tierRef.current.oneWaySec),
      }).text;
      return { reply, actions, assessment };
    },
    [activeCrewMember, environment, scenarioId, readinessScore, zoneStatuses, zones, scenarioCheckIns]
  );

  // ── Sending a turn (relay / on-ship, and typed messages) ───────────────────
  const abortRef = useRef<AbortController | null>(null);
  const liveRef = useRef<LiveSession | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    speechRef.current?.cancel();
    liveRef.current?.interrupt();
    setStatus((s) => (s === 'listening' ? s : 'idle'));
  }, []);

  const interrupt = useCallback(() => {
    speechRef.current?.cancel();
    liveRef.current?.interrupt();
  }, []);

  const send = useCallback<AssistantContextValue['send']>(
    async (rawText, opts = {}) => {
      const text = rawText.trim();
      if (!text) return;
      const modality = opts.modality ?? 'text';
      setError(null);
      setInterim('');

      // A live session answers typed messages too, in the same voice.
      if (liveRef.current?.isOpen && !opts.withCloseUp) {
        speechRef.current?.cancel();
        setMessages((prev) => [...prev, { id: uid(), role: 'user', content: text, timestampIso: new Date().toISOString(), modality, tier: 'live' }]);
        liveRef.current.sendText(text);
        setStatus('thinking');
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      speechRef.current?.cancel();

      const t = tierRef.current.effective;
      const userMsg: AssistantMessage = { id: uid(), role: 'user', content: text, timestampIso: new Date().toISOString(), modality, tier: t };
      const replyId = uid();
      const thread = [...messagesRef.current, userMsg];
      setMessages(() => [...thread, { id: replyId, role: 'assistant', content: '', timestampIso: new Date().toISOString(), streaming: true, tier: t }]);
      setStatus('thinking');

      // Camera frame with the turn (relay and on-ship tiers send stills, not a stream).
      const video = videoRef.current;
      const profile = COMM_TIER_PROFILES[t];
      const wantFrame = opts.withCloseUp || (prefsRef.current.cameraConsent && streamRef.current && observationRef.current?.facePresent);
      const frameData = wantFrame && video ? captureFrame(video, opts.withCloseUp ? Math.max(profile.frameMaxEdgePx, 768) : profile.frameMaxEdgePx) : null;
      const frame = frameData ? { base64Data: frameData, mimeType: 'image/jpeg' } : undefined;

      const speak = prefsRef.current.speak;
      if (speak) speechRef.current?.begin();
      const started = performance.now();
      let gotFirst = false;
      setLatency({ firstTokenMs: null, firstAudioMs: null });

      const onEvent = (e: ConverseEvent) => {
        if (controller.signal.aborted) return;
        switch (e.type) {
          case 'meta':
            setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, meta: e.meta, tier: e.tier, crisis: e.crisis } : m)));
            break;
          case 'action':
            applyAction(e.action, replyId);
            break;
          case 'delta':
            if (!gotFirst) {
              gotFirst = true;
              setLatency((l) => ({ ...l, firstTokenMs: Math.round(performance.now() - started) }));
              setStatus(speak ? 'speaking' : 'thinking');
            }
            setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, content: m.content + e.text } : m)));
            if (speak) speechRef.current?.push(e.text);
            break;
          case 'reply_end':
            if (speak) speechRef.current?.end();
            setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, streaming: false } : m)));
            break;
          case 'assessment':
            acceptAssessment(e.assessment);
            break;
          case 'error':
            setError(e.message);
            break;
          default:
            break;
        }
      };

      try {
        await streamConverse(buildRequest(thread, modality, frame), onEvent, { runtimeApiKey: runtimeKeyRef.current, signal: controller.signal });
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, streaming: false } : m)).filter((m) => m.id !== replyId || m.content));
          return;
        }
        // No ARGUS server: the HUD's own onboard brain answers.
        const offline = offlineTurn(thread, text);
        setMessages((prev) =>
          prev.map((m) => (m.id === replyId ? { ...m, content: offline.reply, streaming: false, meta: { source: 'offline_verified_cache' }, tier: 'autonomous' } : m))
        );
        offline.actions.forEach((a) => applyAction(a, replyId));
        acceptAssessment(offline.assessment);
        if (speak) {
          speechRef.current?.push(offline.reply + ' ');
          speechRef.current?.end();
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setMessages((prev) => prev.map((m) => (m.id === replyId && m.streaming ? { ...m, streaming: false } : m)));
        setStatus((s) => (s === 'listening' || s === 'transcribing' ? s : speechRef.current?.isSpeaking ? 'speaking' : 'idle'));
        if (opts.withCloseUp) setCloseUpRequest(null);
      }
    },
    [setMessages, applyAction, acceptAssessment, buildRequest, offlineTurn]
  );

  // Status follows speech: back to listening/idle when ARGUS stops talking.
  const voiceModeRef = useRef<VoiceMode>('off');
  useEffect(() => {
    if (!speaking) setStatus((s) => (s === 'speaking' ? (voiceModeRef.current === 'conversation' ? 'listening' : 'idle') : s));
    else setStatus((s) => (s === 'thinking' || s === 'idle' || s === 'listening' ? 'speaking' : s));
  }, [speaking]);

  const sendCloseUp = useCallback(async () => {
    const target = closeUpRequest;
    await send(target ? `Here is the close-up you asked for: ${target}.` : 'Here is a close-up.', { withCloseUp: true });
  }, [closeUpRequest, send]);
  const dismissCloseUp = useCallback(() => setCloseUpRequest(null), []);

  // ── Voice: microphone, transcription, live session ─────────────────────────
  const micRef = useRef<MicCapture | null>(null);
  const [voiceMode, setVoiceModeState] = useState<VoiceMode>('off');
  const setVoiceMode = useCallback((m: VoiceMode) => {
    voiceModeRef.current = m;
    setVoiceModeState(m);
  }, []);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const interimRef = useRef('');

  /** Interim captions from the browser recogniser (never in on-ship mode: it may send audio off-ship). */
  const startCaptions = useCallback(() => {
    if (tierRef.current.effective === 'autonomous' || recognitionRef.current) return;
    const Ctor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';
      rec.onresult = (e) => {
        let text = '';
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        interimRef.current = text.trim();
        setInterim(interimRef.current);
      };
      rec.onerror = () => {};
      rec.onend = () => {
        recognitionRef.current = null;
      };
      rec.start();
      recognitionRef.current = rec;
    } catch {
      recognitionRef.current = null;
    }
  }, []);
  const stopCaptions = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  }, []);

  const transcribeAndSend = useCallback(
    async (utterance: Utterance) => {
      stopCaptions();
      setStatus('transcribing');
      const fallback = interimRef.current;
      interimRef.current = '';
      try {
        const env = await assistantApi.stt(
          { ...crewContext, audioBase64: utterance.wavBase64, mimeType: utterance.mimeType, fallbackTranscript: fallback || undefined, tier: tierRef.current.effective, languageCode: 'en-US' },
          runtimeKeyRef.current
        );
        const transcript = env.result.transcript.trim();
        if (transcript) await send(transcript, { modality: 'voice' });
        else setStatus(voiceModeRef.current === 'conversation' ? 'listening' : 'idle');
      } catch {
        if (fallback) await send(fallback, { modality: 'voice' });
        else {
          setError('Could not transcribe that. Try again or type it.');
          setStatus(voiceModeRef.current === 'conversation' ? 'listening' : 'idle');
        }
      }
      if (voiceModeRef.current === 'conversation') startCaptions();
    },
    [crewContext, send, startCaptions, stopCaptions]
  );

  const ensureMic = useCallback(async (): Promise<MicCapture> => {
    if (micRef.current?.active) return micRef.current;
    const mic = new MicCapture({
      onLevel: setMicLevel,
      onFrame: (samples) => liveRef.current?.sendAudio(samples),
      onSpeechStart: () => {
        // Barge-in: the crew member talking over ARGUS stops ARGUS.
        if (speechRef.current?.isSpeaking) speechRef.current.cancel();
        if (voiceModeRef.current === 'conversation') setStatus((s) => (s === 'speaking' || s === 'idle' ? 'listening' : s));
      },
      onUtterance: (u) => {
        if (!liveRef.current?.isOpen) void transcribeAndSend(u);
      },
    });
    await mic.start();
    micRef.current = mic;
    return mic;
  }, [transcribeAndSend]);

  const closeLive = useCallback(() => {
    liveRef.current?.close();
    liveRef.current = null;
    setLiveConnected(false);
  }, []);

  const liveTurnActions = useRef<AssistantAction[]>([]);
  const liveReplyId = useRef<string | null>(null);

  const openLive = useCallback(async (): Promise<boolean> => {
    if (tierRef.current.effective !== 'live') return false;
    const s = sessionRef.current;
    const run = emergencyRef.current;
    let res;
    try {
      res = await assistantApi.liveSession(
        {
          ...crewContext,
          messages: messagesRef.current.filter((m) => !m.streaming).slice(-12).map((m) => ({ role: m.role, content: m.content })),
          tierOverride: tierRef.current.effective,
          voice: prefsRef.current.voices.gemini,
          observation: observationRef.current?.facePresent ? observationRef.current : undefined,
          activeProtocol: run ? { protocolId: run.protocolId, title: run.title, steps: run.steps, completedSteps: Object.keys(run.completed).map(Number) } : undefined,
          guidedSteps: s.guidedSteps?.steps,
          checkIns: wellbeingCheckIns.slice(-30),
          previousAssessment: s.assessment ?? undefined,
          countermeasureLog: s.countermeasures.map((c) => ({ id: c.suggestion.id, title: c.suggestion.title, helped: c.helped })),
        },
        runtimeKeyRef.current
      );
    } catch {
      res = null;
    }
    if (!res?.available || !res.wsUrl) {
      setFailedDown({ tier: 'relay', reason: res?.reason ?? 'Earth live session unavailable.' });
      return false;
    }

    const ensureReply = () => {
      if (liveReplyId.current) return liveReplyId.current;
      const id = uid();
      liveReplyId.current = id;
      setMessages((prev) => [...prev, { id, role: 'assistant', content: '', timestampIso: new Date().toISOString(), streaming: true, tier: 'live', modality: 'voice', meta: { source: 'live_ai', provider: 'gemini', model: res!.model } }]);
      return id;
    };

    const session = new LiveSession(
      { wsUrl: res.wsUrl, setup: res.setup, playbackRate: prefsRef.current.rate },
      {
        onInputTranscript: (text, final) => {
          if (!final) setInterim(text);
        },
        onOutputText: (delta) => {
          const id = ensureReply();
          setStatus('speaking');
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: m.content + delta } : m)));
        },
        onSpeakingChange: (sp) => {
          setSpeaking(sp);
          setSpeechEngine('live');
        },
        onInterrupted: () => setStatus('listening'),
        onToolCall: async (call: LiveToolCall) => {
          const run2 = emergencyRef.current;
          const r = await assistantApi.tool(
            {
              ...crewContext,
              name: call.name,
              args: call.args,
              activeProtocol: run2 ? { protocolId: run2.protocolId, title: run2.title, steps: run2.steps, completedSteps: Object.keys(run2.completed).map(Number) } : undefined,
              guidedSteps: sessionRef.current.guidedSteps?.steps,
            },
            runtimeKeyRef.current
          );
          if (r.action) {
            liveTurnActions.current.push(r.action);
            applyAction(r.action, ensureReply());
          }
          return r.result;
        },
        onTurnComplete: ({ input, output }) => {
          setInterim('');
          const replyId = liveReplyId.current;
          liveReplyId.current = null;
          const already = liveTurnActions.current;
          liveTurnActions.current = [];
          let thread = messagesRef.current;
          // Spoken input arrives as a transcript; typed input was added by `send`.
          if (input && !thread.slice(-3).some((m) => m.role === 'user' && m.content === input)) {
            const userMsg: AssistantMessage = { id: uid(), role: 'user', content: input, timestampIso: new Date().toISOString(), modality: 'voice', tier: 'live' };
            setMessages((prev) => {
              const idx = replyId ? prev.findIndex((m) => m.id === replyId) : -1;
              return idx >= 0 ? [...prev.slice(0, idx), userMsg, ...prev.slice(idx)] : [...prev, userMsg];
            });
            thread = messagesRef.current;
          }
          setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, streaming: false, content: m.content || output } : m)));
          if (!input) return;
          // Mental state, fast-path actions, countermeasure and Earth report for this turn.
          void assistantApi
            .assess({ ...buildRequest(messagesRef.current, 'voice'), assistantReply: output }, runtimeKeyRef.current)
            .then((r) => {
              for (const a of r.actions) {
                if (!already.some((b) => b.type === a.type)) applyAction(a, replyId ?? undefined);
              }
              acceptAssessment(r.assessment);
            })
            .catch(() => {});
          void thread;
        },
        onClose: (reason) => {
          liveRef.current = null;
          setLiveConnected(false);
          setSpeaking(false);
          // Earth live dropped: carry on in relay with the pipeline.
          if (voiceModeRef.current === 'conversation') {
            setFailedDown({ tier: 'relay', reason: `Live link lost (${reason}).` });
            micRef.current?.setHandsFree(true);
            startCaptions();
          }
        },
      }
    );
    try {
      await session.connect();
    } catch (err) {
      setFailedDown({ tier: 'relay', reason: (err as Error).message });
      return false;
    }
    liveRef.current = session;
    setLiveConnected(true);
    return true;
  }, [crewContext, wellbeingCheckIns, setMessages, applyAction, buildRequest, acceptAssessment, startCaptions]);

  // Camera frames to the live session, ~1 fps, and a context note when what it sees changes.
  useEffect(() => {
    if (!liveConnected) return undefined;
    const frameMs = COMM_TIER_PROFILES.live.frameIntervalMs ?? 1000;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || !streamRef.current || !liveRef.current?.isOpen) return;
      const frame = captureFrame(v, COMM_TIER_PROFILES.live.frameMaxEdgePx, 0.6);
      if (frame) liveRef.current.sendFrame(frame);
    }, frameMs);
    return () => clearInterval(t);
  }, [liveConnected]);
  const lastContextNote = useRef('');
  useEffect(() => {
    if (!liveConnected || !observation?.facePresent) return;
    const note = [observation.emotion && observation.emotion.confidence >= 0.35 ? `expression mostly ${observation.emotion.label}` : '', observation.fatigue ? `fatigue ${observation.fatigue}` : '', ...observation.notes]
      .filter(Boolean)
      .join(', ');
    if (note && note !== lastContextNote.current) {
      lastContextNote.current = note;
      liveRef.current?.sendContext(`Camera (on-device, last ${observation.windowSec} s): ${note}.`);
    }
  }, [observation, liveConnected]);

  const startConversation = useCallback(async () => {
    setError(null);
    try {
      const mic = await ensureMic();
      setVoiceMode('conversation');
      setStatus('listening');
      speechRef.current?.cancel();
      if (await openLive()) {
        mic.setHandsFree(false); // the live session does its own turn-taking
      } else {
        mic.setHandsFree(true);
        startCaptions();
      }
    } catch {
      setError('Microphone access was blocked. Allow it in the browser to talk to ARGUS.');
      setVoiceMode('off');
      setStatus('idle');
    }
  }, [ensureMic, openLive, setVoiceMode, startCaptions]);

  const stopConversation = useCallback(() => {
    closeLive();
    stopCaptions();
    micRef.current?.stop();
    micRef.current = null;
    setMicLevel(0);
    setInterim('');
    setVoiceMode('off');
    setStatus((s) => (s === 'listening' || s === 'transcribing' ? 'idle' : s));
  }, [closeLive, stopCaptions, setVoiceMode]);

  const togglePushToTalk = useCallback(async () => {
    setError(null);
    if (voiceModeRef.current === 'conversation') return;
    if (voiceModeRef.current === 'push') {
      const u = micRef.current?.endUtterance() ?? null;
      micRef.current?.stop();
      micRef.current = null;
      setMicLevel(0);
      setVoiceMode('off');
      if (u) await transcribeAndSend(u);
      else {
        stopCaptions();
        if (interimRef.current) {
          const text = interimRef.current;
          interimRef.current = '';
          await send(text, { modality: 'voice' });
        } else setStatus('idle');
      }
      return;
    }
    try {
      speechRef.current?.cancel();
      const mic = await ensureMic();
      mic.setHandsFree(false);
      mic.beginUtterance();
      setVoiceMode('push');
      setStatus('listening');
      interimRef.current = '';
      startCaptions();
    } catch {
      setError('Microphone access was blocked. Allow it in the browser to talk to ARGUS.');
    }
  }, [ensureMic, setVoiceMode, startCaptions, stopCaptions, transcribeAndSend, send]);

  // Leaving the live tier (moved further out, override) ends a live session.
  useEffect(() => {
    if (tier.effective !== 'live' && liveRef.current) {
      closeLive();
      if (voiceModeRef.current === 'conversation') {
        micRef.current?.setHandsFree(true);
        startCaptions();
      }
    }
  }, [tier.effective, closeLive, startCaptions]);

  // Changing crew member ends voice and clears transient state.
  useEffect(() => () => {
    abortRef.current?.abort();
    speechRef.current?.cancel();
    liveRef.current?.close();
    micRef.current?.stop();
  }, [crewId]);

  const previewVoice = useCallback((engine: VoiceEngineId, voiceId: string) => {
    const line = `Hi ${activeCrewMember.callsign}, this is how I sound. I'm here whenever you want to talk.`;
    if (engine === 'browser') {
      speechRef.current?.cancel();
      const u = new SpeechSynthesisUtterance(line);
      const v = window.speechSynthesis?.getVoices().find((x) => x.name === voiceId);
      if (v) u.voice = v;
      u.rate = prefsRef.current.rate;
      window.speechSynthesis?.speak(u);
      return;
    }
    const out = speechRef.current;
    if (!out) return;
    out.cancel();
    out.begin();
    void assistantApi
      .tts({ text: line, voice: voiceId, tier: engine === 'local' ? 'autonomous' : 'relay' }, runtimeKeyRef.current)
      .then((env) => {
        if (env.result.useBrowserSpeechFallback) {
          setError(engine === 'local' ? 'The on-ship voice server is not running.' : 'Earth voices are not available (no key).');
          return;
        }
        void out.playClip(env.result.audioBase64, env.result.mimeType);
      })
      .catch(() => setError('Voice preview failed.'));
  }, [activeCrewMember.callsign]);

  const clearThread = useCallback(async () => {
    stop();
    setMessages(() => []);
    setSession((s) => ({ ...s, guidedSteps: null, countermeasures: s.countermeasures.filter((c) => c.helped === undefined) }));
    if (serverBacked && canReadActiveCrew) await chatHistoryApi.startNew(crewId).catch(() => {});
  }, [stop, setMessages, setSession, serverBacked, canReadActiveCrew, crewId]);

  const value: AssistantContextValue = {
    messages,
    status,
    interim,
    micLevel,
    latency,
    error,
    tier,
    setTierOverride,
    send,
    stop,
    clearThread,
    voiceMode,
    startConversation,
    stopConversation,
    togglePushToTalk,
    liveConnected,
    speechEngine,
    speaking,
    interrupt,
    prefs,
    updatePrefs,
    voices,
    previewVoice,
    camera,
    attachVideo,
    enableCamera,
    disableCamera,
    grantCameraConsent,
    observation,
    closeUpRequest,
    sendCloseUp,
    dismissCloseUp,
    emergency,
    startEmergency,
    toggleEmergencyStep,
    endEmergency,
    emergencyPickerOpen,
    setEmergencyPickerOpen,
    guidedSteps: session.guidedSteps,
    toggleGuidedStep,
    clearGuidedSteps,
    countermeasures: session.countermeasures,
    rateCountermeasure,
    dismissCountermeasure,
    assessment: session.assessment,
    assessmentHistory,
    reports,
    sendReport,
    lastReportNotice,
  };

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
};

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
