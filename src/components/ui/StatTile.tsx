/**
 * ARGUS — StatTile + DriftChip primitives (specs/02-ui-dashboard.md §3)
 * Big value, small unit, status pill, optional personal-baseline drift chip and ⓘ.
 */

import React from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { DriftResult, TriageStatus } from '../../types/argus';
import { formatSigma } from '../../utils/driftAnalytics';
import { InfoTip } from '../InfoTip';
import { StatusPill } from './StatusPill';

const DRIFT_WORD = { steady: 'Steady', watch: 'Watch', drifting: 'Drifting' } as const;

export const DriftChip: React.FC<{ drift: DriftResult | null; showWord?: boolean }> = ({
  drift,
  showWord = false,
}) => {
  if (!drift) return null;
  const Icon = drift.direction === 'up' ? ArrowUpRight : drift.direction === 'down' ? ArrowDownRight : ArrowRight;
  const tone =
    drift.level === 'drifting'
      ? 'text-hud-drift border-hud-drift/60 bg-hud-drift/15'
      : drift.level === 'watch'
      ? 'text-hud-drift border-hud-drift/35 bg-hud-drift/5'
      : 'text-hud-muted border-hud-line bg-transparent';
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap ${tone}`}
      title="Change vs your first-week baseline"
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {formatSigma(drift.ewmaZ)}
      {showWord && <span className="font-sans ml-0.5">{DRIFT_WORD[drift.level]}</span>}
      <span className="sr-only"> vs your baseline, {DRIFT_WORD[drift.level]}</span>
    </span>
  );
};

interface StatTileProps {
  label: string;
  value: number | string;
  unit: string;
  status: TriageStatus;
  drift?: DriftResult | null;
  extraBadge?: React.ReactNode;
  info?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
}

export const StatTile: React.FC<StatTileProps> = ({
  label,
  value,
  unit,
  status,
  drift,
  extraBadge,
  info,
  selected = false,
  onClick,
}) => {
  const body = (
    <>
      <span className="block text-[13px] font-medium text-hud-text/90 leading-tight">{label}</span>
      <span className="mt-1.5 flex items-baseline gap-1">
        <span className="font-mono text-2xl font-semibold tracking-tight text-hud-text">{value}</span>
        <span className="font-mono text-xs text-hud-muted">{unit}</span>
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusPill status={status} />
        <DriftChip drift={drift ?? null} />
        {extraBadge}
      </span>
    </>
  );
  return (
    <div className={`hud-tile relative ${selected ? 'hud-tile-selected' : ''}`}>
      {onClick ? (
        <button type="button" onClick={onClick} aria-pressed={selected} className="hud-focus block w-full text-left rounded-xl p-3 pr-9">
          {body}
        </button>
      ) : (
        <div className="p-3 pr-9">{body}</div>
      )}
      {info && (
        <span className="absolute right-1.5 top-1.5">
          <InfoTip label={`About ${label}`} align="right">{info}</InfoTip>
        </span>
      )}
    </div>
  );
};
