/**
 * ARGUS — Longitudinal Telemetry & Vital Drift Panel (`TelemetryPanel.tsx`)
 * Single Source of Truth: specs/02-ui-dashboard.md (§1 Center Column — 40%)
 */

import React from 'react';
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
import {
  Activity,
  Calendar,
  Info,
  TrendingUp,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { BODY_ZONES } from '../data/telemetryScenarios';
import {
  ENVIRONMENT_META,
  evaluateMetricStatus,
  formatFlightNormBadge,
  getMetricThreshold,
  STATUS_COLORS,
  STATUS_LABELS,
} from '../utils/triageEngine';

export const TelemetryPanel: React.FC = () => {
  const {
    environment,
    selectedZone,
    selectedMetricId,
    setSelectedMetricId,
    currentZoneReadings,
    chartWindowDays,
    setChartWindowDays,
    zoneStatuses,
  } = useMission();

  const zoneMeta = BODY_ZONES[selectedZone];
  const zoneStatus = zoneStatuses[selectedZone];
  const envMeta = ENVIRONMENT_META[environment];

  const activeReading =
    currentZoneReadings.find((r) => r.metricId === selectedMetricId) ||
    currentZoneReadings[0];

  const activeThreshold = getMetricThreshold(
    activeReading.metricId,
    environment
  );
  const activeMetricStatus = evaluateMetricStatus(
    activeReading.metricId,
    activeReading.currentValue,
    environment
  );
  const activeColor = STATUS_COLORS[activeMetricStatus];

  const slicedHistory =
    chartWindowDays === 14
      ? activeReading.history.slice(-14)
      : activeReading.history;

  // Compute Y-axis domain so both the data series and the ReferenceArea nominal band are clearly visible
  const values = slicedHistory.map((p) => p.value);
  const minVal = Math.min(
    ...values,
    activeThreshold.nominalMin,
    activeThreshold.yellowMin
  );
  const maxVal = Math.max(
    ...values,
    activeThreshold.nominalMax,
    activeThreshold.yellowMax
  );
  const padding = Math.max(0.4, (maxVal - minVal) * 0.16);
  const yDomain: [number, number] = [
    Math.round((minVal - padding) * 10) / 10,
    Math.round((maxVal + padding) * 10) / 10,
  ];

  return (
    <section
      aria-label="Zone Vital Telemetry and Longitudinal Drift"
      className="flex flex-col h-full bg-slate-900/60 border border-cyan-500/20 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(2,6,23,0.8)]"
    >
      {/* Top Header */}
      <div className="px-4 py-3 border-b border-slate-800/90 bg-slate-950/60 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h2 className="font-mono text-xs md:text-sm font-bold uppercase tracking-wider text-slate-100">
              {zoneMeta.name} <span className="text-cyan-400">//</span> TELEMETRY
            </h2>
            <span
              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase"
              style={{
                backgroundColor: `${STATUS_COLORS[zoneStatus]}20`,
                color: STATUS_COLORS[zoneStatus],
                border: `1px solid ${STATUS_COLORS[zoneStatus]}50`,
              }}
            >
              {STATUS_LABELS[zoneStatus]}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {zoneMeta.nasaHazardFocus}
          </p>
        </div>
      </div>

      {/* Vital Sign Cards Grid */}
      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-2 border-b border-slate-800/80 bg-slate-950/30">
        {currentZoneReadings.map((reading) => {
          const mStatus = evaluateMetricStatus(
            reading.metricId,
            reading.currentValue,
            environment
          );
          const mColor = STATUS_COLORS[mStatus];
          const isSelected = reading.metricId === activeReading.metricId;
          const normBadge = formatFlightNormBadge(
            reading.metricId,
            reading.unit,
            environment
          );

          return (
            <button
              key={reading.metricId}
              type="button"
              onClick={() => setSelectedMetricId(reading.metricId)}
              className={`text-left p-2.5 rounded-xl border transition-all flex flex-col justify-between ${
                isSelected
                  ? 'bg-slate-900/95 border-cyan-400/70 shadow-[0_0_16px_rgba(34,211,238,0.18)]'
                  : 'bg-slate-900/50 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-1.5 mb-0.5">
                  <span className="font-mono text-[11px] font-semibold text-slate-300 truncate">
                    {reading.label}
                  </span>
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: mColor }}
                    title={`Status: ${STATUS_LABELS[mStatus]}`}
                  />
                </div>

                {/* Value & Unit */}
                <div className="flex items-baseline gap-1.5 my-0.5">
                  <span
                    className="font-mono text-xl font-bold tracking-tight"
                    style={{ color: mColor }}
                  >
                    {reading.currentValue}
                  </span>
                  <span className="font-mono text-xs text-slate-400">
                    {reading.unit}
                  </span>
                </div>
              </div>

              {/* Flight Norm Badge & Delta */}
              <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 flex flex-col gap-0.5">
                <span className="inline-block w-fit px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 font-mono text-[10px] text-cyan-300 truncate max-w-full">
                  {normBadge}
                </span>
                <span className="font-mono text-[10px] text-slate-400 truncate">
                  {reading.deltaFromBaseline}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Vital Plain-Language Banner */}
      <div className="px-4 py-2 bg-slate-950/70 border-b border-slate-800/80 flex items-start gap-2">
        <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-300 leading-relaxed">
          <span className="font-mono font-semibold text-cyan-300">
            {activeReading.label}:
          </span>{' '}
          {activeReading.plainDescription}
        </p>
      </div>

      {/* Longitudinal Recharts AreaChart with Shaded Nominal ReferenceArea */}
      <div className="flex-1 flex flex-col p-4 min-h-[270px]">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-cyan-400" />
            <div>
              <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-slate-200">
                {chartWindowDays}-Day Longitudinal Drift // {activeReading.label} ({activeReading.unit})
              </h3>
              <p className="text-[11px] text-slate-400">
                Shaded green band shows nominal {envMeta.shortLabel} corridor (
                {activeThreshold.nominalMin}–{activeThreshold.nominalMax}{' '}
                {activeReading.unit})
              </p>
            </div>
          </div>

          {/* 14d / 30d Window Switcher */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <Calendar className="w-3.5 h-3.5 text-cyan-400 ml-1.5 mr-1" />
            {([14, 30] as const).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setChartWindowDays(days)}
                className={`px-2.5 py-1 rounded text-[11px] font-mono font-medium transition-colors ${
                  chartWindowDays === days
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {days}D
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 w-full min-h-[210px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={slicedHistory}
              margin={{ top: 10, right: 16, left: -12, bottom: 4 }}
            >
              <defs>
                <linearGradient id="vitalFillGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={activeColor} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={activeColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(148, 163, 184, 0.1)"
              />
              <XAxis
                dataKey="dateLabel"
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
              />
              <YAxis
                domain={yDomain}
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#020617',
                  borderColor: 'rgba(34, 211, 238, 0.4)',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  color: '#f1f5f9',
                }}
                formatter={(val: number) => [
                  `${val} ${activeReading.unit}`,
                  activeReading.label,
                ]}
              />

              {/* Shaded Nominal Range Corridor per specs/02-ui-dashboard.md */}
              <ReferenceArea
                y1={activeThreshold.nominalMin}
                y2={activeThreshold.nominalMax}
                fill="#22c55e"
                fillOpacity={0.13}
                stroke="#22c55e"
                strokeOpacity={0.35}
                strokeDasharray="3 3"
              />

              {/* Upper & Lower Caution Reference Lines */}
              <ReferenceLine
                y={activeThreshold.yellowMax}
                stroke="#eab308"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              />
              <ReferenceLine
                y={activeThreshold.yellowMin}
                stroke="#eab308"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              />

              <Area
                type="monotone"
                dataKey="value"
                stroke={activeColor}
                strokeWidth={2.5}
                fill="url(#vitalFillGrad)"
                activeDot={{
                  r: 5,
                  fill: activeColor,
                  stroke: '#020617',
                  strokeWidth: 2,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend Footer */}
        <div className="mt-2 pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-2 rounded-sm bg-emerald-500/30 border border-emerald-400/60 inline-block" />
              Nominal Corridor ({activeThreshold.nominalMin}–
              {activeThreshold.nominalMax} {activeReading.unit})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-amber-400 inline-block" />
              Yellow Drift Boundary ({activeThreshold.yellowMin}–
              {activeThreshold.yellowMax} {activeReading.unit})
            </span>
          </div>
          <span style={{ color: activeColor }} className="font-bold">
            MD-30 CURRENT: {activeReading.currentValue} {activeReading.unit}
          </span>
        </div>
      </div>
    </section>
  );
};
