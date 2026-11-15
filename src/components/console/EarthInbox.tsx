/**
 * Earth side: reports from the crew that have crossed the light-time gap, for flight
 * surgeons (specs/04-ai-backend.md §4.4). Replies reach the crew member after the trip back.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Earth, RefreshCw, Send } from 'lucide-react';
import { earthApi } from '../../services/assistantApi';
import type { EarthReport } from '../../types/assistant';
import { Card } from '../ui/Card';

const URGENCY = {
  routine_downlink: { word: 'Routine', cls: 'border-hud-line text-hud-muted' },
  priority_packet: { word: 'Priority', cls: 'border-status-yellow/50 text-status-yellow' },
  immediate_emergency_packet: { word: 'Emergency', cls: 'border-status-red/60 text-red-200' },
} as const;

export const EarthInbox: React.FC = () => {
  const [reports, setReports] = useState<EarthReport[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReports((await earthApi.inbox()).reports);
      setError(null);
    } catch {
      setError('Could not load the inbox. Earth reports need the ARGUS database.');
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  const current = reports.find((r) => r.id === selected) ?? null;
  const open = (r: EarthReport) => {
    setSelected(r.id);
    setReply('');
    if (!r.readAtIso) void earthApi.markRead(r.id).then(load).catch(() => {});
  };
  const sendReply = async () => {
    if (!current || !reply.trim()) return;
    await earthApi.reply(current.id, reply.trim());
    setReply('');
    await load();
  };
  const bh = current?.payload.behavioralHealth;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Card
        title="Reports from the crew"
        icon={<Earth className="h-4 w-4" />}
        className="lg:col-span-5"
        actions={
          <button type="button" className="hud-btn px-2 py-1" onClick={() => void load()} aria-label="Refresh inbox">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        }
      >
        {error && <p className="text-xs text-red-200">{error}</p>}
        {!error && reports.length === 0 && <p className="text-sm text-hud-muted">Nothing has arrived yet.</p>}
        <ul className="space-y-1.5">
          {reports.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => open(r)}
                className={`hud-focus w-full rounded-lg border px-3 py-2 text-left ${selected === r.id ? 'border-hud-accent/60 bg-hud-accent/10' : 'border-hud-line bg-hud-bg/60 hover:border-slate-600'}`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className={`rounded-full border px-2 py-0.5 ${URGENCY[r.urgency].cls}`}>{URGENCY[r.urgency].word}</span>
                  <span className="text-hud-muted">
                    {r.astronautLabel} · {new Date(r.createdAtIso).toLocaleString()}
                  </span>
                </div>
                <p className={`mt-1 line-clamp-2 text-sm ${r.readAtIso ? 'text-hud-muted' : 'font-semibold text-hud-text'}`}>{r.summary}</p>
                {r.reply && <p className="mt-0.5 text-[11px] text-hud-drift">Replied</p>}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={current ? `${current.astronautLabel} · ${current.kind}` : 'Report'} className="lg:col-span-7">
        {!current ? (
          <p className="text-sm text-hud-muted">Pick a report.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap text-hud-text">{current.payload.crewNotes || current.summary}</p>
            <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-hud-muted">Readiness</dt>
                <dd className="text-hud-text">{current.payload.readinessScore}%</dd>
              </div>
              <div>
                <dt className="text-hud-muted">Light time</dt>
                <dd className="text-hud-text">{Math.round(current.oneWayDelaySec)} s</dd>
              </div>
              {Object.entries(current.payload.zoneStatuses ?? {}).map(([z, s]) => (
                <div key={z}>
                  <dt className="text-hud-muted capitalize">{z}</dt>
                  <dd className={s === 'red' ? 'text-red-300' : s === 'yellow' ? 'text-status-yellow' : 'text-status-green'}>{String(s).toUpperCase()}</dd>
                </div>
              ))}
            </dl>
            {bh && (
              <section className="rounded-lg border border-hud-drift/40 bg-hud-drift/5 p-3">
                <h3 className="text-xs font-semibold text-hud-drift">Behavioural health · {bh.assessment.concernLevel}</h3>
                <p className="mt-1 text-hud-text">{bh.assessment.summary}</p>
                <p className="mt-1 text-xs text-hud-muted">
                  Mood {bh.assessment.mood.replace('_', ' ')} · stress {bh.assessment.stress} · fatigue {bh.assessment.fatigue} · trend {bh.assessment.trend}
                </p>
                {bh.assessment.evidence.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-xs text-hud-muted">
                    {bh.assessment.evidence.map((e, i) => (
                      <li key={i}>
                        {e.source}: {e.text}
                      </li>
                    ))}
                  </ul>
                )}
                {bh.countermeasures.length > 0 && (
                  <p className="mt-1 text-xs text-hud-muted">
                    Suggested: {bh.countermeasures.map((c) => `${c.title}${c.helped === undefined ? '' : c.helped ? ' (helped)' : ' (did not help)'}`).join('; ')}
                  </p>
                )}
              </section>
            )}
            {current.payload.visualObservation?.facePresent && (
              <p className="text-xs text-hud-muted">
                Camera at the time: {current.payload.visualObservation.notes.join(', ') || 'nothing notable'}
                {current.payload.visualObservation.emotion ? ` · expression mostly ${current.payload.visualObservation.emotion.label}` : ''}
              </p>
            )}
            {current.reply ? (
              <p className="rounded-lg border border-hud-line bg-hud-bg/60 p-2 text-xs text-hud-text">
                Your reply ({new Date(current.reply.sentAtIso).toLocaleTimeString()}): {current.reply.text}
              </p>
            ) : (
              <div className="space-y-2">
                <label htmlFor="earth-reply" className="text-xs text-hud-muted">
                  Reply to the crew member. It arrives after {Math.round(current.oneWayDelaySec)} s.
                </label>
                <textarea id="earth-reply" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} className="hud-input resize-none font-sans" />
                <button type="button" className="hud-btn-primary py-1.5 text-xs" onClick={() => void sendReply()} disabled={!reply.trim()}>
                  <Send className="h-3.5 w-3.5" aria-hidden="true" />
                  Send reply
                </button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
};
