/**
 * ARGUS — Flight Surgeon tab (specs/02-ui-dashboard.md §2.4)
 * Hazard context + symptoms Q&A + guided checklist (left)
 * Visual self-exam (webcam/upload) + Earth packet with editable notes (right).
 * Long explanations live behind ⓘ / "More" to keep the HUD low-text.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Download,
  FileCheck2,
  ListChecks,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Upload,
  VideoOff,
  Wrench,
  X,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { VISUAL_EXAM_SAMPLES } from '../data/telemetryScenarios';
import { ENVIRONMENT_META } from '../utils/triageEngine';
import { InfoTip } from './InfoTip';
import { Card } from './ui/Card';
import { StatusPill } from './ui/StatusPill';

const URGENCY_LABEL = {
  routine_downlink: 'Routine downlink',
  priority_packet: 'Priority packet',
  immediate_emergency_packet: 'Send now',
} as const;

const SYMPTOM_PRESETS = [
  { label: 'SANS / Eye Pressure', text: 'Throbbing headache behind eyes, blurred near vision, and optic disc swelling' },
  { label: 'Hypercapnia / CO₂', text: 'Stuffy cabin air, severe frontal headache, shortness of breath, air hunger' },
  { label: 'Palpitations', text: 'Racing heart rate, fluttering palpitations, and lightheadedness upon movement' },
  { label: 'Spine & Back Pain', text: 'Persistent lumbar back ache, spinal elongation tension, and muscle stiffness' },
  { label: 'Skin Rash & Dosimeter', text: 'Itchy erythematous skin rash on forearms and dosimeter alarm' },
  { label: 'Insomnia & Fatigue', text: 'Severe insomnia, fragmented sleep, and morning cognitive brain fog' },
];

export const FlightSurgeonPanel: React.FC = () => {
  const {
    environment,
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
    activeCheckIns,
    crewSymptoms,
    setCrewSymptoms,
    consultFlightSurgeon,
  } = useMission();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [packetConfirmation, setPacketConfirmation] = useState<string | null>(null);
  const [showPacketModal, setShowPacketModal] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const envMeta = ENVIRONMENT_META[environment];

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
    setPacketConfirmation(`${pkt.packetId} queued · arrives in ${pkt.commDelayLabel.replace(' ONE-WAY', '')}`);
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

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {/* LEFT: context + symptoms + checklist */}
      <div className="flex flex-col gap-4">
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
      <div className="flex flex-col gap-4">
        <Card
          icon={<Camera className="h-4 w-4" />}
          title="Visual self-exam"
          actions={
            <div className="flex items-center gap-1.5">
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
                <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-slate-950/80 px-2 py-0.5 text-[10px] font-mono text-status-green">
                  <span className="h-1.5 w-1.5 rounded-full bg-status-green animate-pulse" />
                  LIVE OPTICAL FEED
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={stopCamera} className="hud-btn">
                  Cancel
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
          title="Earth packet"
          actions={
            <InfoTip label="About Earth packets" align="right">
              Bundles readiness, zone status, completed steps, the latest visual exam, recent check-ins, and editable crew clinical notes for the ground flight
              surgeon. One-way delay: {envMeta.commDelay.replace(' ONE-WAY', '')}.
            </InfoTip>
          }
          bodyClassName="px-4 pb-4 space-y-3"
        >
          <ul className="flex flex-wrap gap-2 text-xs text-hud-muted">
            <li className="rounded-full border border-hud-line px-2.5 py-1">{done} steps</li>
            <li className="rounded-full border border-hud-line px-2.5 py-1">{visualExamAnalysis ? '1 exam' : 'No exam'}</li>
            <li className="rounded-full border border-hud-line px-2.5 py-1">{Math.min(activeCheckIns.length, 5)} check-ins</li>
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
              placeholder="Review or edit clinical notes and remarks for the Earth Flight Surgeon..."
              className="hud-focus w-full rounded-lg border border-hud-line bg-hud-bg/80 p-2.5 font-mono text-xs text-hud-text placeholder-hud-muted focus:border-hud-accent"
              aria-label="Editable crew notes for Earth telemetry packet"
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
              Queue packet
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
