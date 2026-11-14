/**
 * ARGUS — Thousand Eyes Indicator Detail Box / Mobile Bottom Sheet
 * Opens on click, tap, or Enter on any eye in ThousandEyesRing.
 */

import React, { useEffect, useRef } from 'react';
import { LineChart, X } from 'lucide-react';
import type { MetricId } from '../../types/argus';
import { BODY_SYSTEM_META } from './indicators';
import { getTipForStat } from './engine';
import { EyeStatusBadge } from './EyeStatusBadge';
import type { EyeStat } from './types';

interface EyeDetailSheetProps {
  stat: EyeStat | null;
  locationLabel: string;
  onClose: () => void;
  onOpenTrends?: (metricId: MetricId) => void;
}

function formatNum(value: number, unit: string): string {
  const decimals = Math.abs(value) >= 100 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
}

export const EyeDetailSheet: React.FC<EyeDetailSheetProps> = ({
  stat,
  locationLabel,
  onClose,
  onOpenTrends,
}) => {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!stat) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stat, onClose]);

  if (!stat) {
    return (
      <div className="hidden sm:flex hud-card flex-col items-center justify-center p-6 text-center text-sm text-hud-muted min-h-[260px]">
        <p className="font-display text-xs uppercase tracking-wider text-hud-text">
          Select an eye
        </p>
        <p className="mt-1.5 max-w-xs text-xs text-hud-muted">
          Click, tap, or use arrow keys + Enter on any of the 31 eyes to inspect its value,
          personal baseline, expected spaceflight shift, and plain-language guidance.
        </p>
      </div>
    );
  }

  const { indicator, status, currentValue, baseline, expectedShift, ewmaZ, n } = stat;
  const sysMeta = BODY_SYSTEM_META[indicator.system];
  const tip = getTipForStat(stat);
  const shiftSign = expectedShift > 0 ? '+' : '';
  const hasRedBounds = indicator.redLow !== null || indicator.redHigh !== null;

  return (
    <>
      {/* Mobile backdrop for bottom sheet */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs sm:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <section
        role="region"
        aria-label={`${indicator.label} details`}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[82vh] overflow-y-auto rounded-t-2xl border border-hud-line bg-hud-panel p-4 shadow-2xl sm:static sm:z-auto sm:max-h-none sm:rounded-xl sm:bg-hud-panel/70 sm:backdrop-blur-sm"
      >
        {/* Mobile drag handle visual */}
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-600 sm:hidden" aria-hidden="true" />

        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: sysMeta.color }}
                aria-hidden="true"
              />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-hud-muted">
                {indicator.system}
              </span>
              <EyeStatusBadge status={status} />
            </div>
            <h3 className="mt-1 font-display text-base font-semibold text-hud-text">
              {indicator.label}
            </h3>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close indicator details"
            className="hud-btn shrink-0 p-1.5"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        {/* Primary value + drift */}
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <div className="rounded-lg border border-hud-line bg-hud-bg/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-hud-muted">Current value</div>
            <div className="mt-1 font-mono text-lg font-semibold text-hud-text">
              {status === 'nodata' || currentValue === null
                ? 'No data'
                : formatNum(currentValue, indicator.unit)}
            </div>
            {n > 0 && (
              <div className="mt-0.5 text-[11px] text-hud-muted">{n} readings logged</div>
            )}
          </div>

          <div className="rounded-lg border border-hud-line bg-hud-bg/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-hud-muted">Personal drift</div>
            <div className="mt-1 font-mono text-lg font-semibold text-hud-text">
              {ewmaZ === null ? '—' : `${ewmaZ >= 0 ? '+' : ''}${ewmaZ.toFixed(1)} σ`}
            </div>
            <div className="mt-0.5 text-[11px] text-hud-muted">EWMA vs personal baseline</div>
          </div>
        </div>

        {/* Baseline & Expected Shift */}
        <dl className="mt-3 space-y-2 rounded-lg border border-hud-line bg-hud-bg/40 p-3 text-xs">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-hud-muted">Personal baseline</dt>
            <dd className="font-mono text-hud-text">
              {baseline
                ? `${formatNum(baseline.mean, '')} ± ${formatNum(baseline.sd, indicator.unit)} (${baseline.n}d${baseline.provisional ? ', provisional' : ''})`
                : 'Waiting for baseline'}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-hud-muted">Expected shift ({locationLabel})</dt>
            <dd className="font-mono text-hud-text">
              {expectedShift === 0
                ? 'None (0)'
                : `${shiftSign}${formatNum(expectedShift, indicator.unit)}`}
            </dd>
          </div>
          {hasRedBounds && (
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-hud-muted">Red-flag limits</dt>
              <dd className="font-mono text-status-red">
                {[
                  indicator.redLow !== null ? `< ${indicator.redLow}` : null,
                  indicator.redHigh !== null ? `> ${indicator.redHigh}` : null,
                ]
                  .filter(Boolean)
                  .join(' or ')}{' '}
                {indicator.unit}
              </dd>
            </div>
          )}
        </dl>

        {/* Plain-language tip & how to measure */}
        <div className="mt-3 space-y-2 text-xs">
          <div className="rounded-lg border border-hud-accent/30 bg-hud-accent/5 p-3">
            <div className="font-semibold uppercase tracking-wide text-hud-accent">
              Plain-language tip
            </div>
            <p className="mt-1 text-hud-text leading-relaxed">{tip}</p>
          </div>

          <div className="rounded-lg border border-hud-line bg-hud-bg/40 p-3">
            <div className="font-semibold uppercase tracking-wide text-hud-muted">
              How to measure
            </div>
            <p className="mt-1 text-hud-text leading-relaxed">{indicator.how}</p>
            <p className="mt-2 text-[11px] text-hud-muted leading-relaxed">{sysMeta.nasaContext}</p>
          </div>
        </div>

        {indicator.argusMetricId && onOpenTrends && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="hud-btn-primary text-xs px-3 py-1.5"
              onClick={() => onOpenTrends(indicator.argusMetricId!)}
            >
              <LineChart className="h-3.5 w-3.5" aria-hidden="true" />
              Open in Trends
            </button>
          </div>
        )}
      </section>
    </>
  );
};
