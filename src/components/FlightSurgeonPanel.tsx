/**
 * ARGUS — Flight Surgeon tab (specs/02-ui-dashboard.md §2.4)
 * Hazard context + symptoms Q&A + guided checklist (left)
 * Visual self-exam (webcam/upload) + Earth packet with editable notes (right).
 * Long explanations live behind ⓘ / "More" to keep the HUD low-text.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Camera,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Cpu,
  Download,
  FileCheck2,
  ListChecks,
  MessageSquare,
  Mic,
  MicOff,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Upload,
  Video,
  VideoOff,
  Volume2,
  WifiOff,
  Wrench,
  X,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import type { RagDocKind } from '../types/aiApi';
import { VISUAL_EXAM_SAMPLES } from '../data/telemetryScenarios';
import {
  createRealtimeDoctorSession,
  RealtimeDoctorSession,
  RealtimeDoctorState,
  VOICE_HUD_DISCLAIMER,
} from '../services/realtimeDoctor';
import { ENVIRONMENT_META } from '../utils/triageEngine';
import { formatCommDelay } from '../data/spaceLocations';
import { InfoTip } from './InfoTip';
import { Card } from './ui/Card';
import { StatusPill } from './ui/StatusPill';

const URGENCY_LABEL = {
  routine_downlink: 'Routine downlink',
  priority_packet: 'Priority packet',
  immediate_emergency_packet: 'Send now',
} as const;

const RAG_KIND_LABEL: Record<RagDocKind, string> = {
  emergency_checklist: 'Emergency checklist',
  countermeasure: 'Countermeasure',
  clinical_reference: 'Clinical reference',
  medication: 'Medication',
};

const SYMPTOM_PRESETS = [
  { label: 'SANS / Eye Pressure', text: 'Throbbing headache behind eyes, blurred near vision, and optic disc swelling' },
  { label: 'Hypercapnia / CO₂', text: 'Stuffy cabin air, severe frontal headache, shortness of breath, air hunger' },
  { label: 'Palpitations', text: 'Racing heart rate, fluttering palpitations, and lightheadedness upon movement' },
  { label: 'Spine & Back Pain', text: 'Persistent lumbar back ache, spinal elongation tension, and muscle stiffness' },
  { label: 'Skin Rash & Dosimeter', text: 'Itchy erythematous skin rash on forearms and dosimeter alarm' },
  { label: 'Insomnia & Fatigue', text: 'Severe insomnia, fragmented sleep, and morning cognitive brain fog' },
];

const VOICE_QUICK_UTTERANCES = [
  {
    label: 'Check readiness & vitals',
    utterance: 'Check my current readiness score and zone vitals.',
    syncSymptoms: false,
  },
  {
    label: 'Blurry vision & headache',
    utterance: 'I have a throbbing headache behind my eyes and blurry near vision.',
    syncSymptoms: true,
  },
  {
    label: 'Log HR 68 bpm',
    utterance: 'Log resting heart rate 68 bpm.',
    syncSymptoms: false,
  },
  {
    label: 'High CO₂ & air hunger',
    utterance: 'Cabin air feels stuffy with frontal headache and shortness of breath.',
    syncSymptoms: true,
  },
];

export const FlightSurgeonPanel: React.FC = () => {
  const {
    activeCrewMember,
    scenarioId,
    environment,
    spaceLocationId,
    guidance,
    completedStepIds,
    toggleStepCompleted,
    isSynthesizingAi,
    requestLiveAiGuidance,
    visualExamAnalysis,
    activePreviewImageUrl,
    isAnalyzingVisual,
    runSampleVisualExam,
    runUploadedVisualExam,
    clearVisualExam,
    queuedPackets,
    queueEarthPacket,
    scenarioCheckIns,
    crewSymptoms,
    setCrewSymptoms,
    consultFlightSurgeon,
    runtimeApiKey,
    logVitalReading,
    spaceLocation,
  } = useMission();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [packetConfirmation, setPacketConfirmation] = useState<string | null>(null);
  const [showPacketModal, setShowPacketModal] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const envMeta = ENVIRONMENT_META[environment];

  // ── Real-Time Voice & Video AI Flight Surgeon session (specs/04-ai-backend.md §4.1) ──
  const doctorContext = useMemo(
    () => ({
      crewMember: activeCrewMember,
      scenarioId,
      environment,
      spaceLocationId,
      checkIns: scenarioCheckIns,
      completedStepsCount: completedStepIds.length,
    }),
    [activeCrewMember, scenarioId, environment, spaceLocationId, scenarioCheckIns, completedStepIds.length]
  );

  const sessionRef = useRef<RealtimeDoctorSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = createRealtimeDoctorSession({
      context: doctorContext,
      runtimeApiKey,
      onStateChange: (next) => setDoctorState(next),
      onVitalLogged: (reading) => {
        void logVitalReading(reading.zoneId, reading.metricId, reading.value);
      },
    });
  }
  const [doctorState, setDoctorState] = useState<RealtimeDoctorState>(() =>
    sessionRef.current!.getState()
  );
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const speechRecRef = useRef<{ stop: () => void } | null>(null);
  const videoStreamIntervalRef = useRef<number | null>(null);
  const [voiceDraft, setVoiceDraft] = useState('');
  const [cameraFramesSent, setCameraFramesSent] = useState(0);
  const [openProtocolKey, setOpenProtocolKey] = useState<string | null>(null);

  useEffect(() => {
    sessionRef.current?.updateContext(doctorContext, runtimeApiKey);
  }, [doctorContext, runtimeApiKey]);

  useEffect(() => {
    void sessionRef.current?.syncConnectivity();
    return () => {
      if (videoStreamIntervalRef.current !== null) {
        window.clearInterval(videoStreamIntervalRef.current);
        videoStreamIntervalRef.current = null;
      }
      sessionRef.current?.stopVideoStream();
      sessionRef.current?.interrupt();
      sessionRef.current?.disconnectWebSocket();
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
    };
  }, []);

  const handleToggleOfflineOverride = useCallback(async () => {
    if (!sessionRef.current) return;
    await sessionRef.current.setManualOfflineOverride(!doctorState.manualOfflineOverride);
  }, [doctorState.manualOfflineOverride]);

  const handleRunVoiceUtterance = useCallback(
    async (utterance: string, syncSymptoms = false) => {
      if (!sessionRef.current || !utterance.trim()) return;
      const clean = utterance.trim();
      if (syncSymptoms) {
        setSymptomInput(clean);
        void consultFlightSurgeon(clean);
      }
      await sessionRef.current.runVoiceTurn({ fallbackTranscript: clean });
    },
    [consultFlightSurgeon]
  );

  const stopMicrophoneRecording = useCallback(async () => {
    speechRecRef.current?.stop();
    speechRecRef.current = null;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }

    sessionRef.current?.endAudioStream();

    let audioBase64: string | undefined;
    let audioMimeType = 'audio/webm';
    if (recordedChunksRef.current.length > 0) {
      const blob = new Blob(recordedChunksRef.current, {
        type: recordedChunksRef.current[0]?.type || 'audio/webm',
      });
      audioMimeType = blob.type || 'audio/webm';
      recordedChunksRef.current = [];
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        audioBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      } catch {
        audioBase64 = undefined;
      }
    }

    const spokenText =
      voiceDraft.trim() ||
      doctorState.interimTranscript.trim() ||
      'Check my current readiness score and zone vitals.';
    setVoiceDraft('');
    await sessionRef.current?.runVoiceTurn({
      audioBase64,
      audioMimeType,
      fallbackTranscript: spokenText,
    });
  }, [voiceDraft, doctorState.interimTranscript]);

  const startMicrophoneRecording = useCallback(async () => {
    sessionRef.current?.interrupt();
    recordedChunksRef.current = [];

    // Optional browser SpeechRecognition for instant interim captions
    const win = window as unknown as {
      SpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: new () => {
        continuous: boolean;
        interimResults: boolean;
        lang: string;
        onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        start: () => void;
        stop: () => void;
      };
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (SpeechRec) {
      try {
        const rec = new SpeechRec();
        rec.continuous = false;
        rec.interimResults = true;
        rec.lang = 'en-US';
        rec.onresult = (ev) => {
          const parts: string[] = [];
          for (let i = 0; i < ev.results.length; i++) {
            parts.push(ev.results[i][0]?.transcript || '');
          }
          const combined = parts.join(' ').trim();
          if (combined) setVoiceDraft(combined);
        };
        rec.start();
        speechRecRef.current = rec;
      } catch {
        // Ignore SpeechRecognition errors in unsupported browsers
      }
    }

    if (navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = stream;
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            recordedChunksRef.current.push(ev.data);
          }
        };
        recorder.start(250);
        mediaRecorderRef.current = recorder;
        sessionRef.current?.sendAudioChunk(new Float32Array([0.15, -0.15, 0.2, -0.2]));
        return;
      } catch {
        // Fall through if microphone permission is denied in automated/headless browser
      }
    }

    // If hardware mic isn't available, run the draft or default voice check-in immediately
    await handleRunVoiceUtterance(
      voiceDraft.trim() || 'Check my current readiness score and zone vitals.'
    );
  }, [voiceDraft, handleRunVoiceUtterance]);

  const captureVideoFrameDataUrl = (video: HTMLVideoElement): string | null => {
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return null;
    // Downscale to <=480px wide at 0.65 JPEG quality so frames encode and upload in ~15 KB.
    const maxWidth = 480;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.65);
  };

  const stopCameraStreamToSurgeon = useCallback(() => {
    if (videoStreamIntervalRef.current !== null) {
      window.clearInterval(videoStreamIntervalRef.current);
      videoStreamIntervalRef.current = null;
    }
    setCameraFramesSent(0);
    sessionRef.current?.stopVideoStream();
  }, []);

  const streamCurrentCameraFrameToSurgeon = useCallback(async () => {
    if (!videoRef.current || !sessionRef.current) return;
    if (doctorState.isCameraStreaming) {
      stopCameraStreamToSurgeon();
      return;
    }

    const jpegDataUrl = captureVideoFrameDataUrl(videoRef.current);
    if (!jpegDataUrl) {
      setCameraError('Camera feed is still initializing — try again in a moment.');
      return;
    }
    setCameraError(null);

    const sendFrameAndCount = (dataUrl: string) => {
      sessionRef.current?.sendVideoFrame(dataUrl);
      setCameraFramesSent((n) => n + 1);
    };

    const runFrameTriageTurn = async (dataUrl: string) => {
      const s = sessionRef.current;
      if (!s) return;
      const st = s.getState().stage;
      if (st === 'thinking_llm' || st === 'speaking_tts') return;
      const cleanBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      await s.runVoiceTurn({
        imageBase64: cleanBase64,
        imageMimeType: 'image/jpeg',
        fallbackTranscript: 'Inspect the live camera frame I am streaming for any visible health or ocular findings.',
      });
    };

    sendFrameAndCount(jpegDataUrl);

    if (videoStreamIntervalRef.current === null) {
      let tick = 0;
      videoStreamIntervalRef.current = window.setInterval(() => {
        if (!videoRef.current || !sessionRef.current) return;
        const frame = captureVideoFrameDataUrl(videoRef.current);
        if (!frame) return;
        tick += 1;
        const state = sessionRef.current.getState();
        if (state.mode === 'live-api') {
          sendFrameAndCount(frame);
        } else if (tick % 4 === 0 && state.stage === 'idle') {
          // In on-ship-pipeline mode, send a fresh visual-triage turn every ~6s when idle.
          sendFrameAndCount(frame);
          void runFrameTriageTurn(frame);
        }
      }, 1500);
    }

    if (!doctorState.isConnected && !doctorState.manualOfflineOverride) {
      await sessionRef.current.connectLiveWebSocket();
      const latestFrame = videoRef.current ? captureVideoFrameDataUrl(videoRef.current) : null;
      if (latestFrame && sessionRef.current.getState().mode === 'live-api') {
        sendFrameAndCount(latestFrame);
      }
    }

    await runFrameTriageTurn(jpegDataUrl);
  }, [doctorState.isCameraStreaming, doctorState.isConnected, doctorState.manualOfflineOverride, stopCameraStreamToSurgeon]);

  // Symptom Q&A input state
  const [symptomInput, setSymptomInput] = useState(crewSymptoms);

  useEffect(() => {
    setSymptomInput(crewSymptoms);
  }, [crewSymptoms]);

  // Live webcam state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Editable Earth Packet crew notes
  const defaultNotes = useMemo(() => {
    const parts = [
      `ARGUS triage packet (${guidance.headline}) — ${completedStepIds.length}/${guidance.guidedSteps.length} countermeasures logged.`,
    ];
    if (crewSymptoms.trim()) {
      parts.push(`Crew reported symptoms: "${crewSymptoms.trim()}".`);
    }
    return parts.join(' ');
  }, [guidance.headline, completedStepIds.length, guidance.guidedSteps.length, crewSymptoms]);

  const [crewNotesInput, setCrewNotesInput] = useState(defaultNotes);

  useEffect(() => {
    setCrewNotesInput(defaultNotes);
  }, [defaultNotes]);

  useEffect(() => {
    if (!showPacketModal) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowPacketModal(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showPacketModal]);

  // Camera cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (isCameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [isCameraActive]);

  const stopCamera = () => {
    stopCameraStreamToSurgeon();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Webcam access is not supported in this browser environment. Use image upload instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'environment',
        },
        audio: false,
      });
      streamRef.current = stream;
      setIsCameraActive(true);
    } catch (err) {
      console.warn('[ARGUS Camera] getUserMedia failed:', err);
      setCameraError('Camera access unavailable or permission denied. Please upload an image file instead.');
      stopCamera();
    }
  };

  const captureSnapshot = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(async (blob) => {
      if (blob) {
        const file = new File([blob], `Webcam_Exam_${Date.now()}.jpg`, { type: 'image/jpeg' });
        stopCamera();
        await runUploadedVisualExam(file);
      }
    }, 'image/jpeg', 0.9);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await runUploadedVisualExam(file);
      e.target.value = '';
    }
  };

  const handleSymptomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symptomInput.trim()) return;
    await consultFlightSurgeon(symptomInput.trim());
  };

  const handleClearSymptoms = async () => {
    setSymptomInput('');
    setCrewSymptoms('');
    await consultFlightSurgeon('');
  };

  const handleQueuePacket = () => {
    const pkt = queueEarthPacket(crewNotesInput.trim() || defaultNotes);
    const delay = pkt.commDelayLabel.replace(' ONE-WAY', '');
    const confirmText =
      environment === 'earth_1g'
        ? `${pkt.packetId} logged · On-Site consult`
        : `${pkt.packetId} queued · arrives in ${delay}`;
    setPacketConfirmation(confirmText);
  };

  const handleDownloadLatestPacket = () => {
    if (!queuedPackets.length) return;
    const latest = queuedPackets[0];
    const blob = new Blob([JSON.stringify(latest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${latest.packetId}_ARGUS_Earth_Consult.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const done = completedStepIds.length;
  const total = guidance.guidedSteps.length;
  const isOfflinePipeline = doctorState.mode === 'on-ship-pipeline';
  const latestVoiceTurn = doctorState.turns[0] || null;
  const activeProtocolCitations =
    doctorState.citedProtocols.length > 0
      ? doctorState.citedProtocols
      : latestVoiceTurn?.ragHits ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {/* LEFT: Voice & Video Flight Surgeon + Situation + symptoms + checklist */}
      <div className="flex flex-col gap-4 min-w-0">
        {/* Real-Time Voice & Video AI Flight Surgeon Card (specs/02-ui-dashboard.md §2.4 & specs/04-ai-backend.md §4.1) */}
        <Card
          icon={isOfflinePipeline ? <Cpu className="h-4 w-4" /> : <Radio className="h-4 w-4" />}
          title="Voice & video flight surgeon"
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${
                  isOfflinePipeline
                    ? 'border-status-yellow/50 bg-status-yellow/10 text-status-yellow'
                    : 'border-hud-accent/50 bg-hud-accent/10 text-hud-accent'
                }`}
                aria-label={`Active voice mode: ${
                  isOfflinePipeline
                    ? 'On-Ship Local Flight Surgeon (Autonomous Mode)'
                    : 'Gemini Live API Bidirectional'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isOfflinePipeline ? 'bg-status-yellow' : 'bg-status-green animate-pulse'
                  }`}
                  aria-hidden="true"
                />
                {isOfflinePipeline
                  ? 'On-Ship Local Flight Surgeon (Autonomous Mode)'
                  : 'Gemini Live API · Bidirectional'}
              </span>
              <span className="rounded border border-hud-line bg-hud-bg/80 px-1.5 py-0.5 font-mono text-[10px] text-hud-muted">
                {doctorState.nodeLabel}
              </span>
              <InfoTip label="About voice & video consults" align="right">
                {isOfflinePipeline
                  ? 'Autonomous deep-space mode (on-ship-local): runs a 3-stage sequential pipeline — 1. Listening [STT] → 2. Thinking [Local LLM] → 3. Speaking [TTS]. Deterministic triage and crisis protocols always hold.'
                  : 'Online duplex mode (gemini-live): streams 16 kHz PCM audio and optional JPEG webcam frames over a short-lived ephemeral WebSocket token with barge-in interruption and non-blocking vital tool calls.'}
              </InfoTip>
            </div>
          }
          bodyClassName="px-4 pb-4 space-y-3"
        >
          {/* Simulated Comm Blackout / Offline Mode Switch */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hud-line bg-hud-bg/60 px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <WifiOff
                className={`h-4 w-4 shrink-0 ${
                  doctorState.manualOfflineOverride ? 'text-status-yellow' : 'text-hud-muted'
                }`}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <span className="block text-xs font-medium text-hud-text">
                  Simulated Comm Blackout / Offline Mode
                </span>
                <span className="block text-[11px] text-hud-muted">
                  {doctorState.manualOfflineOverride
                    ? 'Forced On-Ship STT → Local LLM → TTS pipeline (no cloud branding)'
                    : 'Auto-detects Live API vs On-Ship autonomous pipeline'}
                </span>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={doctorState.manualOfflineOverride}
              aria-label="Simulated Comm Blackout / Offline Mode"
              onClick={handleToggleOfflineOverride}
              className={`hud-focus relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                doctorState.manualOfflineOverride
                  ? 'border-status-yellow bg-status-yellow/30'
                  : 'border-hud-line bg-hud-panel'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                  doctorState.manualOfflineOverride
                    ? 'translate-x-5 bg-status-yellow'
                    : 'translate-x-1 bg-hud-muted'
                }`}
              />
            </button>
          </div>

          {/* 3-Stage Pipeline Indicator (STT → Local LLM → TTS) / Duplex Indicator */}
          <div
            className="grid grid-cols-3 gap-1.5"
            role="status"
            aria-label="Voice consultation pipeline stage"
          >
            {[
              {
                key: 'listening_stt',
                label: isOfflinePipeline ? '1. Listening [STT]' : '1. Audio In [16kHz]',
                active:
                  doctorState.stage === 'listening_stt' ||
                  doctorState.stage === 'live_streaming' ||
                  doctorState.isMicActive,
              },
              {
                key: 'thinking_llm',
                label: isOfflinePipeline ? '2. Thinking [Local LLM]' : '2. Triage & Tools',
                active:
                  doctorState.stage === 'thinking_llm' || doctorState.stage === 'tool_calling',
              },
              {
                key: 'speaking_tts',
                label: isOfflinePipeline ? '3. Speaking [TTS]' : '3. Audio Out [24kHz]',
                active: doctorState.stage === 'speaking_tts' || doctorState.isSpeaking,
              },
            ].map((step) => (
              <div
                key={step.key}
                className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-center font-mono text-[11px] transition-colors ${
                  step.active
                    ? 'border-hud-accent bg-hud-accent/15 text-hud-accent font-semibold'
                    : 'border-hud-line bg-hud-bg/40 text-hud-muted'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    step.active ? 'bg-hud-accent animate-pulse' : 'bg-hud-line'
                  }`}
                  aria-hidden="true"
                />
                <span className="truncate">{step.label}</span>
              </div>
            ))}
          </div>

          {/* Primary Voice & Video Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {doctorState.isMicActive ? (
              <button
                type="button"
                onClick={stopMicrophoneRecording}
                className="hud-btn border-status-red/60 bg-status-red/20 text-red-200 hover:bg-status-red/30"
              >
                <MicOff className="h-3.5 w-3.5 text-status-red" aria-hidden="true" />
                Stop & Send Audio
              </button>
            ) : (
              <button
                type="button"
                onClick={startMicrophoneRecording}
                disabled={
                  doctorState.stage === 'listening_stt' || doctorState.stage === 'thinking_llm'
                }
                className="hud-btn-primary text-xs"
              >
                <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                Speak to Surgeon
              </button>
            )}

            <button
              type="button"
              onClick={() => sessionRef.current?.interrupt()}
              disabled={!doctorState.isSpeaking && doctorState.interactionStatus === 'IDLE'}
              aria-label="Interrupt Flight Surgeon speech (barge-in)"
              className="hud-btn text-xs disabled:opacity-40"
            >
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              Barge-in / Stop
            </button>

            <button
              type="button"
              onClick={async () => {
                if (!isCameraActive) {
                  await startCamera();
                } else {
                  await streamCurrentCameraFrameToSurgeon();
                }
              }}
              aria-pressed={doctorState.isCameraStreaming}
              className={`hud-btn text-xs ${
                doctorState.isCameraStreaming ? 'border-hud-accent/70 bg-hud-accent/15 text-hud-accent' : ''
              }`}
              title="Stream live camera frames to the Voice Flight Surgeon for visual triage"
            >
              <Video className="h-3.5 w-3.5 text-hud-accent" aria-hidden="true" />
              {!isCameraActive
                ? 'Video Consult'
                : doctorState.isCameraStreaming
                  ? 'Stop Video Stream'
                  : 'Stream Camera'}
            </button>

            <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-hud-muted">
              <Activity className="h-3.5 w-3.5 text-hud-accent" aria-hidden="true" />
              {doctorState.stage === 'idle' ? 'READY' : doctorState.stage.toUpperCase()}
            </span>
          </div>

          {/* Quick One-Click Spoken Utterances for Hands-Free / Demo Verification */}
          <div className="space-y-1.5">
            <span className="block text-[11px] text-hud-muted">
              Quick voice turns (1-click spoken consult or vital check-in):
            </span>
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label="Quick voice consult utterances"
            >
              {VOICE_QUICK_UTTERANCES.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleRunVoiceUtterance(preset.utterance, preset.syncSymptoms)}
                  disabled={
                    doctorState.stage === 'listening_stt' || doctorState.stage === 'thinking_llm'
                  }
                  className="hud-focus rounded border border-hud-line bg-hud-panel px-2 py-1 text-[11px] text-hud-muted transition-colors hover:border-hud-accent hover:text-hud-accent disabled:opacity-50"
                >
                  “{preset.label}”
                </button>
              ))}
            </div>
          </div>

          {/* Active Tool Calls Pill Strip (`get_crew_snapshot`, `log_checkin_reading`, `lookup_medical_protocol`) */}
          {doctorState.activeToolCalls.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="font-mono text-hud-muted">Tools:</span>
              {doctorState.activeToolCalls.slice(0, 3).map((tc) => (
                <span
                  key={tc.callId}
                  className="inline-flex items-center gap-1 rounded border border-hud-accent/40 bg-hud-accent/10 px-2 py-0.5 font-mono text-[10px] text-hud-accent"
                >
                  {tc.toolName}
                  {tc.loggedReading
                    ? ` (${tc.loggedReading.metricId}=${tc.loggedReading.value})`
                    : tc.ragHits?.length
                      ? ` (${tc.ragHits.length} refs)`
                      : ''}
                </span>
              ))}
            </div>
          )}

          {/* Latest Voice Transcript & Spoken Response */}
          {(doctorState.lastTranscript || doctorState.lastReplyText || latestVoiceTurn) && (
            <div
              className="space-y-2 rounded-lg border border-hud-line bg-hud-bg/70 p-3 text-xs"
              role="status"
              aria-live="polite"
            >
              {(doctorState.lastTranscript || latestVoiceTurn?.transcript) && (
                <p className="text-hud-muted">
                  <span className="font-mono font-semibold text-hud-text">Crew: </span>“
                  {doctorState.lastTranscript || latestVoiceTurn?.transcript}”
                </p>
              )}
              {(doctorState.lastReplyText || latestVoiceTurn?.replyText) && (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-hud-accent">
                      <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {isOfflinePipeline ? 'On-Ship Local Surgeon' : 'Flight Surgeon Live'}:
                    </span>
                    {latestVoiceTurn && <StatusPill status={latestVoiceTurn.triageStatus} />}
                  </div>
                  <p className="leading-relaxed text-hud-text">
                    {doctorState.lastReplyText || latestVoiceTurn?.replyText}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Verified Protocol Citations (specs/02-ui-dashboard.md §2.4 & specs/04-ai-backend.md §4.2) */}
          {activeProtocolCitations.length > 0 && (
            <div
              className="space-y-2 rounded-lg border border-hud-line bg-hud-bg/50 p-3"
              aria-label="Verified protocol citations"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-hud-text">
                  <BookOpen className="h-3.5 w-3.5 text-hud-accent" aria-hidden="true" />
                  Verified protocol citations
                </span>
                <span className="font-mono text-[10px] text-hud-muted">
                  {activeProtocolCitations.length}{' '}
                  {activeProtocolCitations.length === 1 ? 'chunk' : 'chunks'}
                </span>
              </div>
              <ul className="space-y-1.5">
                {activeProtocolCitations.slice(0, 3).map((hit, idx) => {
                  const key = `${hit.documentId}#${hit.heading}#${idx}`;
                  const isOpen = openProtocolKey ? openProtocolKey === key : idx === 0;
                  return (
                    <li
                      key={key}
                      className="rounded-md border border-hud-line bg-hud-panel/70 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => setOpenProtocolKey(isOpen ? '__closed__' : key)}
                        aria-expanded={isOpen}
                        className="hud-focus flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded border border-hud-accent/50 bg-hud-accent/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-hud-accent">
                              {hit.sourceId ?? 'IN-REPO'}
                            </span>
                            <span className="rounded border border-hud-line bg-hud-bg/80 px-1.5 py-0.5 font-mono text-[10px] text-hud-muted">
                              {RAG_KIND_LABEL[hit.kind] ?? hit.kind}
                            </span>
                          </div>
                          <span className="mt-1 block truncate font-medium text-hud-text">
                            {hit.title} — {hit.heading}
                          </span>
                        </div>
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 text-hud-muted transition-transform ${
                            isOpen ? 'rotate-180' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                      {isOpen && (
                        <div className="space-y-1.5 border-t border-hud-line px-2.5 py-2 text-xs leading-relaxed text-hud-text/90">
                          <p className="whitespace-pre-line">{hit.content}</p>
                          {hit.origin && (
                            <p className="font-mono text-[10px] text-hud-muted">
                              Source: {hit.origin}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Required Clinical Framing Guardrail */}
          <p className="flex items-center justify-between text-[11px] text-hud-muted">
            <span>{VOICE_HUD_DISCLAIMER}</span>
            <span className="font-mono text-[10px]">
              Deterministic triage · {envMeta.shortLabel}
            </span>
          </p>
        </Card>

        <Card
          icon={<ShieldAlert className="h-4 w-4" />}
          title="Situation"
          actions={
            <>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] ${
                  guidance.source === 'live_ai' ? 'border-hud-accent/50 text-hud-accent' : 'border-hud-line text-hud-muted'
                }`}
              >
                {guidance.source === 'live_ai' ? 'Live AI' : 'Offline protocol'}
              </span>
              <button
                type="button"
                onClick={requestLiveAiGuidance}
                disabled={isSynthesizingAi}
                aria-label="Refresh guidance with Clinical AI"
                title="Refresh with Clinical AI (needs key)"
                className="hud-focus rounded-lg border border-hud-line p-1.5 text-hud-muted hover:text-hud-accent disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isSynthesizingAi ? 'animate-spin' : ''}`} />
              </button>
            </>
          }
          bodyClassName="px-4 pb-4 space-y-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={guidance.triageStatus} size="md" />
            <span className="rounded-full border border-hud-line px-2.5 py-1 text-xs text-hud-muted">
              {URGENCY_LABEL[guidance.earthConsultUrgency]}
            </span>
          </div>
          <h3 className="text-base font-semibold leading-snug text-hud-text">{guidance.headline}</h3>
          <div>
            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              aria-expanded={showMore}
              className="hud-focus inline-flex items-center gap-1 rounded text-xs text-hud-accent"
            >
              {showMore ? 'Less' : 'What this means'}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMore ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {showMore && (
              <div className="mt-2 space-y-2 text-sm leading-relaxed text-hud-text/90">
                <p>{guidance.plainLanguageExplanation}</p>
                <p className="flex items-start gap-1.5 text-xs text-hud-muted">
                  <span className="shrink-0 font-medium text-hud-accent">{envMeta.shortLabel} mechanism</span>
                  {guidance.hazardContextSummary}
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Crew Symptom & Clinical Q&A Card */}
        <Card
          icon={<MessageSquare className="h-4 w-4" />}
          title="Crew symptoms & clinical Q&A"
          actions={
            crewSymptoms ? (
              <button
                type="button"
                onClick={handleClearSymptoms}
                className="hud-focus flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-hud-muted hover:text-hud-text"
                title="Reset symptoms to scenario baseline"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            ) : undefined
          }
          bodyClassName="px-4 pb-4 space-y-3"
        >
          <p className="text-xs text-hud-muted">
            During comm blackouts, report real-time symptoms or clinical queries for deterministic offline triage or live AI guidance.
          </p>
          <form onSubmit={handleSymptomSubmit} className="space-y-2">
            <textarea
              rows={2}
              value={symptomInput}
              onChange={(e) => setSymptomInput(e.target.value)}
              placeholder="Describe symptoms (e.g., headache behind eyes, blurry vision, palpitations, back ache, skin rash)..."
              className="hud-focus w-full rounded-lg border border-hud-line bg-hud-bg/80 p-2.5 text-xs text-hud-text placeholder-hud-muted focus:border-hud-accent"
              aria-label="Astronaut symptoms and clinical questions"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1" role="group" aria-label="Symptom presets">
                {SYMPTOM_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={async () => {
                      setSymptomInput(preset.text);
                      await consultFlightSurgeon(preset.text);
                    }}
                    disabled={isSynthesizingAi}
                    className="rounded border border-hud-line bg-hud-panel px-2 py-0.5 text-[10px] text-hud-muted transition-colors hover:border-hud-accent hover:text-hud-accent disabled:opacity-50"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <button
                type="submit"
                disabled={isSynthesizingAi || !symptomInput.trim()}
                className="hud-btn-primary ml-auto text-xs"
              >
                <Sparkles className={`h-3.5 w-3.5 ${isSynthesizingAi ? 'animate-spin' : ''}`} aria-hidden="true" />
                {isSynthesizingAi ? 'Analyzing…' : 'Consult Surgeon'}
              </button>
            </div>
          </form>
        </Card>

        {/* Guided Countermeasure Checklist */}
        <Card
          icon={<ListChecks className="h-4 w-4" />}
          title="Steps"
          actions={
            <span className="font-mono text-xs text-hud-muted" aria-label={`${done} of ${total} steps done`}>
              {done}/{total}
            </span>
          }
          bodyClassName="px-4 pb-4"
        >
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-hud-line" aria-hidden="true">
            <div className="h-full rounded-full bg-status-green transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>
          <ol className="space-y-2">
            {guidance.guidedSteps.map((step) => {
              const isDone = completedStepIds.includes(step.id);
              const open = openStep === step.id;
              return (
                <li key={step.id} className={`rounded-lg border ${isDone ? 'border-status-green/40 bg-status-green/5' : 'border-hud-line bg-hud-bg/50'}`}>
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isDone}
                      aria-label={`${step.title}: mark ${isDone ? 'not done' : 'done'}`}
                      onClick={() => toggleStepCompleted(step.id)}
                      className="hud-focus rounded-full p-1"
                    >
                      {isDone ? (
                        <CheckCircle2 className="h-5 w-5 text-status-green" aria-hidden="true" />
                      ) : (
                        <Circle className="h-5 w-5 text-hud-muted" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenStep(open ? null : step.id)}
                      aria-expanded={open}
                      className="hud-focus flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left"
                    >
                      <span className={`flex-1 text-sm ${isDone ? 'text-hud-muted line-through' : 'text-hud-text'}`}>
                        {step.stepNumber}. {step.title}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-hud-muted">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {step.estimatedMinutes}m
                      </span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-hud-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                  </div>
                  {open && (
                    <div className="space-y-1.5 border-t border-hud-line px-3 py-2 text-sm leading-relaxed text-hud-text/90">
                      <p>{step.plainInstruction}</p>
                      <p className="flex items-center gap-1.5 text-xs text-hud-muted">
                        <Wrench className="h-3 w-3" aria-hidden="true" />
                        {step.hardwareRequired}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      </div>

      {/* RIGHT: visual exam + Earth packet */}
      <div className="flex flex-col gap-4 min-w-0">
        <Card
          icon={<Camera className="h-4 w-4" />}
          title="Visual self-exam"
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              {isCameraActive ? (
                <button
                  type="button"
                  onClick={stopCamera}
                  className="hud-btn text-status-yellow hover:text-white"
                  title="Close webcam video feed"
                >
                  <VideoOff className="h-3.5 w-3.5" aria-hidden="true" />
                  Close Camera
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startCamera}
                  className="hud-btn text-hud-accent hover:text-white"
                  title="Open live camera for real-time exam snapshot"
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                  Live Camera
                </button>
              )}
              <button type="button" onClick={() => fileInputRef.current?.click()} className="hud-btn">
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                Upload
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
                className="hidden"
                aria-label="Upload exam image"
              />
            </div>
          }
          bodyClassName="px-4 pb-4 space-y-3"
        >
          {cameraError && (
            <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-status-yellow/40 bg-status-yellow/10 px-3 py-2 text-xs text-yellow-200">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 shrink-0 text-status-yellow" aria-hidden="true" />
                {cameraError}
              </span>
              <button
                type="button"
                onClick={() => setCameraError(null)}
                className="hud-focus rounded p-1 text-yellow-200 hover:text-white"
                aria-label="Dismiss camera alert"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {isCameraActive && (
            <div className="space-y-2 rounded-lg border border-hud-accent/50 bg-hud-bg/80 p-3">
              <div className="relative aspect-video w-full overflow-hidden rounded-md border border-hud-line bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                  aria-label="Live webcam viewfinder"
                />
                <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1.5">
                  <div className="flex items-center gap-1.5 rounded-full bg-slate-950/80 px-2 py-0.5 text-[10px] font-mono text-status-green">
                    <span className="h-1.5 w-1.5 rounded-full bg-status-green animate-pulse" />
                    LIVE OPTICAL FEED
                  </div>
                  {doctorState.isCameraStreaming && (
                    <div
                      role="status"
                      className="flex items-center gap-1.5 rounded-full border border-hud-accent/60 bg-slate-950/85 px-2 py-0.5 text-[10px] font-mono text-hud-accent"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-hud-accent animate-pulse" />
                      {doctorState.stage === 'thinking_llm'
                        ? 'SURGEON ANALYZING…'
                        : doctorState.stage === 'speaking_tts'
                          ? 'SURGEON SPEAKING'
                          : `STREAMING (${cameraFramesSent} ${cameraFramesSent === 1 ? 'FRAME' : 'FRAMES'})`}
                    </div>
                  )}
                </div>
              </div>
              {doctorState.isCameraStreaming && (
                <div
                  role="status"
                  className="rounded-md border border-hud-line bg-hud-panel/80 px-2.5 py-2 text-xs text-hud-text"
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-hud-muted">
                    <span>
                      TRANSPORT: {doctorState.mode === 'live-api' ? 'GEMINI LIVE WS' : 'ON-SHIP PIPELINE'}
                    </span>
                    <span>
                      {doctorState.stage === 'thinking_llm'
                        ? 'Analyzing frame…'
                        : doctorState.stage === 'speaking_tts'
                          ? 'Speaking response…'
                          : `${cameraFramesSent} frame${cameraFramesSent === 1 ? '' : 's'} sent`}
                    </span>
                  </div>
                  {doctorState.lastReplyText && (
                    <p className="mt-1 text-xs leading-relaxed text-hud-text">
                      <span className="font-semibold text-hud-accent">Surgeon: </span>
                      {doctorState.lastReplyText}
                    </p>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" onClick={stopCamera} className="hud-btn">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void streamCurrentCameraFrameToSurgeon();
                  }}
                  aria-pressed={doctorState.isCameraStreaming}
                  className={`hud-btn ${
                    doctorState.isCameraStreaming
                      ? 'border-hud-accent/70 bg-hud-accent/15 text-hud-accent hover:text-white'
                      : 'text-hud-accent hover:text-white'
                  }`}
                >
                  <Video className="h-3.5 w-3.5" aria-hidden="true" />
                  {doctorState.isCameraStreaming ? 'Stop Streaming' : 'Stream to Voice Surgeon'}
                </button>
                <button type="button" onClick={captureSnapshot} className="hud-btn-primary">
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                  Capture Snapshot
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Sample images">
            {VISUAL_EXAM_SAMPLES.map((s) => {
              const sel = visualExamAnalysis?.sampleIdOrFileName === s.title;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => runSampleVisualExam(s)}
                  disabled={isAnalyzingVisual}
                  aria-pressed={sel}
                  className={`hud-focus hud-tile overflow-hidden text-left ${sel ? 'hud-tile-selected' : ''}`}
                >
                  <img src={s.previewSvgDataUrl} alt="" className="h-20 w-full bg-hud-bg object-cover" />
                  <span className="block px-2 py-1.5 text-[11px] leading-tight text-hud-text">{s.title}</span>
                </button>
              );
            })}
          </div>

          {isAnalyzingVisual && (
            <p role="status" className="flex items-center gap-2 rounded-lg border border-hud-line px-3 py-2 text-xs text-hud-accent">
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              Analyzing image…
            </p>
          )}

          {visualExamAnalysis && !isAnalyzingVisual && (
            <div className="space-y-2 rounded-lg border border-hud-line bg-hud-bg/50 p-3" role="status">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-hud-text">{visualExamAnalysis.sampleIdOrFileName}</span>
                <span className="flex items-center gap-1">
                  <StatusPill status={visualExamAnalysis.findingStatus} />
                  <InfoTip label="Clinical finding" align="right">
                    <span className="block">{visualExamAnalysis.clinicalSummary}</span>
                    <span className="mt-1 block text-hud-muted">{visualExamAnalysis.modality}</span>
                  </InfoTip>
                  <button
                    type="button"
                    onClick={clearVisualExam}
                    aria-label="Clear exam result"
                    className="hud-focus rounded p-1 text-hud-muted hover:text-hud-text"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
              {activePreviewImageUrl && (
                <img
                  src={activePreviewImageUrl}
                  alt={visualExamAnalysis.sampleIdOrFileName}
                  className="h-36 w-full rounded-md border border-hud-line bg-hud-bg object-contain"
                />
              )}
              <p className="text-sm leading-relaxed text-hud-text/90">{visualExamAnalysis.plainCrewGuidance}</p>
              <p className="text-xs font-medium text-status-green">→ {visualExamAnalysis.recommendedAction}</p>
            </div>
          )}
        </Card>

        {/* Earth Packet Card with Editable Crew Notes */}
        <Card
          icon={<Send className="h-4 w-4" />}
          title={environment === 'earth_1g' ? 'On-site consult' : 'Earth packet'}
          actions={
            <InfoTip label={environment === 'earth_1g' ? 'About clinical consults' : 'About Earth packets'} align="right">
              {environment === 'earth_1g'
                ? 'Bundles readiness, zone status, completed steps, the latest visual exam, recent check-ins, and editable crew clinical notes for the on-site flight surgeon.'
                : `Bundles readiness, zone status, completed steps, the latest visual exam, recent check-ins, and editable crew clinical notes for the ground flight surgeon. One-way delay: ${formatCommDelay(spaceLocation)}.`}
            </InfoTip>
          }
          bodyClassName="px-4 pb-4 space-y-3"
        >
          <ul className="flex flex-wrap gap-2 text-xs text-hud-muted">
            <li className="rounded-full border border-hud-line px-2.5 py-1">{done} steps</li>
            <li className="rounded-full border border-hud-line px-2.5 py-1">{visualExamAnalysis ? '1 exam' : 'No exam'}</li>
            <li className="rounded-full border border-hud-line px-2.5 py-1">{Math.min(scenarioCheckIns.length, 5)} check-ins</li>
          </ul>

          <div className="space-y-1.5">
            <label htmlFor="crew-notes-input" className="flex items-center justify-between text-xs font-medium text-hud-text">
              <span>Crew clinical notes & observations</span>
              <span className="text-[11px] text-hud-muted">Editable before queueing</span>
            </label>
            <textarea
              id="crew-notes-input"
              rows={3}
              value={crewNotesInput}
              onChange={(e) => setCrewNotesInput(e.target.value)}
              placeholder={
                environment === 'earth_1g'
                  ? 'Review or edit clinical notes and remarks for the on-site Flight Surgeon...'
                  : 'Review or edit clinical notes and remarks for the Earth Flight Surgeon...'
              }
              className="hud-focus w-full rounded-lg border border-hud-line bg-hud-bg/80 p-2.5 font-mono text-xs text-hud-text placeholder-hud-muted focus:border-hud-accent"
              aria-label={
                environment === 'earth_1g'
                  ? 'Editable crew notes for on-site consult'
                  : 'Editable crew notes for Earth telemetry packet'
              }
            />
          </div>

          {packetConfirmation && (
            <p role="status" className="flex items-center justify-between gap-2 rounded-lg border border-status-green/40 bg-status-green/10 px-3 py-2 text-xs text-green-200">
              <span className="flex items-center gap-1.5">
                <FileCheck2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                {packetConfirmation}
              </span>
              <button type="button" onClick={() => setShowPacketModal(true)} className="hud-focus rounded underline">
                Inspect
              </button>
            </p>
          )}

          <div className="flex items-center gap-2">
            <button type="button" onClick={handleQueuePacket} className="hud-btn-primary flex-1">
              <Send className="h-4 w-4" aria-hidden="true" />
              {environment === 'earth_1g' ? 'Log on-site consult' : 'Queue packet'}
            </button>
            {queuedPackets.length > 0 && (
              <button type="button" onClick={() => setShowPacketModal(true)} className="hud-btn" aria-label={`Inspect ${queuedPackets.length} queued packets`}>
                {queuedPackets.length}
              </button>
            )}
          </div>
        </Card>
      </div>

      {showPacketModal && queuedPackets.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-hud-bg/80 p-4 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && setShowPacketModal(false)}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="packet-title" className="w-full max-w-xl overflow-hidden rounded-xl border border-hud-line bg-hud-panel shadow-2xl">
            <div className="flex items-center justify-between border-b border-hud-line px-4 py-3">
              <span id="packet-title" className="font-display text-sm font-semibold tracking-wide text-hud-text">
                Latest packet · {queuedPackets[0].packetId}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={handleDownloadLatestPacket} className="hud-btn" autoFocus>
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Export JSON
                </button>
                <button type="button" onClick={() => setShowPacketModal(false)} aria-label="Close" className="hud-focus rounded p-1 text-hud-muted hover:text-hud-text">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <pre className="max-h-[60vh] overflow-auto p-4 font-mono text-[11px] text-hud-text">{JSON.stringify(queuedPackets[0], null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
};
