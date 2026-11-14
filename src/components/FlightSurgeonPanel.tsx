/**
 * ARGUS — Flight Surgeon tab (specs/02-ui-dashboard.md §2.4)
 * Hazard context + guided checklist (left) · visual self-exam + Earth packet (right).
 * Long explanations live behind ⓘ / "More" to keep the HUD low-text.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Download,
  FileCheck2,
  ListChecks,
  RefreshCw,
  Send,
  ShieldAlert,
  Upload,
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
  } = useMission();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [packetConfirmation, setPacketConfirmation] = useState<string | null>(null);
  const [showPacketModal, setShowPacketModal] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const envMeta = ENVIRONMENT_META[environment];

  useEffect(() => {
    if (!showPacketModal) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowPacketModal(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showPacketModal]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await runUploadedVisualExam(file);
      e.target.value = '';
    }
  };

  const handleQueuePacket = () => {
    const pkt = queueEarthPacket(
      `ARGUS triage packet (${guidance.headline}) — ${completedStepIds.length}/${guidance.guidedSteps.length} countermeasures logged.`
    );
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
      {/* LEFT: context + checklist */}
      <div className="flex min-w-0 flex-col gap-4">
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
      <div className="flex min-w-0 flex-col gap-4">
        <Card
          icon={<Camera className="h-4 w-4" />}
          title="Visual self-exam"
          actions={
            <>
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
            </>
          }
          bodyClassName="px-4 pb-4 space-y-3"
        >
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

        <Card
          icon={<Send className="h-4 w-4" />}
          title="Earth packet"
          actions={
            <InfoTip label="About Earth packets" align="right">
              Bundles readiness, zone status, completed steps, the latest visual exam and recent check-ins for the ground flight
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
