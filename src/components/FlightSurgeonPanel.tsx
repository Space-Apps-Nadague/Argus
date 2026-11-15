/**
 * ARGUS — Flight Surgeon Clinical Guidance & Earth Consult Panel
 * Single Source of Truth: specs/01-data-schema.md §6 & specs/02-ui-dashboard.md §2.4
 *
 * Provides structured hazard context, guided self-exam steps checklist, visual self-exam
 * triage, editable crew notes, and an accessible compact queued-packet history list with
 * multi-packet inspection and JSON export across blackouts.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Circle,
  Clock,
  Download,
  FileCheck2,
  Files,
  ListChecks,
  MessageSquare,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { VISUAL_EXAM_SAMPLES } from '../data/telemetryScenarios';
import { ENVIRONMENT_META } from '../utils/triageEngine';
import { formatCommDelay } from '../data/spaceLocations';
import type { EarthTelemetryPacket, VisualExamSample } from '../types/argus';
import { InfoTip } from './InfoTip';
import { Card } from './ui/Card';
import { StatusPill } from './ui/StatusPill';

const URGENCY_META = {
  routine_downlink: {
    label: 'Routine',
    icon: FileCheck2,
    badgeClass: 'border-hud-line text-hud-muted bg-hud-line/20',
  },
  priority_packet: {
    label: 'Priority',
    icon: AlertTriangle,
    badgeClass: 'border-status-yellow/50 text-status-yellow bg-status-yellow/10',
  },
  immediate_emergency_packet: {
    label: 'Emergency',
    icon: ShieldAlert,
    badgeClass: 'border-status-red/60 text-red-300 bg-status-red/10',
  },
} as const;

function downloadJsonFile(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const FlightSurgeonPanel: React.FC = () => {
  const {
    activeCrewMember,
    guidance,
    scenarioId,
    environment,
    spaceLocation,
    scenarioCheckIns,
    completedStepIds,
    toggleStepCompleted,
    isSynthesizingAi,
    visualExamAnalysis,
    activePreviewImageUrl,
    isAnalyzingVisual,
    runSampleVisualExam,
    runUploadedVisualExam,
    clearVisualExam,
    queuedPackets,
    queueEarthPacket,
    clearQueuedPackets,
    requestLiveAiGuidance,
    consultFlightSurgeon,
    setCrewSymptoms,
    crewSymptoms,
  } = useMission();

  const [symptomInput, setSymptomInput] = useState(crewSymptoms);
  const [crewNotesInput, setCrewNotesInput] = useState('');
  const [packetConfirmation, setPacketConfirmation] = useState<string | null>(null);
  const [showPacketModal, setShowPacketModal] = useState(false);
  const [selectedPacketId, setSelectedPacketId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync symptoms from MissionContext
  useEffect(() => {
    setSymptomInput(crewSymptoms);
  }, [crewSymptoms]);

  // Keep default notes relevant to current guidance and completed countermeasures
  const defaultNotes = useMemo(() => {
    const total = guidance.guidedSteps.length;
    const done = completedStepIds.length;
    return `ARGUS triage packet (${guidance.headline}) — ${done}/${total} countermeasures logged.${
      crewSymptoms ? ` Symptoms: "${crewSymptoms}".` : ''
    }`;
  }, [guidance.headline, guidance.guidedSteps.length, completedStepIds.length, crewSymptoms]);

  useEffect(() => {
    setCrewNotesInput(defaultNotes);
  }, [defaultNotes]);

  // Escape key closes packet inspection modal
  useEffect(() => {
    if (!showPacketModal) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowPacketModal(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showPacketModal]);

  const handleQueuePacket = () => {
    const pkt = queueEarthPacket(crewNotesInput.trim() || defaultNotes);
    const delay = pkt.commDelayLabel.replace(' ONE-WAY', '');
    const confirmText =
      environment === 'earth_1g'
        ? `${pkt.packetId} logged · On-Site consult`
        : `${pkt.packetId} queued · arrives in ${delay}`;
    setPacketConfirmation(confirmText);
    setSelectedPacketId(pkt.packetId);
  };

  const selectedPacket = useMemo(() => {
    if (!queuedPackets.length) return null;
    return queuedPackets.find((p) => p.packetId === selectedPacketId) ?? queuedPackets[0];
  }, [queuedPackets, selectedPacketId]);

  const handleDownloadPacket = (packet: EarthTelemetryPacket) => {
    downloadJsonFile(packet, `${packet.packetId}_ARGUS_Earth_Consult.json`);
  };

  const handleDownloadAllPackets = () => {
    if (!queuedPackets.length) return;
    const bundle = {
      exportedAtIso: new Date().toISOString(),
      astronaut: activeCrewMember.callsign,
      packetCount: queuedPackets.length,
      packets: queuedPackets,
    };
    downloadJsonFile(bundle, `ARGUS_All_Queued_Packets_${activeCrewMember.id}.json`);
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

  const doneCount = completedStepIds.length;
  const totalSteps = guidance.guidedSteps.length;

  return (
    <div className="space-y-4">
      {/* Top Situation & Clinical Guidance Banner */}
      <Card
        icon={<Radio className="h-4 w-4 text-hud-accent" />}
        title={`Flight Surgeon Guidance · ${activeCrewMember.name} (${activeCrewMember.callsign})`}
        actions={
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-hud-muted">
              {formatCommDelay(spaceLocation)} one-way
            </span>
            <button
              type="button"
              onClick={() => void requestLiveAiGuidance()}
              disabled={isSynthesizingAi}
              className="hud-btn px-2.5 py-1 text-xs"
              aria-label="Synthesize live AI guidance"
            >
              <Sparkles className={`h-3.5 w-3.5 text-hud-accent ${isSynthesizingAi ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>{isSynthesizingAi ? 'Synthesizing…' : 'Synthesize AI'}</span>
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hud-line pb-3">
            <div>
              <div className="flex items-center gap-2">
                <StatusPill status={guidance.triageStatus} />
                <h3 className="font-display text-sm font-semibold tracking-wide text-hud-text">
                  {guidance.headline}
                </h3>
              </div>
              <p className="mt-1 text-xs text-hud-muted">
                Focus Zone: <span className="font-medium text-hud-text capitalize">{guidance.zoneId}</span> ·
                Environment: <span className="font-medium text-hud-text">{ENVIRONMENT_META[environment]?.label ?? environment}</span>
              </p>
            </div>
            <span className="rounded-full border border-hud-line bg-hud-bg/70 px-3 py-1 font-mono text-xs text-hud-text">
              {doneCount}/{totalSteps} countermeasures logged
            </span>
          </div>

          <p className="text-sm leading-relaxed text-hud-text/90">
            {guidance.plainLanguageExplanation}
          </p>
          <div className="rounded-lg border border-hud-line/70 bg-hud-bg/40 p-3 text-xs text-hud-muted">
            <span className="font-semibold text-hud-text">HRP Hazard Context: </span>
            {guidance.hazardContextSummary}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Column: Countermeasure Checklist & Symptoms */}
        <div className="space-y-4 lg:col-span-7">
          {/* Guided Steps Checklist */}
          <Card
            icon={<ListChecks className="h-4 w-4" />}
            title="Step-by-Step Countermeasure Protocol"
            actions={
              <span className="font-mono text-xs text-hud-muted">
                {doneCount} of {totalSteps} complete
              </span>
            }
          >
            {guidance.guidedSteps.length === 0 ? (
              <p className="text-sm text-hud-muted">No prescriptive actions required for current nominal baseline.</p>
            ) : (
              <ul className="space-y-2" aria-label="Countermeasure checklist">
                {guidance.guidedSteps.map((step) => {
                  const isDone = completedStepIds.includes(step.id);
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        onClick={() => toggleStepCompleted(step.id)}
                        aria-pressed={isDone}
                        className={`hud-focus flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                          isDone
                            ? 'border-status-green/30 bg-status-green/5'
                            : 'border-hud-line bg-hud-bg/50 hover:border-slate-600'
                        }`}
                      >
                        <span className="mt-0.5 shrink-0">
                          {isDone ? (
                            <CheckCircle2 className="h-4 w-4 text-status-green" aria-hidden="true" />
                          ) : (
                            <Circle className="h-4 w-4 text-hud-muted" aria-hidden="true" />
                          )}
                        </span>
                        <div className="flex-1 space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className={`text-sm font-medium ${isDone ? 'text-hud-muted line-through' : 'text-hud-text'}`}>
                              {step.stepNumber}. {step.title}
                            </span>
                            <div className="flex items-center gap-1.5 font-mono text-[11px] text-hud-muted">
                              <Clock className="h-3 w-3" aria-hidden="true" />
                              <span>{step.estimatedMinutes}m</span>
                            </div>
                          </div>
                          <p className="text-xs text-hud-muted">{step.hardwareRequired}</p>
                          <p className="text-xs text-hud-muted/90">{step.plainInstruction}</p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Symptom Consultation */}
          <Card
            icon={<MessageSquare className="h-4 w-4" />}
            title="Crew Clinical Symptoms & Subjective Query"
          >
            <form onSubmit={handleSymptomSubmit} className="space-y-3">
              <label htmlFor="symptom-input" className="block text-xs text-hud-muted">
                Describe subjective symptoms (e.g. throbbing headache, blurred vision, palpitations, fatigue) to re-evaluate deterministic spaceflight triage:
              </label>
              <div className="flex gap-2">
                <input
                  id="symptom-input"
                  type="text"
                  value={symptomInput}
                  onChange={(e) => setSymptomInput(e.target.value)}
                  placeholder="e.g. Frontal headache behind eyes, elevated air hunger..."
                  className="hud-input flex-1 py-1.5 text-xs font-sans"
                />
                <button type="submit" className="hud-btn-primary py-1.5 text-xs">
                  Consult
                </button>
                {crewSymptoms && (
                  <button type="button" onClick={() => void handleClearSymptoms()} className="hud-btn py-1.5 text-xs">
                    Clear
                  </button>
                )}
              </div>
            </form>
          </Card>
        </div>

        {/* Right Column: Visual Self-Exam & Earth Telemetry Packet */}
        <div className="space-y-4 lg:col-span-5">
          {/* Visual Self-Exam */}
          <Card
            icon={<Camera className="h-4 w-4" />}
            title="Visual Self-Exam & Computer Vision Triage"
            actions={
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="hud-btn px-2 py-1 text-xs"
                aria-label="Upload ultrasound, retina, or rash image"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                Upload
              </button>
            }
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleFileChange(e)}
            />
            <div className="space-y-3">
              <p className="text-xs text-hud-muted">
                Select a spaceflight clinical sample or upload an ultrasound / retina / rash frame:
              </p>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Clinical sample images">
                {VISUAL_EXAM_SAMPLES.map((s: VisualExamSample) => {
                  const sel = visualExamAnalysis?.sampleIdOrFileName === s.title;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => void runSampleVisualExam(s)}
                      disabled={isAnalyzingVisual}
                      aria-pressed={sel}
                      className={`hud-focus hud-tile overflow-hidden rounded-lg border text-left transition-colors ${
                        sel ? 'border-hud-accent bg-hud-accent/15' : 'border-hud-line bg-hud-bg/60 hover:border-slate-600'
                      }`}
                    >
                      <img src={s.previewSvgDataUrl} alt="" className="h-14 w-full bg-hud-bg object-cover" />
                      <span className="block p-1.5 text-[10px] leading-tight text-hud-text truncate">{s.title}</span>
                    </button>
                  );
                })}
              </div>

              {isAnalyzingVisual && (
                <p role="status" className="flex items-center gap-2 rounded-lg border border-hud-line px-3 py-2 text-xs text-hud-accent">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Analyzing clinical visual frame…
                </p>
              )}

              {visualExamAnalysis && !isAnalyzingVisual && (
                <div className="space-y-2 rounded-lg border border-hud-line bg-hud-bg/60 p-3" role="status">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-hud-text">
                      {visualExamAnalysis.sampleIdOrFileName}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <StatusPill status={visualExamAnalysis.findingStatus} />
                      <button
                        type="button"
                        onClick={clearVisualExam}
                        aria-label="Clear visual exam result"
                        className="hud-focus rounded p-1 text-hud-muted hover:text-hud-text"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  {activePreviewImageUrl && (
                    <img
                      src={activePreviewImageUrl}
                      alt={visualExamAnalysis.sampleIdOrFileName}
                      className="h-28 w-full rounded border border-hud-line bg-hud-bg object-contain"
                    />
                  )}
                  <p className="text-xs leading-relaxed text-hud-text/90">{visualExamAnalysis.plainCrewGuidance}</p>
                  <p className="text-xs font-medium text-status-green">→ {visualExamAnalysis.recommendedAction}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Earth Packet & Compact Queued Packet History Card */}
          <Card
            icon={<Send className="h-4 w-4" />}
            title={environment === 'earth_1g' ? 'On-Site Consult Log' : 'Earth Consult Telemetry Packet'}
            actions={
              <InfoTip label="About Earth consult packets" align="right">
                {environment === 'earth_1g'
                  ? 'Bundles readiness, zone status, completed steps, the latest visual exam, recent check-ins, and editable crew clinical notes for the on-site flight surgeon.'
                  : `Bundles readiness, zone status, completed steps, the latest visual exam, recent check-ins, and editable crew clinical notes for the ground flight surgeon. One-way delay: ${formatCommDelay(spaceLocation)}.`}
              </InfoTip>
            }
          >
            <div className="space-y-3">
              <ul className="flex flex-wrap gap-1.5 text-xs text-hud-muted">
                <li className="rounded-full border border-hud-line bg-hud-bg/60 px-2 py-0.5">{doneCount} steps</li>
                <li className="rounded-full border border-hud-line bg-hud-bg/60 px-2 py-0.5">{visualExamAnalysis ? '1 exam' : 'No exam'}</li>
                <li className="rounded-full border border-hud-line bg-hud-bg/60 px-2 py-0.5">{Math.min(scenarioCheckIns.length, 5)} check-ins</li>
              </ul>

              <div className="space-y-1">
                <label htmlFor="crew-notes-input" className="flex items-center justify-between text-xs font-medium text-hud-text">
                  <span>Crew Clinical Notes & Remarks</span>
                  <span className="text-[10px] text-hud-muted">Editable before queueing</span>
                </label>
                <textarea
                  id="crew-notes-input"
                  rows={2}
                  value={crewNotesInput}
                  onChange={(e) => setCrewNotesInput(e.target.value)}
                  placeholder="Review or edit clinical remarks for the Flight Surgeon..."
                  className="hud-focus w-full rounded-lg border border-hud-line bg-hud-bg/80 p-2 font-mono text-xs text-hud-text placeholder-hud-muted focus:border-hud-accent"
                />
              </div>

              {packetConfirmation && (
                <div role="status" className="flex items-center justify-between gap-2 rounded-lg border border-status-green/40 bg-status-green/10 px-3 py-2 text-xs text-green-200">
                  <span className="flex items-center gap-1.5 truncate">
                    <FileCheck2 className="h-4 w-4 shrink-0 text-status-green" aria-hidden="true" />
                    <span className="truncate">{packetConfirmation}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPacketModal(true)}
                    className="hud-focus shrink-0 text-xs font-semibold text-status-green underline"
                  >
                    Inspect
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button type="button" onClick={handleQueuePacket} className="hud-btn-primary flex-1 py-1.5 text-xs">
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  {environment === 'earth_1g' ? 'Log on-site consult' : 'Queue Earth Packet'}
                </button>
                {queuedPackets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowPacketModal(true)}
                    className="hud-btn px-2.5 py-1.5 text-xs"
                    aria-label={`Inspect ${queuedPackets.length} queued blackout packets`}
                  >
                    <Files className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{queuedPackets.length}</span>
                  </button>
                )}
              </div>

              {/* Compact Queued-Packet History List */}
              {queuedPackets.length > 0 && (
                <div className="space-y-1.5 border-t border-hud-line pt-2">
                  <div className="flex items-center justify-between text-xs text-hud-muted">
                    <span className="font-semibold text-hud-text">
                      Queued Blackout Packets ({queuedPackets.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowPacketModal(true)}
                      className="hud-focus text-[11px] text-hud-accent underline hover:text-cyan-300"
                    >
                      Inspect all history
                    </button>
                  </div>
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto" aria-label="Queued packet history list">
                    {queuedPackets.slice(0, 5).map((pkt) => {
                      const urgency = pkt.urgency ?? 'routine_downlink';
                      const meta = URGENCY_META[urgency];
                      const Icon = meta.icon;
                      return (
                        <li key={pkt.packetId} className="flex items-center justify-between gap-2 rounded-lg border border-hud-line bg-hud-bg/60 p-2 text-xs">
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.2 font-mono text-[10px] ${meta.badgeClass}`}>
                                <Icon className="h-2.5 w-2.5" aria-hidden="true" />
                                {meta.label}
                              </span>
                              <span className="font-mono font-semibold text-hud-text">{pkt.packetId}</span>
                              <span className="text-[11px] text-hud-muted">· {pkt.readinessScore}% read.</span>
                            </div>
                            <p className="truncate text-[11px] text-hud-muted">
                              MD-{pkt.missionDay} · {new Date(pkt.timestampIso).toLocaleTimeString()} · {pkt.crewNotes || 'No notes'}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedPacketId(pkt.packetId);
                                setShowPacketModal(true);
                              }}
                              className="hud-focus rounded px-2 py-1 text-[11px] text-hud-accent underline hover:bg-hud-panel"
                              aria-label={`Inspect packet ${pkt.packetId}`}
                            >
                              Inspect
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadPacket(pkt)}
                              className="hud-focus rounded p-1 text-hud-muted hover:text-hud-text hover:bg-hud-panel"
                              aria-label={`Export JSON for packet ${pkt.packetId}`}
                              title="Download packet JSON"
                            >
                              <Download className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Accessible Queued Blackout Packet History & Inspection Modal */}
      {showPacketModal && queuedPackets.length > 0 && selectedPacket && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-hud-bg/85 p-3 sm:p-6 backdrop-blur-sm"
          onMouseDown={(e) => e.target === e.currentTarget && setShowPacketModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="packet-modal-title"
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-hud-line bg-hud-panel shadow-2xl"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-hud-line px-4 py-3">
              <div>
                <h3 id="packet-modal-title" className="font-display text-sm font-semibold tracking-wide text-hud-text">
                  Queued Blackout Telemetry Packets ({queuedPackets.length})
                </h3>
                <p className="text-[11px] text-hud-muted">
                  Transmitted autonomously when Earth line-of-sight aperture opens.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadPacket(selectedPacket)}
                  className="hud-btn-primary px-2.5 py-1 text-xs"
                  aria-label={`Export JSON for packet ${selectedPacket.packetId}`}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  Export JSON
                </button>
                {queuedPackets.length > 1 && (
                  <button
                    type="button"
                    onClick={handleDownloadAllPackets}
                    className="hud-btn px-2.5 py-1 text-xs"
                    aria-label="Export all packets as a bundle"
                  >
                    <Files className="h-3.5 w-3.5" aria-hidden="true" />
                    Export All
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowPacketModal(false)}
                  aria-label="Close dialog"
                  className="hud-focus rounded p-1 text-hud-muted hover:text-hud-text"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Packet Selector Bar */}
            <div className="border-b border-hud-line bg-hud-bg/50 px-4 py-2">
              <span className="sr-only">Select packet to inspect</span>
              <div className="no-scrollbar flex gap-2 overflow-x-auto" role="tablist" aria-label="Queued packets">
                {queuedPackets.map((pkt) => {
                  const isSelected = pkt.packetId === selectedPacket.packetId;
                  const urgency = pkt.urgency ?? 'routine_downlink';
                  const meta = URGENCY_META[urgency];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={pkt.packetId}
                      type="button"
                      role="tab"
                      aria-selected={isSelected}
                      onClick={() => setSelectedPacketId(pkt.packetId)}
                      className={`hud-focus flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                        isSelected
                          ? 'border-hud-accent bg-hud-accent/15 font-semibold text-hud-text'
                          : 'border-hud-line bg-hud-bg/80 text-hud-muted hover:border-slate-600 hover:text-hud-text'
                      }`}
                    >
                      <Icon className={`h-3 w-3 ${isSelected ? 'text-hud-accent' : 'text-hud-muted'}`} aria-hidden="true" />
                      <span className="font-mono">{pkt.packetId}</span>
                      <span className="text-[10px] text-hud-muted">({pkt.readinessScore}%)</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Packet Content & Metadata */}
            <div className="space-y-3 overflow-y-auto p-4 text-xs">
              {/* Summary Metadata Grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-lg border border-hud-line bg-hud-bg/40 p-2.5">
                <div>
                  <span className="text-[10px] text-hud-muted">Packet ID</span>
                  <p className="font-mono font-semibold text-hud-text">{selectedPacket.packetId}</p>
                </div>
                <div>
                  <span className="text-[10px] text-hud-muted">Urgency</span>
                  <div className="flex items-center gap-1 mt-0.5">
                    {(() => {
                      const meta = URGENCY_META[selectedPacket.urgency ?? 'routine_downlink'];
                      const Icon = meta.icon;
                      return (
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${meta.badgeClass}`}>
                          <Icon className="h-3 w-3" aria-hidden="true" />
                          {meta.label}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-hud-muted">Readiness Score</span>
                  <p className="font-semibold text-hud-text">{selectedPacket.readinessScore}%</p>
                </div>
                <div>
                  <span className="text-[10px] text-hud-muted">Light-Time Delay</span>
                  <p className="font-semibold text-hud-text">{selectedPacket.commDelayLabel}</p>
                </div>
                <div>
                  <span className="text-[10px] text-hud-muted">Astronaut</span>
                  <p className="font-semibold text-hud-text">{selectedPacket.crewMember.callsign} ({selectedPacket.crewMember.name})</p>
                </div>
                <div>
                  <span className="text-[10px] text-hud-muted">Mission Day</span>
                  <p className="font-semibold text-hud-text">Sol {selectedPacket.missionDay}</p>
                </div>
                <div>
                  <span className="text-[10px] text-hud-muted">Logged Timestamp</span>
                  <p className="text-hud-text">{new Date(selectedPacket.timestampIso).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-[10px] text-hud-muted">Focus Zone</span>
                  <p className="font-semibold text-hud-text capitalize">{selectedPacket.focusZone}</p>
                </div>
              </div>

              {/* Crew Notes */}
              <div className="rounded-lg border border-hud-line bg-hud-bg/30 p-2.5">
                <span className="font-semibold text-hud-text">Crew Clinical Notes:</span>
                <p className="mt-1 whitespace-pre-wrap text-hud-text/90">
                  {selectedPacket.crewNotes || 'Autonomous bio-twin telemetry & countermeasure log.'}
                </p>
              </div>

              {/* Raw JSON Payload */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-hud-muted">
                  <span>Raw Telemetry Payload (JSON)</span>
                  <button
                    type="button"
                    onClick={() => handleDownloadPacket(selectedPacket)}
                    className="hud-focus text-[11px] text-hud-accent underline"
                  >
                    Download JSON file
                  </button>
                </div>
                <pre className="max-h-56 overflow-auto rounded-lg border border-hud-line bg-hud-bg p-3 font-mono text-[11px] text-hud-text">
                  {JSON.stringify(selectedPacket, null, 2)}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-hud-line bg-hud-bg/40 px-4 py-2.5">
              <span className="text-[11px] text-hud-muted">
                Persisted in browser storage (`argus_packets_v1`) across reloads.
              </span>
              <button
                type="button"
                onClick={() => setShowPacketModal(false)}
                className="hud-btn px-3 py-1 text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
