/**
 * ARGUS AI — Diagnostics and Plan panels (specs/02-ui-dashboard.md §2.4)
 * `POST /api/ai/diagnostics` and `POST /api/ai/recommendations`.
 */

import React, { useState } from 'react';
import { ClipboardList, Microscope, RefreshCw } from 'lucide-react';
import { useMission } from '../../context/MissionContext';
import type { AiResultMeta, CountermeasurePlan, DiagnosticsReport, Likelihood, RecommendationPriority } from '../../types/aiApi';
import { argusApi } from '../../services/argusApi';
import { errorText, ErrorNote, SourceTag, useCrewContextRequest } from './shared';

const LIKELIHOOD_CLASS: Record<Likelihood, string> = {
  high: 'border-status-red/50 bg-status-red/10 text-status-red',
  moderate: 'border-status-yellow/50 bg-status-yellow/10 text-status-yellow',
  low: 'border-hud-line text-hud-muted',
};

const PRIORITY_LABEL: Record<RecommendationPriority, string> = { now: 'Now', today: 'Today', this_week: 'This week' };
const PRIORITY_CLASS: Record<RecommendationPriority, string> = {
  now: 'border-status-red/50 text-status-red',
  today: 'border-status-yellow/50 text-status-yellow',
  this_week: 'border-hud-line text-hud-muted',
};

const URGENCY: Record<DiagnosticsReport['earthConsultUrgency'], string> = {
  routine_downlink: 'Routine downlink',
  priority_packet: 'Priority packet to Earth',
  immediate_emergency_packet: 'Contact Earth now',
};

function useAiCall<T>(call: () => Promise<{ result: T; meta: AiResultMeta }>) {
  const [data, setData] = useState<T | null>(null);
  const [meta, setMeta] = useState<AiResultMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await call();
      setData(res.result);
      setMeta(res.meta);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return { data, meta, busy, error, run };
}

const RunButton: React.FC<{ busy: boolean; hasData: boolean; onClick: () => void; label: string }> = ({ busy, hasData, onClick, label }) => (
  <button type="button" className="hud-btn-primary" onClick={onClick} disabled={busy}>
    <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
    {busy ? 'Working…' : hasData ? 'Run again' : label}
  </button>
);

export const DiagnosticsPanel: React.FC = () => {
  const ctx = useCrewContextRequest();
  const { runtimeApiKey } = useMission();
  const { data, meta, busy, error, run } = useAiCall(() => argusApi.diagnostics(ctx, runtimeApiKey));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <RunButton busy={busy} hasData={Boolean(data)} onClick={run} label="Run diagnostics" />
        <SourceTag meta={meta} />
      </div>
      <ErrorNote error={error} />
      {!data && !busy && (
        <p className="flex items-center gap-2 text-sm text-hud-muted">
          <Microscope className="h-4 w-4" aria-hidden="true" />
          Ranks the conditions most consistent with your telemetry and trends, mapped to NASA health risks.
        </p>
      )}
      {data && (
        <>
          <div className="rounded-lg border border-hud-line bg-hud-bg/60 p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-hud-text">Summary</span>
              <span className="rounded-full border border-hud-line px-2 py-0.5 text-hud-muted">{URGENCY[data.earthConsultUrgency]}</span>
              <span className="text-hud-muted">Readiness {data.readinessScore}%</span>
            </div>
            <p className="text-sm leading-relaxed text-hud-text">{data.summary}</p>
          </div>
          {data.hypotheses.length === 0 ? (
            <p className="text-sm text-hud-muted">No conditions flagged.</p>
          ) : (
            <ol className="space-y-2">
              {data.hypotheses.map((h, i) => (
                <li key={h.id} className="rounded-lg border border-hud-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-hud-muted">{i + 1}.</span>
                    <span className="text-sm font-semibold text-hud-text">{h.condition}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${LIKELIHOOD_CLASS[h.likelihood]}`}>
                      {h.likelihood} · {Math.round(h.confidence * 100)}%
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-hud-muted">{h.hrpRisk}</p>
                  <p className="mt-2 text-sm text-hud-text">{h.rationale}</p>
                  <p className="mt-1 text-sm text-hud-text">
                    <span className="text-hud-muted">Confirm: </span>
                    {h.suggestedConfirmation}
                  </p>
                  {h.supportingMetricIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {h.supportingMetricIds.map((m) => (
                        <span key={m} className="rounded bg-hud-panel px-1.5 py-0.5 font-mono text-[11px] text-hud-muted">
                          {m}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="text-[11px] text-hud-muted">{data.disclaimer}</p>
        </>
      )}
    </div>
  );
};

export const PlanPanel: React.FC = () => {
  const ctx = useCrewContextRequest();
  const { runtimeApiKey } = useMission();
  const { data, meta, busy, error, run } = useAiCall<CountermeasurePlan>(() => argusApi.recommendations(ctx, runtimeApiKey));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <RunButton busy={busy} hasData={Boolean(data)} onClick={run} label="Build today's plan" />
        <SourceTag meta={meta} />
      </div>
      <ErrorNote error={error} />
      {!data && !busy && (
        <p className="flex items-center gap-2 text-sm text-hud-muted">
          <ClipboardList className="h-4 w-4" aria-hidden="true" />
          A personalized countermeasure plan: exercise, sleep, nutrition, radiation and habitat actions.
        </p>
      )}
      {data && (
        <>
          <h3 className="text-sm font-semibold text-hud-text">{data.headline}</h3>
          <ul className="space-y-2">
            {data.recommendations.map((r) => (
              <li key={r.id} className="rounded-lg border border-hud-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${PRIORITY_CLASS[r.priority]}`}>{PRIORITY_LABEL[r.priority]}</span>
                  <span className="text-sm font-semibold text-hud-text">{r.title}</span>
                  <span className="text-[11px] text-hud-muted">
                    {r.category.replace('_', ' ')} · {r.durationMinutes} min
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-hud-text">{r.plainInstruction}</p>
                <p className="mt-1 text-xs text-hud-muted">{r.rationale}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};
