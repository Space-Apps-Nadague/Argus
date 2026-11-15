/**
 * ARGUS — Continuous Glucose Monitor (CGM) 24h Panel (specs/02-ui-dashboard.md §2.2)
 * Displays 5-minute interstitial glucose curve, trend arrow, and Time-in-Range (70–140 mg/dL)
 * for the active crew member when Blood Glucose is selected.
 */

import React, { useMemo } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMission } from '../context/MissionContext';
import { CgmTrendArrow, getCrewCgmMockData } from '../data/cgmMockData';
import { InfoTip } from './InfoTip';
import { Card } from './ui/Card';

const TREND_META: Record<CgmTrendArrow, { label: string; Icon: React.FC<{ className?: string }> }> = {
  double_up: { label: 'Rising rapidly', Icon: ArrowUp },
  single_up: { label: 'Rising', Icon: ArrowUp },
  forty_five_up: { label: 'Rising slowly', Icon: ArrowUpRight },
  flat: { label: 'Steady', Icon: ArrowRight },
  forty_five_down: { label: 'Falling slowly', Icon: ArrowDownRight },
  single_down: { label: 'Falling', Icon: ArrowDown },
  double_down: { label: 'Falling rapidly', Icon: ArrowDown },
};

function formatMinute(minuteOfDay: number): string {
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, '0');
  const mm = String(minuteOfDay % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export const CgmPanel: React.FC = () => {
  const { activeCrewId } = useMission();
  const dataset = useMemo(() => getCrewCgmMockData(activeCrewId), [activeCrewId]);

  const latest = dataset.readings[dataset.readings.length - 1];
  const trend = TREND_META[latest.trendArrow];
  const TrendIcon = trend.Icon;

  const chartData = useMemo(
    () =>
      dataset.readings.map((r) => ({
        time: formatMinute(r.minuteOfDay),
        glucose: r.glucoseMgDl,
        event: r.eventTag,
      })),
    [dataset.readings],
  );

  const glucoseColor =
    latest.glucoseMgDl < 60 || latest.glucoseMgDl > 140
      ? 'text-status-red'
      : latest.glucoseMgDl < 70 || latest.glucoseMgDl > 110
        ? 'text-status-yellow'
        : 'text-status-green';

  return (
    <Card
      icon={<Activity className="h-4 w-4" />}
      title={
        <span className="flex items-center gap-2">
          CGM 24h Stream
          <span className="rounded border border-hud-line bg-hud-bg/60 px-1.5 py-0.5 font-mono text-[10px] font-normal text-hud-muted">
            {dataset.sensorSerial}
          </span>
        </span>
      }
      actions={
        <InfoTip label="About CGM stream" align="right">
          5-minute interstitial glucose from the worn CGM patch (288 readings/day). Target Time-in-Range is 70–140 mg/dL
          with CV &lt; 36%.
        </InfoTip>
      }
    >
      <div className="space-y-4 min-w-0">
        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 min-w-0">
          <div className="rounded-lg border border-hud-line bg-hud-bg/50 px-3 py-2">
            <p className="text-[11px] text-hud-muted">Latest CGM</p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className={`font-mono text-xl font-semibold ${glucoseColor}`}>
                {latest.glucoseMgDl}
              </span>
              <span className="text-xs text-hud-muted">mg/dL</span>
              <TrendIcon className="h-4 w-4 text-hud-accent" aria-label={trend.label} />
            </div>
            <p className="text-[10px] text-hud-muted">{trend.label}</p>
          </div>

          <div className="rounded-lg border border-hud-line bg-hud-bg/50 px-3 py-2">
            <p className="text-[11px] text-hud-muted">Time in Range</p>
            <p className="mt-0.5 font-mono text-xl font-semibold text-status-green">
              {dataset.timeInRangePct.toFixed(1)}%
            </p>
            <p className="text-[10px] text-hud-muted">70–140 mg/dL</p>
          </div>

          <div className="rounded-lg border border-hud-line bg-hud-bg/50 px-3 py-2">
            <p className="text-[11px] text-hud-muted">24h Mean / CV</p>
            <p className="mt-0.5 font-mono text-xl font-semibold text-hud-text">
              {dataset.meanGlucoseMgDl.toFixed(0)}
              <span className="ml-1 text-xs font-normal text-hud-muted">mg/dL</span>
            </p>
            <p className="text-[10px] text-hud-muted">CV {dataset.cvPct.toFixed(1)}%</p>
          </div>

          <div className="rounded-lg border border-hud-line bg-hud-bg/50 px-3 py-2">
            <p className="text-[11px] text-hud-muted">Excursions</p>
            <p className="mt-0.5 font-mono text-sm font-semibold text-hud-text">
              <span className="text-status-yellow">{dataset.lowPct.toFixed(1)}%</span> low ·{' '}
              <span className="text-status-yellow">{dataset.highPct.toFixed(1)}%</span> high
            </p>
            <p className="text-[10px] text-hud-muted">5-min cadence</p>
          </div>
        </div>

        {/* 24h CGM curve */}
        <div className="h-52 w-full min-w-0" aria-label="24-hour continuous glucose monitor chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
              <XAxis
                dataKey="time"
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                interval={35}
                stroke="rgba(148,163,184,0.2)"
              />
              <YAxis
                domain={[50, 180]}
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                stroke="rgba(148,163,184,0.2)"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: 'rgba(56,189,248,0.3)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#e2e8f0',
                }}
                formatter={(value: number) => [`${value} mg/dL`, 'CGM Glucose']}
              />
              <ReferenceArea y1={70} y2={140} fill="#22c55e" fillOpacity={0.08} />
              <ReferenceLine y={140} stroke="#eab308" strokeDasharray="4 4" strokeOpacity={0.6} />
              <ReferenceLine y={70} stroke="#eab308" strokeDasharray="4 4" strokeOpacity={0.6} />
              <Area
                type="monotone"
                dataKey="glucose"
                stroke="#38bdf8"
                strokeWidth={2}
                fill="#38bdf8"
                fillOpacity={0.18}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
};
