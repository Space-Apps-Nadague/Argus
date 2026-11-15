/**
 * ARGUS — 24h Continuous Glucose Monitoring (CGM) Card (specs/02-ui-dashboard.md §2.2)
 * Sources: SRC-083 (Time in Range 70–140 mg/dL, trend arrows), SRC-028 (Polaris Dawn CGM).
 */

import React, { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity } from 'lucide-react';
import type { ScenarioId } from '../types/argus';
import {
  CGM_TARGET_HIGH_MG_DL,
  CGM_TARGET_LOW_MG_DL,
  type CgmEventTag,
  computeCgmTrendArrow,
  computeTimeInRange,
  generateCgm24hCurve,
} from '../data/cgmMockData';
import { STATUS_COLORS } from '../utils/triageEngine';
import { InfoTip } from './InfoTip';
import { Card } from './ui/Card';
import { StatusPill } from './ui/StatusPill';

const EVENT_TAG_LABEL: Record<CgmEventTag, string> = {
  nocturnal: 'Nocturnal baseline',
  postprandial: 'Postprandial peak',
  ared_dip: 'ARED exercise dip',
  baseline: 'Daytime baseline',
};

export interface CgmGlucoseCardProps {
  crewId: string;
  scenarioId: ScenarioId;
  missionDay?: number;
  baselineMgDl?: number;
}

