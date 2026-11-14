/**
 * ARGUS — Autonomous Flight Surgeon Guidance, Self-Exam Checklist & Multimodal Triage Panel
 * Single Source of Truth: specs/02-ui-dashboard.md (§1 Right Column — 30%)
 */

import React, { useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Circle,
  Clock,
  Download,
  Eye,
  FileCheck2,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { VISUAL_EXAM_SAMPLES } from '../data/telemetryScenarios';
import {
  ENVIRONMENT_META,
  STATUS_COLORS,
  STATUS_LABELS,
} from '../utils/triageEngine';

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
  } = useMission();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [packetConfirmation, setPacketConfirmation] = useState<string | null>(
    null
  );
  const [showPacketModal, setShowPacketModal] = useState(false);

  const envMeta = ENVIRONMENT_META[environment];
  const statusColor = STATUS_COLORS[guidance.triageStatus];

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await runUploadedVisualExam(file);
      e.target.value = '';
    }
  };

  const handleQueuePacket = () => {
    const pkt = queueEarthPacket(
      `Autonomous ARGUS triage packet (${guidance.headline}) — ${completedStepIds.length}/${guidance.guidedSteps.length} countermeasures logged.`
    );
    setPacketConfirmation(
      `Packet ${pkt.packetId} queued for Deep Space Network uplink (ETA ${pkt.commDelayLabel})`
    );
  };

  const handleDownloadLatestPacket = () => {
    if (queuedPackets.length === 0) return;
    const latest = queuedPackets[0];
    const blob = new Blob([JSON.stringify(latest, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${latest.packetId}_ARGUS_Earth_Consult.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      aria-label="Autonomous Flight Surgeon Guidance and Visual Self-Exam"
      className="flex flex-col h-full bg-slate-900/60 border border-cyan-500/20 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(2,6,23,0.8)]"
    >
      {/* Top Panel Header */}
      <div className="px-4 py-2.5 border-b border-slate-800/90 bg-slate-950/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-cyan-400" />
          <div>
            <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-100">
              Autonomous Flight Surgeon
            </h2>
            <p className="text-[11px] text-slate-400">
              Plain-language crew guidance &amp; multimodal self-exam
            </p>
          </div>
        </div>

        {/* AI Source Badge + Live Clinical AI Refresh Button */}
        <div className="flex items-center gap-1.5">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
              guidance.source === 'live_ai'
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-400/50'
                : 'bg-slate-900 text-slate-300 border-slate-700'
            }`}
          >
            {guidance.source === 'live_ai'
              ? 'LIVE CLINICAL AI'
              : 'OFFLINE HRP CACHE'}
          </span>
          <button
            type="button"
            onClick={requestLiveAiGuidance}
            disabled={isSynthesizingAi}
            title="Synthesize or refresh guidance via Live Clinical AI"
            className="p-1.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-400/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isSynthesizingAi ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Scrollable Clinical Content Area */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        {/* 1. Spaceflight Hazard Context Card */}
        <div
          className="p-3 rounded-xl border bg-slate-950/80"
          style={{ borderColor: `${statusColor}55` }}
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" style={{ color: statusColor }} />
              Spaceflight Hazard Context ({envMeta.shortLabel})
            </span>
            <span
              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase"
              style={{
                backgroundColor: `${statusColor}20`,
                color: statusColor,
              }}
            >
              {STATUS_LABELS[guidance.triageStatus]}
            </span>
          </div>

          <h3 className="font-mono text-xs font-bold text-slate-100 mb-1.5">
            {guidance.headline}
          </h3>

          <p className="text-xs text-slate-300 leading-relaxed mb-2">
            {guidance.plainLanguageExplanation}
          </p>

          <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
            <span className="font-mono text-cyan-400 font-semibold">
              NASA HRP Mechanism:{' '}
            </span>
            {guidance.hazardContextSummary}
          </div>
        </div>

        {/* 2. Numbered Guided Self-Assessment & Countermeasures Checklist */}
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/90">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-100 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              Guided Self-Assessment &amp; Countermeasures
            </h3>
            <span className="font-mono text-[11px] text-cyan-400">
              {completedStepIds.length}/{guidance.guidedSteps.length} DONE
            </span>
          </div>

          <div className="space-y-2">
            {guidance.guidedSteps.map((step) => {
              const isDone = completedStepIds.includes(step.id);
              return (
                <div
                  key={step.id}
                  onClick={() => toggleStepCompleted(step.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleStepCompleted(step.id);
                    }
                  }}
                  className={`p-2.5 rounded-lg border transition-all cursor-pointer ${
                    isDone
                      ? 'bg-emerald-950/25 border-emerald-500/40 text-slate-300'
                      : 'bg-slate-900/80 border-slate-800 hover:border-cyan-500/40'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="mt-0.5 shrink-0">
                      {isDone ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Circle className="w-4 h-4 text-cyan-400/70" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`font-mono text-xs font-bold ${
                            isDone
                              ? 'line-through text-emerald-300/80'
                              : 'text-slate-100'
                          }`}
                        >
                          {step.stepNumber}. {step.title}
                        </span>
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-400 shrink-0">
                          <Clock className="w-3 h-3 text-cyan-400" />
                          {step.estimatedMinutes}m
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                        {step.plainInstruction}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-mono text-cyan-300/90">
                        <Wrench className="w-3 h-3" />
                        <span>Hardware: {step.hardwareRequired}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. Visual Self-Exam Input: 1-Click Sample Test Images + Webcam/File Upload */}
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/90">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-100 flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-cyan-400" />
              Visual Self-Exam Input
            </h3>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-2 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 font-mono text-[10px] text-cyan-300 flex items-center gap-1 transition-colors"
            >
              <Upload className="w-3 h-3" />
              <span>Upload / Webcam</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          <p className="text-[11px] text-slate-400 mb-2">
            Select a 1-click onboard diagnostic sample or upload a custom scan:
          </p>

          {/* 3 One-Click Sample Test Images */}
          <div className="grid grid-cols-3 gap-1.5 mb-2.5">
            {VISUAL_EXAM_SAMPLES.map((sample) => {
              const sColor = STATUS_COLORS[sample.defaultFindingStatus];
              const isSelectedSample =
                visualExamAnalysis?.sampleIdOrFileName === sample.title;
              return (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => runSampleVisualExam(sample)}
                  disabled={isAnalyzingVisual}
                  className={`p-2 rounded-lg border text-left transition-all flex flex-col justify-between ${
                    isSelectedSample
                      ? 'bg-slate-800 border-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.2)]'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <Eye className="w-3 h-3" style={{ color: sColor }} />
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: sColor }}
                    />
                  </div>
                  <span className="font-mono text-[10px] font-bold text-slate-200 leading-tight">
                    {sample.title}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Visual Self-Exam Triage Result Card */}
          {isAnalyzingVisual && (
            <div className="p-3 rounded-lg bg-slate-900 border border-cyan-500/30 text-xs font-mono text-cyan-300 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Running multimodal medical image triage...
            </div>
          )}

          {visualExamAnalysis && !isAnalyzingVisual && (
            <div
              className="p-2.5 rounded-lg bg-slate-900/95 border space-y-2"
              style={{
                borderColor: `${STATUS_COLORS[visualExamAnalysis.findingStatus]}66`,
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-bold text-slate-100 truncate">
                  {visualExamAnalysis.sampleIdOrFileName}
                </span>
                <div className="flex items-center gap-1.5">
                  <span
                    className="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold uppercase"
                    style={{
                      backgroundColor: `${
                        STATUS_COLORS[visualExamAnalysis.findingStatus]
                      }20`,
                      color: STATUS_COLORS[visualExamAnalysis.findingStatus],
                    }}
                  >
                    {STATUS_LABELS[visualExamAnalysis.findingStatus]}
                  </span>
                  <button
                    type="button"
                    onClick={clearVisualExam}
                    title="Clear visual exam"
                    className="text-slate-400 hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {activePreviewImageUrl && (
                <div className="rounded-md overflow-hidden border border-slate-800 bg-slate-950 flex justify-center">
                  <img
                    src={activePreviewImageUrl}
                    alt={visualExamAnalysis.sampleIdOrFileName}
                    className="h-32 w-full object-contain"
                  />
                </div>
              )}

              <p className="text-xs text-slate-200 leading-relaxed">
                {visualExamAnalysis.plainCrewGuidance}
              </p>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                <strong className="text-cyan-300 font-mono">Finding:</strong>{' '}
                {visualExamAnalysis.clinicalSummary}
              </p>
              <p className="text-[11px] text-emerald-300/90 font-mono">
                Action: {visualExamAnalysis.recommendedAction}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 4. Bottom Action Footer: Queue Telemetry Packet for Earth Flight Surgeon */}
      <div className="p-3.5 bg-slate-950/90 border-t border-slate-800/90 space-y-2">
        {packetConfirmation && (
          <div className="px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-mono flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <FileCheck2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{packetConfirmation}</span>
            </span>
            <button
              type="button"
              onClick={() => setShowPacketModal(true)}
              className="underline text-cyan-300 hover:text-cyan-200 shrink-0"
            >
              Inspect
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleQueuePacket}
            className="flex-1 py-2.5 px-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(34,211,238,0.3)] transition-all"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Queue Telemetry Packet for Earth Flight Surgeon</span>
          </button>

          {queuedPackets.length > 0 && (
            <button
              type="button"
              onClick={() => setShowPacketModal((prev) => !prev)}
              title="Inspect Queued Earth Telemetry Packets"
              className="px-2.5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-cyan-500/40 font-mono text-xs text-cyan-300"
            >
              ({queuedPackets.length})
            </button>
          )}
        </div>
      </div>

      {/* Modal to Inspect / Download Queued Earth Telemetry Packet */}
      {showPacketModal && queuedPackets.length > 0 && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-xl bg-slate-900 border border-cyan-500/40 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-cyan-300">
                DSN UPLINK BUFFER // LATEST EARTH FLIGHT SURGEON PACKET
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadLatestPacket}
                  className="px-2.5 py-1 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-300 font-mono text-xs flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export JSON
                </button>
                <button
                  type="button"
                  onClick={() => setShowPacketModal(false)}
                  className="text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <pre className="p-4 text-[11px] font-mono text-slate-200 overflow-x-auto max-h-[60vh]">
              {JSON.stringify(queuedPackets[0], null, 2)}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
};
