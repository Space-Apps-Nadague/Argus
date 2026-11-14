/**
 * ARGUS — Longitudinal Telemetry & Interactive Vital Logging Panel (`TelemetryPanel.tsx`)
 * Single Source of Truth: specs/01-data-schema.md (§2, §6) & specs/02-ui-dashboard.md (§2.2)
 *
 * Implements GitHub Issue #1:
 * - Interactive vital logging (BP, Glucose, Temp, Sleep, Mood, etc.) to MD-30 live
 * - Re-evaluates deterministic Green/Yellow/Red status & Crew Readiness Score
 * - Updates chart & 3D Bio-Twin status colors in real time
 * - Triggers Flight Surgeon guidance synthesis
 */

import React, { useId, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  LineChart,
  PlusCircle,
  Sparkles,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { BodyZoneId, MetricId, TriageStatus, VitalSignReading } from '../types/argus';
import { ZONE_ORDER } from '../data/telemetryScenarios';
import { computeDrift, forecastMetric, formatSigma } from '../utils/driftAnalytics';
import {
  evaluateMetricStatus,
  formatFlightNormBadge,
  getMetricThreshold,
  isMetricId,
  METRIC_INPUT_RANGES,
  STATUS_COLORS,
} from '../utils/triageEngine';
import { validateCheckInValue } from '../utils/checkIns';
import { InfoTip } from './InfoTip';
import { Card } from './ui/Card';
import { StatusIcon, STATUS_WORD } from './ui/StatusPill';
import { ZoneIcon, ZONE_SHORT_NAME } from './ui/ZoneIcon';

const DRIFT_COLOR = '#a78bfa';
const ACCENT = '#22d3ee';

const fmt = (v: number, unit: string) => {
  const digits = Math.abs(v) < 10 ? 2 : Math.abs(v) < 100 ? 1 : 0;
  return `${v.toFixed(digits)} ${unit}`;
};

interface ChartRow {
  dateLabel: string;
  value?: number;
  isCheckIn?: boolean;
  fMean?: number;
  fBand?: [number, number];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CheckInDot: React.FC<any> = ({ cx, cy, payload }) => {
  if (!payload?.isCheckIn || cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={5} fill={ACCENT} stroke="#020617" strokeWidth={2} />;
};

export interface TelemetryPanelProps {
  className?: string;
  defaultLoggerOpen?: boolean;
  showChart?: boolean;
}

export const TelemetryPanel: React.FC<TelemetryPanelProps> = ({
  className = '',
  defaultLoggerOpen = true,
  showChart = true,
}) => {
  const {
    zones,
    zoneStatuses,
    selectedZone,
    setSelectedZone,
    selectedMetricId,
    setSelectedMetricId,
    currentZoneReadings,
    chartWindowDays,
    setChartWindowDays,
    environment,
    activeCrewMember,
    logVitalReading,
    isSynthesizingAi,
    latestDay,
  } = useMission();

  const formId = useId();
  const [isLoggerOpen, setIsLoggerOpen] = useState(defaultLoggerOpen);
  const [logZone, setLogZone] = useState<BodyZoneId>(selectedZone);
  const [logMetricKey, setLogMetricKey] = useState<string>(selectedMetricId);
  const [logValueStr, setLogValueStr] = useState<string>('');
  const [logStatusMessage, setLogStatusMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync logZone and logMetricKey when selectedZone / selectedMetricId change from outside
  React.useEffect(() => {
    setLogZone(selectedZone);
  }, [selectedZone]);

  React.useEffect(() => {
    setLogMetricKey(selectedMetricId);
  }, [selectedMetricId]);

  const zoneReadingsForLog = zones[logZone] || currentZoneReadings;

  // Selected metric reading for display in chart
  const reading =
    currentZoneReadings.find((r) => r.metricId === selectedMetricId) ||
    currentZoneReadings[0];

  const targetReadingForLog =
    zoneReadingsForLog.find((r) => r.metricId === logMetricKey) ||
    zoneReadingsForLog[0];

  const logMetricId = (targetReadingForLog?.metricId ?? 'systolic_bp') as MetricId;
  const logMetricUnit = targetReadingForLog?.unit ?? '';
  const logThreshold = getMetricThreshold(logMetricId, environment);
  const logInputRange = METRIC_INPUT_RANGES[logMetricId] ?? { min: 0, max: 999, how: 'Standard sensor measurement' };

  // Validation of input
  const validation = useMemo(
    () => validateCheckInValue(logMetricId, logValueStr),
    [logMetricId, logValueStr]
  );

  // Real-time preview of triage status for entered value
  const previewStatus: TriageStatus | null = useMemo(() => {
    if (validation.ok !== true) return null;
    return evaluateMetricStatus(logMetricId, validation.value, environment);
  }, [validation, logMetricId, environment]);

  const drift = computeDrift(reading.metricId, reading.history);
  const forecast = forecastMetric(reading.metricId, reading.history);
  const threshold = getMetricThreshold(reading.metricId, environment);
  const status = evaluateMetricStatus(reading.metricId, reading.currentValue, environment);
  const lineColor = STATUS_COLORS[status];

  const rows: ChartRow[] = useMemo(() => {
    const hist = reading.history.slice(-chartWindowDays);
    const out: ChartRow[] = hist.map((p) => ({
      dateLabel: p.dateLabel,
      value: p.value,
      isCheckIn: p.source === 'check_in',
    }));
    if (forecast && out.length) {
      const last = out[out.length - 1];
      last.fMean = last.value;
      last.fBand = [last.value as number, last.value as number];
      forecast.forEach((f) =>
        out.push({ dateLabel: f.dateLabel, fMean: f.mean, fBand: [f.lower, f.upper] })
      );
    }
    return out;
  }, [reading, chartWindowDays, forecast]);

  const yDomain = useMemo<[number, number]>(() => {
    const vals: number[] = [
      threshold.nominalMin,
      threshold.nominalMax,
      threshold.yellowMin,
      threshold.yellowMax,
    ];
    rows.forEach((r) => {
      if (r.value != null) vals.push(r.value);
      if (r.fBand) vals.push(r.fBand[0], r.fBand[1]);
    });
    if (drift)
      vals.push(
        drift.baseline.mean - drift.baseline.sd,
        drift.baseline.mean + drift.baseline.sd
      );
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.08, 0.05);
    return [Number((lo - pad).toFixed(2)), Number((hi + pad).toFixed(2))];
  }, [rows, threshold, drift]);

  const f3 = forecast?.[forecast.length - 1];

  // Quick preset helper
  const applyPreset = (preset: 'nominal' | 'yellow' | 'red') => {
    let val: number;
    if (preset === 'nominal') {
      val = Number(((logThreshold.nominalMin + logThreshold.nominalMax) / 2).toFixed(1));
    } else if (preset === 'yellow') {
      val = Number((logThreshold.yellowMax - 0.1).toFixed(1));
    } else {
      val = Number((logThreshold.yellowMax + (logThreshold.yellowMax - logThreshold.nominalMax) * 0.5 + 1).toFixed(1));
    }
    setLogValueStr(String(val));
  };

  const handleLogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validation.ok !== true) return;
    setIsSubmitting(true);
    setLogStatusMessage(null);

    const val = validation.value;
    try {
      await logVitalReading(logZone, logMetricId, val);
      const computedStatus = evaluateMetricStatus(logMetricId, val, environment);
      setLogStatusMessage(
        `Logged ${val} ${logMetricUnit} to MD-${latestDay || 30} for ${activeCrewMember.callsign} (${STATUS_WORD[computedStatus].toUpperCase()}). Bio-Twin & AI guidance updated.`
      );
      setLogValueStr('');
    } catch (err) {
      console.error('Failed to log vital reading:', err);
      setLogStatusMessage('Error logging vital reading. Please retry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Zone + metric pickers */}
      <div className="flex flex-col gap-2.5">
        <div
          className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5"
          role="group"
          aria-label="Body zone"
        >
          {ZONE_ORDER.map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={z === selectedZone}
              onClick={() => {
                setSelectedZone(z);
                setLogZone(z);
              }}
              className={`hud-focus flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                z === selectedZone
                  ? 'border-hud-accent/70 bg-hud-accent/15 text-hud-text'
                  : 'border-hud-line text-hud-muted hover:text-hud-text'
              }`}
            >
              <ZoneIcon zone={z} className="h-3.5 w-3.5" />
              {ZONE_SHORT_NAME[z]}
              <span style={{ color: STATUS_COLORS[zoneStatuses[z]] }}>
                <StatusIcon status={zoneStatuses[z]} className="h-3 w-3" />
              </span>
              <span className="sr-only">{STATUS_WORD[zoneStatuses[z]]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Metric">
            {currentZoneReadings.map((r) => {
              const d = computeDrift(r.metricId, r.history);
              const st = evaluateMetricStatus(r.metricId, r.currentValue, environment);
              const sel = r.metricId === reading.metricId;
              return (
                <button
                  key={r.metricId}
                  type="button"
                  aria-pressed={sel}
                  onClick={() => {
                    setSelectedMetricId(r.metricId);
                    setLogMetricKey(r.metricId);
                  }}
                  className={`hud-focus hud-tile flex items-center gap-2 px-3 py-2 text-left ${
                    sel ? 'hud-tile-selected' : ''
                  }`}
                >
                  <span style={{ color: STATUS_COLORS[st] }}>
                    <StatusIcon status={st} className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-xs text-hud-text">{r.label}</span>
                  <span className="font-mono text-xs text-hud-muted">
                    {r.currentValue} {r.unit}
                  </span>
                  {d && d.level !== 'steady' && (
                    <span className="font-mono text-[11px] text-hud-drift">
                      {formatSigma(d.ewmaZ)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setIsLoggerOpen((prev) => !prev)}
            className="hud-focus inline-flex items-center gap-1.5 rounded-lg border border-hud-accent/40 bg-hud-accent/10 px-3 py-1.5 text-xs font-medium text-hud-accent hover:bg-hud-accent/20 transition-colors"
            aria-expanded={isLoggerOpen}
            aria-controls={`${formId}-logger`}
          >
            <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
            <span>+ Log Vital Reading</span>
            {isLoggerOpen ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Interactive Vital Reading Logger (P0 Issue #1) */}
      {isLoggerOpen && (
        <div id={`${formId}-logger`}>
          <Card
            icon={<PlusCircle className="h-4 w-4 text-hud-accent" />}
            title={`Log Live Vital Reading · MD-${latestDay || 30}`}
          actions={
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-hud-muted">
                Astronaut: <span className="text-hud-text">{activeCrewMember.callsign}</span>
              </span>
              <InfoTip label="About live vital logging" align="right">
                <strong className="block text-hud-text">Live Vital Input</strong>
                <span className="block text-hud-muted">
                  Log new readings (blood pressure, blood glucose, temperature, sleep, mood). Entries immediately update MD-30, recalculate deterministic Green/Yellow/Red triage, update the 3D Bio-Twin, and trigger Flight Surgeon AI guidance synthesis.
                </span>
              </InfoTip>
            </div>
          }
          className="border-hud-accent/30 bg-slate-900/90 shadow-lg shadow-cyan-950/20"
          bodyClassName="p-4 space-y-3"
        >
          <form onSubmit={handleLogSubmit} className="space-y-3" noValidate>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 items-start">
              {/* Zone selector */}
              <div>
                <label htmlFor={`${formId}-zone`} className="block text-xs font-medium text-hud-muted mb-1">
                  Target Zone
                </label>
                <select
                  id={`${formId}-zone`}
                  value={logZone}
                  onChange={(e) => {
                    const z = e.target.value as BodyZoneId;
                    setLogZone(z);
                    setSelectedZone(z);
                    const first = (zones[z] && zones[z][0]?.metricId) || 'systolic_bp';
                    setLogMetricKey(first);
                    setSelectedMetricId(first);
                  }}
                  className="hud-focus w-full rounded-lg border border-hud-line bg-hud-bg px-2.5 py-1.5 text-xs text-hud-text"
                >
                  {ZONE_ORDER.map((z) => (
                    <option key={z} value={z}>
                      {ZONE_SHORT_NAME[z]} ({STATUS_WORD[zoneStatuses[z]]})
                    </option>
                  ))}
                </select>
              </div>

              {/* Metric selector */}
              <div>
                <label htmlFor={`${formId}-metric`} className="block text-xs font-medium text-hud-muted mb-1">
                  Vital Metric
                </label>
                <select
                  id={`${formId}-metric`}
                  value={logMetricKey}
                  onChange={(e) => {
                    setLogMetricKey(e.target.value);
                    setSelectedMetricId(e.target.value);
                  }}
                  className="hud-focus w-full rounded-lg border border-hud-line bg-hud-bg px-2.5 py-1.5 text-xs text-hud-text font-mono"
                >
                  {zoneReadingsForLog.map((r) => (
                    <option key={r.metricId} value={r.metricId}>
                      {r.label} ({r.currentValue} {r.unit})
                    </option>
                  ))}
                </select>
              </div>

              {/* Reading value input */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor={`${formId}-value`} className="block text-xs font-medium text-hud-muted">
                    Reading Value ({logMetricUnit})
                  </label>
                  {previewStatus && (
                    <span
                      className="inline-flex items-center gap-1 text-[11px] font-mono px-1.5 py-0.2 rounded"
                      style={{
                        color: STATUS_COLORS[previewStatus],
                        backgroundColor: `${STATUS_COLORS[previewStatus]}15`,
                      }}
                    >
                      <StatusIcon status={previewStatus} className="h-3 w-3" />
                      {STATUS_WORD[previewStatus].toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    id={`${formId}-value`}
                    type="number"
                    step="any"
                    value={logValueStr}
                    placeholder={`e.g. ${targetReadingForLog?.currentValue ?? ''}`}
                    onChange={(e) => setLogValueStr(e.target.value)}
                    className={`hud-focus w-full rounded-lg border bg-hud-bg px-3 py-1.5 text-xs font-mono text-hud-text pr-14 ${
                      validation.ok === false
                        ? 'border-status-red focus:border-status-red'
                        : 'border-hud-line'
                    }`}
                  />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-mono text-hud-muted">
                    {logMetricUnit}
                  </span>
                </div>
                {validation.ok === false ? (
                  <p className="mt-1 text-[11px] text-status-red flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {validation.error}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-hud-muted truncate" title={logInputRange.how}>
                    {logInputRange.how}
                  </p>
                )}
              </div>

              {/* Action & quick presets */}
              <div className="flex flex-col gap-1.5 pt-0.5">
                <span className="block text-xs font-medium text-hud-muted mb-0.5">Quick Presets</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyPreset('nominal')}
                    className="hud-focus rounded border border-status-green/40 bg-status-green/10 px-2 py-1 text-[10px] font-mono text-status-green hover:bg-status-green/20"
                    title={`Fill Nominal: ${logThreshold.nominalMin}–${logThreshold.nominalMax}`}
                  >
                    Nominal
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('yellow')}
                    className="hud-focus rounded border border-status-yellow/40 bg-status-yellow/10 px-2 py-1 text-[10px] font-mono text-status-yellow hover:bg-status-yellow/20"
                    title={`Fill Caution: ${logThreshold.yellowMax}`}
                  >
                    Caution
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('red')}
                    className="hud-focus rounded border border-status-red/40 bg-status-red/10 px-2 py-1 text-[10px] font-mono text-status-red hover:bg-status-red/20"
                    title="Fill Alert (Red threshold exceeded)"
                  >
                    Alert
                  </button>
                  <button
                    type="submit"
                    disabled={validation.ok !== true || isSubmitting}
                    className="hud-focus ml-auto flex items-center gap-1.5 rounded-lg border border-hud-accent/60 bg-hud-accent px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  >
                    {isSubmitting || isSynthesizingAi ? (
                      <Sparkles className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    )}
                    <span>Record Reading</span>
                  </button>
                </div>
                <span className="text-[10px] font-mono text-hud-muted">
                  Allowed {logInputRange.min}–{logInputRange.max} {logMetricUnit} · {formatFlightNormBadge(logMetricId, logMetricUnit, environment)}
                </span>
              </div>
            </div>

            {logStatusMessage && (
              <div
                role="status"
                className="flex items-center justify-between rounded-lg border border-hud-accent/40 bg-hud-accent/10 px-3 py-2 text-xs text-hud-text"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-hud-accent shrink-0" />
                  <span>{logStatusMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setLogStatusMessage(null)}
                  className="text-hud-muted hover:text-hud-text text-xs ml-2"
                >
                  Dismiss
                </button>
              </div>
            )}
          </form>
        </Card>
        </div>
      )}

      {/* Main Longitudinal Trend Chart */}
      {showChart && (
        <Card
          icon={<LineChart className="h-4 w-4" />}
          title={`${reading.label}`}
          actions={
            <div
              className="flex items-center gap-1 rounded-lg border border-hud-line bg-hud-bg p-0.5"
              role="group"
              aria-label="Time window"
            >
              {([14, 30] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={chartWindowDays === d}
                  onClick={() => setChartWindowDays(d)}
                  className="hud-seg"
                >
                  {d}d
                </button>
              ))}
            </div>
          }
          bodyClassName="px-2 pb-3 md:px-4"
        >
          <figure
            aria-label={`${reading.label} trend. Now ${fmt(
              reading.currentValue,
              reading.unit
            )}, ${STATUS_WORD[status]}.${
              f3 ? ` Forecast ${f3.dateLabel} about ${fmt(f3.mean, reading.unit)}.` : ''
            }`}
          >
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={rows}
                  margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={lineColor} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={lineColor} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(148,163,184,0.1)"
                  />
                  <XAxis
                    dataKey="dateLabel"
                    stroke="#475569"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    interval="preserveStartEnd"
                    minTickGap={18}
                  />
                  <YAxis
                    domain={yDomain}
                    stroke="#475569"
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    width={48}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#020617',
                      borderColor: '#1e293b',
                      borderRadius: 8,
                      fontSize: 12,
                      color: '#f1f5f9',
                    }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(val: any, name: string) => {
                      if (name === 'fBand' && Array.isArray(val))
                        return [
                          `${fmt(val[0], reading.unit)} – ${fmt(val[1], reading.unit)}`,
                          '90% range',
                        ];
                      if (name === 'fMean') return [fmt(Number(val), reading.unit), 'Forecast'];
                      return [fmt(Number(val), reading.unit), reading.label];
                    }}
                  />
                  <ReferenceArea
                    y1={threshold.nominalMin}
                    y2={threshold.nominalMax}
                    fill="#22c55e"
                    fillOpacity={0.1}
                    stroke="#22c55e"
                    strokeOpacity={0.3}
                    strokeDasharray="3 3"
                  />
                  <ReferenceLine
                    y={threshold.yellowMax}
                    stroke="#eab308"
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                  />
                  <ReferenceLine
                    y={threshold.yellowMin}
                    stroke="#eab308"
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                  />
                  {drift && (
                    <ReferenceArea
                      y1={drift.baseline.mean - drift.baseline.sd}
                      y2={drift.baseline.mean + drift.baseline.sd}
                      fill={DRIFT_COLOR}
                      fillOpacity={0.08}
                      stroke={DRIFT_COLOR}
                      strokeOpacity={0.55}
                      strokeDasharray="1 4"
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="fBand"
                    stroke="none"
                    fill={ACCENT}
                    fillOpacity={0.14}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={lineColor}
                    strokeWidth={2.5}
                    fill="url(#trendFill)"
                    dot={<CheckInDot />}
                    activeDot={{ r: 5, fill: lineColor, stroke: '#020617', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="fMean"
                    stroke={ACCENT}
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    dot={false}
                    isAnimationActive={false}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </figure>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-2 text-[11px] text-hud-muted">
            <li className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-3.5 rounded-sm border border-status-green/60 bg-status-green/20"
                aria-hidden="true"
              />
              Nominal {threshold.nominalMin}–{threshold.nominalMax} {reading.unit}
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-3.5 border-t-2 border-dashed border-status-yellow"
                aria-hidden="true"
              />
              Caution limits
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-3.5 rounded-sm border border-dotted border-hud-drift bg-hud-drift/10"
                aria-hidden="true"
              />
              Personal baseline
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className="inline-block h-0 w-3.5 border-t-2 border-dashed border-hud-accent"
                aria-hidden="true"
              />
              Forecast (90%)
            </li>
            <li className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-hud-accent" aria-hidden="true" />
              Logged reading
            </li>
          </ul>
        </Card>
      )}
    </div>
  );
};