export const CgmGlucoseCard: React.FC<CgmGlucoseCardProps> = ({
  crewId,
  scenarioId,
  missionDay = 30,
  baselineMgDl,
}) => {
  const curve = useMemo(
    () =>
      generateCgm24hCurve({
        crewId,
        scenarioId,
        missionDay,
        baselineMgDl,
      }),
    [crewId, scenarioId, missionDay, baselineMgDl]
  );

  const trend = useMemo(() => computeCgmTrendArrow(curve), [curve]);
  const tir = useMemo(() => computeTimeInRange(curve), [curve]);
  const latest = curve[curve.length - 1];
  const lineColor = STATUS_COLORS[tir.status];

  const yDomain = useMemo<[number, number]>(() => {
    const lo = Math.min(55, tir.minMgDl - 8);
    const hi = Math.max(160, tir.maxMgDl + 12);
    return [lo, hi];
  }, [tir.minMgDl, tir.maxMgDl]);

  const figureLabel = `24-hour 5-minute CGM glucose curve. Current ${latest.glucoseMgDl} mg/dL, trend ${trend.label} (${trend.arrow}). Time in range ${CGM_TARGET_LOW_MG_DL} to ${CGM_TARGET_HIGH_MG_DL} mg/dL is ${tir.percentInRange} percent. Mean ${tir.meanMgDl} mg/dL, range ${tir.minMgDl} to ${tir.maxMgDl} mg/dL.`;

  return (
    <Card
      icon={<Activity className="h-4 w-4" />}
      title="CGM · 24h Glucose"
      actions={
        <div className="flex items-center gap-2">
          <StatusPill status={tir.status} size="sm" />
          <InfoTip label="About 24h CGM glucose" align="right">
            <span className="block">
              5-minute interstitial glucose from the worn CGM patch, showing nocturnal baselines, post-meal peaks, and ARED resistive exercise dips.
            </span>
            <span className="mt-1 block font-mono text-hud-accent">
              Target TIR: {CGM_TARGET_LOW_MG_DL}–{CGM_TARGET_HIGH_MG_DL} mg/dL (≥70% Nominal)
            </span>
          </InfoTip>
        </div>
      }
      bodyClassName="px-3 pb-4 md:px-4 space-y-3"
    >
      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 min-w-0">
        <div className="rounded-lg border border-hud-line bg-hud-bg/50 px-3 py-2 min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-hud-muted">Current &amp; Trend</p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-xl font-semibold text-hud-text">
              {latest.glucoseMgDl} <span className="text-xs font-normal text-hud-muted">mg/dL</span>
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-full border border-hud-accent/40 bg-hud-accent/10 px-2 py-0.5 font-mono text-xs text-hud-accent"
              aria-label={`Glucose trend: ${trend.label}`}
            >
              <span aria-hidden="true">{trend.arrow}</span>
              <span>{trend.label}</span>
            </span>
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-hud-muted">
            {trend.rateMgDlPerMin >= 0 ? '+' : ''}
            {trend.rateMgDlPerMin.toFixed(1)} mg/dL/min
          </p>
        </div>

        <div className="rounded-lg border border-hud-line bg-hud-bg/50 px-3 py-2 min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-hud-muted">
            Time in Range ({CGM_TARGET_LOW_MG_DL}–{CGM_TARGET_HIGH_MG_DL})
          </p>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="font-mono text-xl font-semibold text-hud-text">{tir.percentInRange}%</span>
            <StatusPill status={tir.status} size="sm" />
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-hud-muted">
            &lt;{CGM_TARGET_LOW_MG_DL}: {tir.percentBelow}% · &gt;{CGM_TARGET_HIGH_MG_DL}: {tir.percentAbove}%
          </p>
        </div>

        <div className="rounded-lg border border-hud-line bg-hud-bg/50 px-3 py-2 min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-hud-muted">24h Mean &amp; Range</p>
          <p className="mt-0.5 font-mono text-xl font-semibold text-hud-text">
            {tir.meanMgDl} <span className="text-xs font-normal text-hud-muted">mg/dL</span>
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-hud-muted">
            {tir.minMgDl}–{tir.maxMgDl} mg/dL ({curve.length} pts)
          </p>
        </div>
      </div>

      {/* 24h 5-minute CGM Chart */}
      <figure aria-label={figureLabel} className="min-w-0">
        <div className="h-[220px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={curve} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="cgmFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={lineColor} stopOpacity={0.28} />
                  <stop offset="95%" stopColor={lineColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
              <XAxis
                dataKey="timeLabel"
                stroke="#475569"
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                interval={35}
                minTickGap={24}
              />
              <YAxis
                domain={yDomain}
                stroke="#475569"
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                width={42}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#020617',
                  borderColor: '#1e293b',
                  borderRadius: 8,
                  fontSize: 12,
                  color: '#f1f5f9',
                }}
                formatter={(val: number, _name: string, item: { payload?: { eventTag?: CgmEventTag } }) => {
                  const tag = item?.payload?.eventTag ? EVENT_TAG_LABEL[item.payload.eventTag] : 'CGM';
                  return [`${val} mg/dL`, tag];
                }}
                labelFormatter={(label) => `UTC ${label}`}
              />
              <ReferenceArea
                y1={CGM_TARGET_LOW_MG_DL}
                y2={CGM_TARGET_HIGH_MG_DL}
                fill="#22c55e"
                fillOpacity={0.1}
                stroke="#22c55e"
                strokeOpacity={0.3}
                strokeDasharray="3 3"
              />
              <ReferenceLine y={CGM_TARGET_LOW_MG_DL} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.5} />
              <ReferenceLine y={CGM_TARGET_HIGH_MG_DL} stroke="#eab308" strokeDasharray="4 4" strokeOpacity={0.55} />
              <Area
                type="monotone"
                dataKey="glucoseMgDl"
                stroke={lineColor}
                strokeWidth={2}
                fill="url(#cgmFill)"
                dot={false}
                activeDot={{ r: 4, fill: lineColor, stroke: '#020617', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-hud-muted">
        <li className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-3.5 rounded-sm border border-status-green/60 bg-status-green/20"
            aria-hidden="true"
          />
          Target TIR {CGM_TARGET_LOW_MG_DL}–{CGM_TARGET_HIGH_MG_DL} mg/dL
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-3.5 border-t-2 border-dashed border-status-yellow" aria-hidden="true" />
          Upper target ({CGM_TARGET_HIGH_MG_DL} mg/dL)
        </li>
        <li>5-min CGM · Meal peaks &amp; ARED exercise dips</li>
      </ul>
    </Card>
  );
};
