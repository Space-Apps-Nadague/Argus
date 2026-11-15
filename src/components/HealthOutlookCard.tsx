/**
 * ARGUS — Health outlook (specs/02-ui-dashboard.md §2.3)
 * Possible spaceflight conditions from The Thousand Eyes indicators, a 3-day outlook for each, and the
 * physical checks that would confirm or rule them out. Deterministic; never changes triage.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, ClipboardList, PhoneCall, Stethoscope, XCircle } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { ZONE_ORDER } from '../data/telemetryScenarios';
import { CHECK_KIND_LABEL } from '../features/healthOutlook/checks';
import {
  type CheckOutcome,
  type CheckResult,
  evaluateHealthOutlook,
  type Hypothesis,
  type Level,
  nextChecks,
  OUTLOOK_DISCLAIMER,
  sharedDrivers,
  type OutlookTrend,
} from '../features/healthOutlook/engine';
import { loadResults, removeResult, saveResults, upsertResult } from '../features/healthOutlook/resultsStore';
import { buildPerson } from '../features/thousandEyes/adapter';
import { InfoTip } from './InfoTip';
import { Card } from './ui/Card';

const LEVEL: Record<Level, { word: string; className: string }> = {
  watch: { word: 'Weak pattern', className: 'border-hud-line text-hud-text' },
  possible: { word: 'Moderate pattern', className: 'border-status-yellow/60 bg-status-yellow/10 text-status-yellow' },
  likely: { word: 'Strong pattern', className: 'border-status-red/60 bg-status-red/10 text-red-300' },
};

const TREND: Record<OutlookTrend, { word: string; icon: React.ReactNode; className: string }> = {
  rising: { word: 'Rising', icon: <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />, className: 'text-status-red' },
  steady: { word: 'Steady', icon: <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />, className: 'text-hud-muted' },
  easing: { word: 'Easing', icon: <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />, className: 'text-status-green' },
};

const OUTCOME_BUTTONS: Array<{ outcome: CheckOutcome; label: string }> = [
  { outcome: 'supports', label: 'Supports' },
  { outcome: 'normal', label: 'Normal' },
  { outcome: 'inconclusive', label: 'Inconclusive' },
];

const OUTCOME_TEXT: Record<CheckOutcome, string> = {
  supports: 'Supports the hypothesis',
  normal: 'Normal: argues against it',
  inconclusive: 'Inconclusive',
};

export const HealthOutlookCard: React.FC = () => {
  const { zones, spaceLocationId, activeCrewMember } = useMission();
  const crewId = activeCrewMember.id;
  const [results, setResults] = useState<CheckResult[]>(() => loadResults(crewId));
  useEffect(() => setResults(loadResults(crewId)), [crewId]);

  const now = useMemo(() => Date.now(), [zones, spaceLocationId, crewId, results]);
  const person = useMemo(
    () => buildPerson({ locationId: spaceLocationId, metrics: ZONE_ORDER.flatMap((z) => zones[z]), now }),
    [spaceLocationId, zones, now]
  );
  const hypotheses = useMemo(() => evaluateHealthOutlook(person, now, results), [person, now, results]);
  const pending = useMemo(() => nextChecks(hypotheses).slice(0, 5), [hypotheses]);
  const drivers = useMemo(() => sharedDrivers(hypotheses).slice(0, 3), [hypotheses]);
  const strong = hypotheses.filter((h) => h.contactSurgeon && h.status !== 'confirmed');
  const [open, setOpen] = useState<string | null>(null);
  const openId = open ?? hypotheses[0]?.condition.id ?? null;

  const update = (next: CheckResult[]) => {
    setResults(next);
    saveResults(crewId, next);
  };
  const log = (conditionId: string, checkId: string, outcome: CheckOutcome) =>
    update(upsertResult(results, { conditionId, checkId, outcome, at: Date.now() }));
  const undo = (conditionId: string, checkId: string) => update(removeResult(results, conditionId, checkId));

  return (
    <Card
      title="Health outlook"
      icon={<Stethoscope className="h-4 w-4" />}
      actions={
        <InfoTip label="About the health outlook" align="right">
          Patterns in your Thousand Eyes indicators that match known spaceflight conditions, compared only with your own
          baselines. Each comes with checks that can confirm it or rule it out. {OUTLOOK_DISCLAIMER}
        </InfoTip>
      }
    >
      {hypotheses.length === 0 ? (
        <p className="py-4 text-center text-sm text-hud-muted">
          No condition patterns in your data. Keep logging; checks appear here when something drifts.
        </p>
      ) : (
        <div className="space-y-4">
          {strong.length > 0 && (
            <p role="status" className="flex items-start gap-1.5 rounded-lg border border-status-yellow/50 bg-status-yellow/10 p-3 text-xs text-yellow-100">
              <PhoneCall className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-semibold">Contact the flight surgeon at the next comm window</span> about the strong
                pattern{strong.length > 1 ? 's' : ''}: {strong.map((h) => h.condition.label).join(', ')}.
              </span>
            </p>
          )}

          {drivers.length > 0 && (
            <p className="rounded-lg border border-hud-line bg-hud-bg/40 p-3 text-xs text-hud-muted">
              <span className="font-semibold text-hud-text">Common thread: </span>
              {drivers.map((d, i) => (
                <span key={d.key}>
                  {i > 0 && '; '}
                  <span className="text-hud-text">{d.label}</span> drives {d.conditions.length} of these patterns
                </span>
              ))}
              . One cause can explain several of them; the checks below help tell them apart.
            </p>
          )}

          {pending.length > 0 && (
            <section aria-labelledby="next-checks-title" className="rounded-lg border border-hud-accent/30 bg-hud-accent/5 p-3">
              <h3 id="next-checks-title" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-hud-accent">
                <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" /> Next checks
              </h3>
              <ol className="space-y-1.5 text-sm">
                {pending.map((n, i) => (
                  <li key={n.check.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs text-hud-muted">{i + 1}.</span>
                    <span className="font-medium text-hud-text">{n.check.name}</span>
                    <span className="text-[11px] text-hud-muted">
                      {CHECK_KIND_LABEL[n.check.kind]}
                      {n.check.needsCmo ? ' · with the crew medical officer' : ''} · tests {n.conditions.map((c) => c.label).join(', ')}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <ul className="space-y-3">
            {hypotheses.map((h) => (
              <HypothesisRow
                key={h.condition.id}
                h={h}
                open={openId === h.condition.id}
                onToggle={() => setOpen(openId === h.condition.id ? '' : h.condition.id)}
                onLog={log}
                onUndo={undo}
              />
            ))}
          </ul>
        </div>
      )}
      <p className="pt-3 text-[11px] text-hud-muted">{OUTLOOK_DISCLAIMER}</p>
    </Card>
  );
};

const HypothesisRow: React.FC<{
  h: Hypothesis;
  open: boolean;
  onToggle: () => void;
  onLog: (conditionId: string, checkId: string, outcome: CheckOutcome) => void;
  onUndo: (conditionId: string, checkId: string) => void;
}> = ({ h, open, onToggle, onLog, onUndo }) => {
  const id = h.condition.id;
  const t = TREND[h.outlook.trend];
  const ruledOut = h.status === 'ruled_out';
  return (
    <li className={`rounded-lg border p-3 ${ruledOut ? 'border-hud-line opacity-75' : 'border-hud-line bg-hud-bg/40'}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`hyp-${id}`} className="hud-focus flex w-full flex-wrap items-center gap-2 text-left">
        <span className="min-w-0 flex-1 text-sm font-semibold text-hud-text">{h.condition.label}</span>
        {ruledOut ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-status-green/60 px-2 py-0.5 text-[11px] font-semibold text-status-green">
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Ruled out by checks
          </span>
        ) : (
          h.level && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${LEVEL[h.level].className}`}>{LEVEL[h.level].word}</span>
        )}
        {!ruledOut && h.outlook.hasHistory && (
          <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${t.className}`}>
            {t.icon}
            {t.word}
            {h.outlook.levelIn3Days !== h.level && (
              <span className="text-hud-muted">· {h.outlook.levelIn3Days ? LEVEL[h.outlook.levelIn3Days].word.split(' ')[0].toLowerCase() : 'clear'} in 3 days</span>
            )}
          </span>
        )}
        <ChevronDown className={`h-4 w-4 text-hud-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {h.status === 'confirmed' && (
        <p className="mt-2 flex items-center gap-1.5 rounded-md border border-status-red/50 bg-status-red/10 px-2 py-1 text-xs text-red-200">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Confirmed by checks · tell the flight surgeon
        </p>
      )}

      {open && (
        <div id={`hyp-${id}`} className="mt-3 space-y-3">
          <p className="text-xs text-hud-muted">
            {h.condition.plain} <span className="text-hud-muted/80">({h.condition.hrpRisk})</span>
          </p>

          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-hud-muted">Evidence from your eyes</h4>
            <ul className="flex flex-wrap gap-1.5">
              {h.evidence.map((e) => (
                <li
                  key={e.signal.key}
                  className={`rounded-md border px-2 py-0.5 text-[11px] ${e.research ? 'border-dashed' : ''} ${
                    e.value == null ? 'border-hud-line text-hud-muted' : e.value >= 1 ? 'border-status-yellow/60 text-hud-text' : 'border-hud-line text-hud-text'
                  }`}
                  title={e.signal.role === 'primary' ? 'Main signal' : 'Supporting signal'}
                >
                  {e.label}{' '}
                  <span className="font-mono">
                    {e.value == null ? 'no data' : `${e.signal.worse === 'up' ? '↑' : '↓'} ${e.value.toFixed(1)}σ`}
                    {e.red ? ' !' : ''}
                  </span>
                  {e.signal.role === 'supporting' && <span className="text-hud-muted"> · supporting</span>}
                  {e.research && <span className="text-hud-muted"> · research</span>}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-hud-muted">Checks to confirm or rule out</h4>
            <ul className="space-y-2">
              {h.checks.map(({ check, result }) => (
                <li key={check.id} className="rounded-md border border-hud-line p-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-hud-text">{check.name}</span>
                    <span className="text-[11px] text-hud-muted">
                      {CHECK_KIND_LABEL[check.kind]}
                      {check.needsCmo ? ' · with the crew medical officer' : ''}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-hud-muted">{check.how}</p>
                  <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-xs">
                    <dt className="text-status-yellow">Supports if</dt>
                    <dd className="text-hud-text">{check.supportsIf}</dd>
                    <dt className="text-status-green">Against if</dt>
                    <dd className="text-hud-text">{check.refutesIf}</dd>
                  </dl>
                  {result ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium text-hud-text">Logged: {OUTCOME_TEXT[result.outcome]}</span>
                      <span className="text-hud-muted">{new Date(result.at).toLocaleDateString()}</span>
                      <button type="button" className="hud-btn !px-2 !py-0.5 text-[11px]" onClick={() => onUndo(id, check.id)}>
                        Undo
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Log result of ${check.name}`}>
                      <span className="text-[11px] text-hud-muted">Result:</span>
                      {OUTCOME_BUTTONS.map((b) => (
                        <button key={b.outcome} type="button" className="hud-btn !px-2 !py-0.5 text-[11px]" onClick={() => onLog(id, check.id, b.outcome)}>
                          {b.label}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </li>
  );
};
