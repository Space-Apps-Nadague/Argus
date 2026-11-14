/**
 * ARGUS AI — Wellbeing (mental health) check-in (specs/02-ui-dashboard.md §2.4)
 * Six 1–5 scales → `POST /api/ai/wellbeing`. Score, status and crisis flag are deterministic (server).
 */

import React, { useState } from 'react';
import { HeartHandshake, Send } from 'lucide-react';
import { useMission } from '../../context/MissionContext';
import type { AiResultMeta, WellbeingAssessment, WellbeingCheckIn } from '../../types/aiApi';
import { argusApi } from '../../services/argusApi';
import { StatusPill } from '../ui/StatusPill';
import { errorText, ErrorNote, SourceTag, useCrewContextRequest, usePerCrewList } from './shared';

export const WELLBEING_STORAGE_KEY = 'argus_wellbeing_v1';

type Scale = 'mood' | 'stress' | 'energy' | 'sleepQuality' | 'cohesion' | 'motivation';

const SCALES: Array<{ id: Scale; label: string; low: string; high: string }> = [
  { id: 'mood', label: 'Mood', low: 'Very low', high: 'Great' },
  { id: 'stress', label: 'Stress', low: 'Calm', high: 'Very stressed' },
  { id: 'energy', label: 'Energy', low: 'Exhausted', high: 'Full' },
  { id: 'sleepQuality', label: 'Sleep quality', low: 'Poor', high: 'Excellent' },
  { id: 'cohesion', label: 'Team connection', low: 'Isolated', high: 'Connected' },
  { id: 'motivation', label: 'Motivation', low: 'None', high: 'High' },
];

const TREND_WORD = { improving: 'Improving', stable: 'Stable', worsening: 'Worsening' } as const;

export const WellbeingPanel: React.FC = () => {
  const { activeCrewMember, latestDay, runtimeApiKey } = useMission();
  const ctx = useCrewContextRequest();
  const [history, setHistory] = usePerCrewList<WellbeingCheckIn>(WELLBEING_STORAGE_KEY, activeCrewMember.id, 60);
  const [values, setValues] = useState<Record<Scale, number>>({ mood: 4, stress: 2, energy: 4, sleepQuality: 4, cohesion: 4, motivation: 4 });
  const [note, setNote] = useState('');
  const [result, setResult] = useState<WellbeingAssessment | null>(null);
  const [meta, setMeta] = useState<AiResultMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const entry: WellbeingCheckIn = {
      id: `wb-${Date.now()}`,
      crewId: activeCrewMember.id,
      missionDay: latestDay,
      timestampIso: new Date().toISOString(),
      ...values,
      note: note.trim() || undefined,
    };
    const next = [...history.filter((c) => c.missionDay !== latestDay), entry];
    setHistory(() => next);
    setBusy(true);
    setError(null);
    try {
      const res = await argusApi.wellbeing({ ...ctx, checkIns: next }, runtimeApiKey);
      setResult(res.result);
      setMeta(res.meta);
      setNote('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <form onSubmit={submit} className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-hud-muted">
          <HeartHandshake className="h-4 w-4 text-hud-accent" aria-hidden="true" />
          How are you today? One check-in per mission day ({history.length} saved).
        </p>
        {SCALES.map((s) => (
          <fieldset key={s.id}>
            <legend className="mb-1 flex w-full justify-between text-xs">
              <span className="font-medium text-hud-text">{s.label}</span>
              <span className="font-mono text-hud-accent">{values[s.id]}/5</span>
            </legend>
            <div className="flex items-center gap-2">
              <span className="w-20 text-right text-[11px] text-hud-muted">{s.low}</span>
              <div className="flex flex-1 gap-1" role="radiogroup" aria-label={s.label}>
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={values[s.id] === v}
                    aria-label={`${s.label} ${v}`}
                    onClick={() => setValues((p) => ({ ...p, [s.id]: v }))}
                    className={`hud-focus h-8 flex-1 rounded-md border text-xs ${
                      values[s.id] === v ? 'border-hud-accent bg-hud-accent/20 text-hud-accent' : 'border-hud-line text-hud-muted hover:text-hud-text'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <span className="w-20 text-[11px] text-hud-muted">{s.high}</span>
            </div>
          </fieldset>
        ))}
        <label className="block">
          <span className="mb-1 block text-xs text-hud-muted">Anything on your mind? (optional, private to your account)</span>
          <textarea className="hud-input resize-none font-sans" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="hud-btn-primary" disabled={busy}>
          <Send className="h-4 w-4" aria-hidden="true" />
          {busy ? 'Saving…' : 'Save check-in'}
        </button>
      </form>

      <div className="space-y-3">
        <ErrorNote error={error} />
        {result ? (
          <div className="space-y-3 rounded-lg border border-hud-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={result.status} size="md" label={`Risk ${result.riskScore}/100`} />
              <span className="text-xs text-hud-muted">Trend: {TREND_WORD[result.trend]}</span>
              <SourceTag meta={meta} />
            </div>
            <p className={`whitespace-pre-wrap text-sm leading-relaxed ${result.crisisFlag ? 'rounded-lg border border-red-500/60 bg-red-950/40 p-2 text-red-50' : 'text-hud-text'}`}>
              {result.supportiveMessage}
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-hud-text">
              {result.suggestedActions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            {result.factors.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-hud-muted">What drives the score</div>
                <ul className="space-y-1 text-xs text-hud-muted">
                  {result.factors.map((f) => (
                    <li key={f.id}>
                      <span className="text-hud-text">{f.label}</span> — {f.detail}
                      {f.impact > 0 && <span className="font-mono"> (+{f.impact})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-hud-muted">Save a check-in to see your wellbeing assessment and a few small suggestions.</p>
        )}
        {history.length > 0 && (
          <div>
            <div className="mb-1 text-xs font-semibold text-hud-muted">Recent mood</div>
            <div className="flex h-12 items-end gap-1" aria-label="Mood over recent check-ins">
              {history.slice(-14).map((c) => (
                <div
                  key={c.id}
                  title={`Day ${c.missionDay}: mood ${c.mood}/5, stress ${c.stress}/5`}
                  className="flex-1 rounded-t bg-hud-accent/60"
                  style={{ height: `${(c.mood / 5) * 100}%` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
