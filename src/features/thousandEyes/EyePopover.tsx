/**
 * ARGOS — details for one eye. Popover anchored to the eye on desktop, bottom sheet on mobile.
 * Closes with Esc, a click outside, or the close button.
 */

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { SYSTEM_COLORS } from './indicators';
import { adviceFor, fmt } from './science';
import { statusStyle } from './statusColors';
import type { IndicatorStatus } from './types';

const num = (x: number | undefined) => {
  if (x == null || !Number.isFinite(x)) return '–';
  const d = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2;
  return String(+x.toFixed(d));
};

const signed = (x: number) => `${x > 0 ? '+' : '−'}${num(Math.abs(x))}`;

function useIsMobile(): boolean {
  const q = '(max-width: 639px)';
  const [m, setM] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(q);
    if (!mq) return;
    const on = () => setM(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return m;
}

export interface EyePopoverProps {
  status: IndicatorStatus;
  /** Eye position in % of the ring box. */
  anchor: { xPct: number; yPct: number };
  locationLabel: string;
  containerRef: React.RefObject<HTMLDivElement>;
  onClose: () => void;
}


const READINESS_TEXT = {
  'flight-proven': 'Flown on crew',
  cleared: 'Cleared device',
  research: 'Research sensor, trend only',
} as const;

export const EyePopover: React.FC<EyePopoverProps> = ({ status: s, anchor, locationLabel, containerRef, onClose }) => {
  const mobile = useIsMobile();
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ind = s.indicator;
  const st = statusStyle(s.n ? s.status : undefined);
  const tip = adviceFor(s);
  const titleId = `te-pop-${ind.key}`;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t)) return;
      // Clicks on other eyes are handled by the ring itself (switches the box).
      if ((t as Element).closest?.('.te-eye') && containerRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose, containerRef]);

  // Desktop: beside the eye, flipped toward the centre so it stays inside the ring box.
  const right = anchor.xPct > 50;
  const below = anchor.yPct < 50;
  const style: React.CSSProperties = mobile
    ? {}
    : {
        left: right ? undefined : `calc(${anchor.xPct}% + 18px)`,
        right: right ? `calc(${100 - anchor.xPct}% + 18px)` : undefined,
        top: below ? `calc(${anchor.yPct}% - 12px)` : undefined,
        bottom: below ? undefined : `calc(${100 - anchor.yPct}% - 12px)`,
      };

  const shift = s.expectedShift;

  return (
    <>
      {mobile && <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" />}
      <div
        ref={boxRef}
        role="dialog"
        aria-modal={mobile || undefined}
        aria-labelledby={titleId}
        className={
          mobile
            ? 'fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-cyan-400/40 bg-slate-950/95 p-4 pb-6 shadow-2xl backdrop-blur'
            : 'absolute z-30 w-72 rounded-xl border border-cyan-400/40 bg-slate-950/95 p-3.5 shadow-[0_0_24px_rgba(34,211,238,0.18)] backdrop-blur'
        }
        style={style}
      >
        {mobile && <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-600" aria-hidden="true" />}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id={titleId} className="text-sm font-semibold text-slate-100">
              {ind.label}
            </h3>
            <div className="text-[11px] font-medium" style={{ color: SYSTEM_COLORS[ind.system] }}>
              {ind.system}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            aria-label="Close details"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {s.n ? (
          <div className="mt-2.5 space-y-1.5">
            <div className="font-mono text-2xl font-semibold text-slate-50">
              {num(s.current)} <span className="text-sm font-normal text-slate-400">{ind.unit}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: st.color }}>
              <span aria-hidden="true">{st.symbol}</span>
              <span>{st.text}</span>
              {s.z != null && <span className="font-mono font-normal normal-case text-slate-400">· {fmt(s.z, 1)}σ</span>}
            </div>
            {s.baseline && (
              <div className="text-xs text-slate-300">
                Baseline {num(s.baseline.mean)} {ind.unit}
                {s.baseline.provisional && <span className="text-slate-500"> (provisional)</span>}
                {shift !== 0 && (
                  <span className="text-slate-400">
                    {' '}
                    (expected {signed(shift)} at {locationLabel})
                  </span>
                )}
              </div>
            )}
            {tip && (
              <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900/80 p-2 text-xs text-slate-200">
                <span className="font-semibold text-cyan-300">How to bring it back: </span>
                {tip}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-2.5 space-y-1.5 text-xs text-slate-300">
            <div className="flex items-center gap-1.5 font-bold uppercase" style={{ color: st.color }}>
              <span aria-hidden="true">{st.symbol}</span> No data yet
            </div>
            <div>
              <span className="text-slate-400">How to measure: </span>
              {ind.how}
            </div>
          </div>
        )}

        {ind.sensor && (
          <dl className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 border-t border-slate-800 pt-2 text-[11px]">
            <dt className="text-slate-400">Sample</dt>
            <dd className="text-slate-200">{ind.sensor.sample}</dd>
            <dt className="text-slate-400">Sensor</dt>
            <dd className="text-slate-200">{ind.sensor.device}</dd>
            <dt className="text-slate-400">Cadence</dt>
            <dd className="text-slate-200">{ind.sensor.cadence}</dd>
            <dt className="text-slate-400">Status</dt>
            <dd className="text-slate-200">
              {READINESS_TEXT[ind.sensor.readiness]} · <span className="font-mono text-slate-400">{ind.sensor.sources.join(', ')}</span>
            </dd>
            {ind.sensor.caveat && <dd className="col-span-2 mt-1 text-amber-200/90">{ind.sensor.caveat}</dd>}
          </dl>
        )}
      </div>
    </>
  );
};
