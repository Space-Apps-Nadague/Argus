/**
 * Cognitive decline alert (specs/02-ui-dashboard.md §2.8).
 * Layout follows the team's alert reference: assess the urgency · follow the instructions · stay informed · be prepared.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckSquare, Square, RotateCcw, Satellite, Stethoscope } from 'lucide-react';
import type { CareDecision } from './types';

interface Props {
  decision: CareDecision;
  gameTitle: string;
  earthPacket: { id: string; delay: string } | null;
  onRetest: () => void;
  onClose: () => void;
}

export const CognitionAlert: React.FC<Props> = ({ decision, gameTitle, earthPacket, onRetest, onClose }) => {
  const [done, setDone] = useState<Record<number, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);
  const red = decision.severity === 'red';

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-hud-bg/80 p-4 backdrop-blur-sm">
      <div
        ref={ref}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cog-alert-title"
        className="game-pop max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-hud-line bg-hud-panel shadow-2xl outline-none"
      >
        <div className={`flex items-center gap-4 rounded-t-2xl px-5 py-4 ${red ? 'bg-status-red' : 'bg-status-yellow'}`}>
          <AlertTriangle className="h-12 w-12 shrink-0 text-hud-bg" aria-hidden="true" />
          <div className="text-hud-bg">
            <p className="font-display text-xs font-bold tracking-[0.25em]">{red ? 'COGNITIVE ALERT' : 'COGNITIVE CAUTION'}</p>
            <h2 id="cog-alert-title" className="font-display text-2xl font-bold">
              {red ? 'Take action now' : 'Check in before your next task'}
            </h2>
            <p className="text-sm font-medium">
              {gameTitle} · {decision.headline}
            </p>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <section aria-label="Assess the urgency">
            <h3 className="mb-2 font-display text-sm font-semibold text-hud-text">1 · Assess the urgency</h3>
            <ul className="space-y-1.5 text-sm text-hud-muted">
              {decision.reasons.map((r) => (
                <li key={r}>• {r}</li>
              ))}
            </ul>
          </section>

          <section aria-label="Stay informed">
            <h3 className="mb-2 font-display text-sm font-semibold text-hud-text">3 · Stay informed</h3>
            {decision.notifyEarth ? (
              <p className="flex gap-2 text-sm text-hud-muted">
                <Satellite className="h-4 w-4 shrink-0 text-hud-accent" aria-hidden="true" />
                {earthPacket ? (
                  <span>
                    Flight Surgeon notified (packet <span className="font-mono text-hud-text">{earthPacket.id}</span>). Earth is{' '}
                    <span className="font-mono text-hud-text">{earthPacket.delay}</span> away one-way, so the earliest reply takes twice that.
                  </span>
                ) : (
                  <span>Sending to the Flight Surgeon…</span>
                )}
              </p>
            ) : (
              <p className="flex gap-2 text-sm text-hud-muted">
                <Stethoscope className="h-4 w-4 shrink-0 text-hud-accent" aria-hidden="true" />
                Within Crew Medical Officer scope. Earth is told only if the retest is still low.
              </p>
            )}
          </section>

          <section aria-label="Follow the instructions" className="sm:col-span-2">
            <h3 className="mb-2 font-display text-sm font-semibold text-hud-text">2 · Follow the instructions</h3>
            <ul className="space-y-1">
              {decision.onboardSteps.map((s, k) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => setDone((d) => ({ ...d, [k]: !d[k] }))}
                    className="hud-focus flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm text-hud-text hover:bg-hud-line/50"
                    aria-pressed={!!done[k]}
                  >
                    {done[k] ? (
                      <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-status-green" aria-hidden="true" />
                    ) : (
                      <Square className="mt-0.5 h-4 w-4 shrink-0 text-hud-muted" aria-hidden="true" />
                    )}
                    <span className={done[k] ? 'text-hud-muted line-through' : ''}>{s}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Be prepared" className="sm:col-span-2">
            <h3 className="mb-2 font-display text-sm font-semibold text-hud-text">4 · Be prepared</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="hud-btn" onClick={onRetest}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retest after rest
              </button>
              <button type="button" className="hud-btn-primary ml-auto" onClick={onClose}>
                Acknowledge
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
