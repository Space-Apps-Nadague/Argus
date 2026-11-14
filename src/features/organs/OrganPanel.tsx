/**
 * ARGUS — details for one organ (same style as the Thousand Eyes box).
 * Desktop: card over the 3D stage. Mobile: bottom sheet. Closes with Esc or ✕.
 */

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { SYSTEM_COLORS } from '../thousandEyes/indicators';
import { adviceFor, fmt } from '../thousandEyes/science';
import { statusStyle } from '../thousandEyes/statusColors';
import type { OrganState } from './organs';

const num = (x: number | undefined) => {
  if (x == null || !Number.isFinite(x)) return '–';
  const d = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2;
  return String(+x.toFixed(d));
};
const signed = (x: number) => `${x > 0 ? '+' : '−'}${num(Math.abs(x))}`;

export const OrganPanel: React.FC<{ state: OrganState; locationLabel: string; onClose: () => void }> = ({
  state,
  locationLabel,
  onClose,
}) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const top = statusStyle(state.status);
  const titleId = `organ-panel-${state.organ.id}`;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, state.organ.id]);

  // Problems first, then on-baseline, then no data.
  const rank = (s: OrganState['indicators'][number]) => (s.n ? (s.status === 2 ? 0 : s.status === 1 ? 1 : 2) : 3);
  const rows = [...state.indicators].sort((a, b) => rank(a) - rank(b));

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      className="absolute inset-x-2 bottom-2 z-30 max-h-[70%] overflow-y-auto rounded-2xl border border-cyan-400/40 bg-slate-950/95 p-3.5 shadow-2xl backdrop-blur sm:inset-x-auto sm:bottom-auto sm:right-3 sm:top-3 sm:w-80"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={titleId} className="text-sm font-semibold text-slate-100">
            {state.organ.label}
          </h3>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: top.color }}>
            <span aria-hidden="true">{top.symbol}</span>
            <span>{top.text}</span>
          </div>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
          aria-label="Close organ details"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {rows.map((s) => {
          const st = statusStyle(s.n ? s.status : undefined);
          const tip = adviceFor(s);
          const ind = s.indicator;
          return (
            <li key={s.key} className="rounded-lg border border-slate-800 bg-slate-900/70 p-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium" style={{ color: SYSTEM_COLORS[ind.system] }}>
                  {ind.label}
                </span>
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase" style={{ color: st.color }}>
                  <span aria-hidden="true">{st.symbol}</span>
                  {st.text}
                </span>
              </div>
              {s.n ? (
                <>
                  <div className="mt-0.5 font-mono text-base text-slate-50">
                    {num(s.current)} <span className="text-xs text-slate-400">{ind.unit}</span>
                    {s.z != null && <span className="ml-1 text-[11px] text-slate-500">· {fmt(s.z, 1)}σ</span>}
                  </div>
                  {s.baseline && (
                    <div className="text-[11px] text-slate-400">
                      Baseline {num(s.baseline.mean)} {ind.unit}
                      {s.baseline.provisional && ' (provisional)'}
                      {s.expectedShift !== 0 && ` (expected ${signed(s.expectedShift)} at ${locationLabel})`}
                    </div>
                  )}
                  {tip && (
                    <div className="mt-1 text-[11px] text-slate-200">
                      <span className="font-semibold text-cyan-300">Bring it back: </span>
                      {tip}
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-0.5 text-[11px] text-slate-400">
                  No data yet · <span className="text-slate-300">{ind.how}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
