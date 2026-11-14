/**
 * ARGUS — Trends tab (specs/02-ui-dashboard.md §2.2)
 * Embeds TelemetryPanel (chart, zone/metric selectors, interactive vital logger)
 * alongside drift analytics and evidence-backed "Why" links.
 */

import React, { useMemo } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, GitBranch, Telescope } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { BodyZoneId, MetricLink, VitalSignReading } from '../types/argus';
import { computeDrift, forecastMetric, formatSigma } from '../utils/driftAnalytics';
import { TelemetryPanel } from './TelemetryPanel';
import { InfoTip } from './InfoTip';
import { Card } from './ui/Card';

const DRIFT_WORD = { steady: 'Steady', watch: 'Watch', drifting: 'Drifting' } as const;

const fmt = (v: number, unit: string) => {
  const digits = Math.abs(v) < 10 ? 2 : Math.abs(v) < 100 ? 1 : 0;
  return `${v.toFixed(digits)} ${unit}`;
};

export const TrendsTab: React.FC = () => {
  const {
    zones,
    selectedZone,
    setSelectedZone,
    selectedMetricId,
    setSelectedMetricId,
    currentZoneReadings,
    metricLinks,
  } = useMission();

  const reading =
    currentZoneReadings.find((r) => r.metricId === selectedMetricId) ||
    currentZoneReadings[0];

  const metricIndex = useMemo(() => {
    const m = new Map<string, { zone: BodyZoneId; reading: VitalSignReading }>();
    (Object.keys(zones) as BodyZoneId[]).forEach((z) =>
      zones[z].forEach((r) => m.set(r.metricId, { zone: z, reading: r }))
    );
    return m;
  }, [zones]);

  const drift = computeDrift(reading.metricId, reading.history);
  const forecast = forecastMetric(reading.metricId, reading.history);
  const f3 = forecast?.[forecast.length - 1];

  const selectMetric = (metricId: string) => {
    const hit = metricIndex.get(metricId);
    if (!hit) return;
    if (hit.zone !== selectedZone) setSelectedZone(hit.zone);
    setSelectedMetricId(metricId);
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* Telemetry Panel: Zone/Metric selectors, + Log Vital Reading, Longitudinal Chart */}
      <div className="min-w-0 xl:col-span-2">
        <TelemetryPanel />
      </div>

      {/* Side Column: Drift analytics & "Why" links (side by side on md–lg, stacked on xl) */}
      <div className="grid min-w-0 grid-cols-1 content-start gap-4 md:grid-cols-2 xl:grid-cols-1">
        {/* Drift + forecast */}
        <Card
          icon={<Telescope className="h-4 w-4" />}
          title="Drift"
          actions={
            <InfoTip label="About drift" align="right">
              How far this crew member has moved from their own first-week normal, in standard deviations (σ). It is an early
              warning only. Green/yellow/red always comes from the 0g thresholds.
            </InfoTip>
          }
        >
          {drift ? (
            <div className="space-y-3">
              <div className="flex items-end gap-3">
                <span className="font-mono text-4xl font-semibold text-hud-drift">
                  {formatSigma(drift.ewmaZ)}
                </span>
                <span className="pb-1 text-sm font-medium text-hud-text">
                  {DRIFT_WORD[drift.level]}
                </span>
              </div>
              <p className="text-xs text-hud-muted">
                Baseline <span className="font-mono text-hud-text">{fmt(drift.baseline.mean, reading.unit)}</span> ±{' '}
                <span className="font-mono">{drift.baseline.sd.toFixed(2)}</span>
              </p>
              {f3 && (
                <div className="rounded-lg border border-hud-line bg-hud-bg/50 px-3 py-2">
                  <p className="text-[11px] text-hud-muted">Forecast {f3.dateLabel}</p>
                  <p className="font-mono text-base text-hud-text">
                    ≈ {fmt(f3.mean, reading.unit)}
                    <span className="ml-1.5 text-xs text-hud-muted">
                      ({f3.lower.toFixed(2)}–{f3.upper.toFixed(2)})
                    </span>
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-hud-muted">Not enough data yet.</p>
          )}
        </Card>

        {/* Why links */}
        <Card
          icon={<GitBranch className="h-4 w-4" />}
          title="Why"
          actions={
            <InfoTip label="About links" align="right">
              Pairs with a known spaceflight mechanism (NASA HRP) that also move together in this crew member’s own data. These are
              associations, not proof of cause.
            </InfoTip>
          }
        >
          {metricLinks.length ? (
            <ul className="space-y-2">
              {metricLinks.map((l) => (
                <LinkRow
                  key={`${l.fromMetricId}-${l.toMetricId}`}
                  link={l}
                  index={metricIndex}
                  onSelect={selectMetric}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-hud-muted">No strong links yet.</p>
          )}
          <p className="mt-3 text-[11px] text-hud-muted">Association, not cause.</p>
        </Card>
      </div>
    </div>
  );
};

const LinkRow: React.FC<{
  link: MetricLink;
  index: Map<string, { zone: BodyZoneId; reading: VitalSignReading }>;
  onSelect: (metricId: string) => void;
}> = ({ link, index, onSelect }) => {
  const from = index.get(link.fromMetricId)?.reading;
  const to = index.get(link.toMetricId)?.reading;
  if (!from || !to) return null;
  const ToArrow = link.r > 0 ? ArrowUp : ArrowDown;
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(link.toMetricId)}
        title={link.mechanism}
        className="hud-focus hud-tile w-full px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-xs text-hud-text">
          <span className="truncate">{from.label}</span>
          <ArrowUp className="h-3 w-3 shrink-0 text-hud-drift" aria-label="rises" />
          <ArrowRight className="h-3 w-3 shrink-0 text-hud-muted" aria-hidden="true" />
          <span className="truncate">{to.label}</span>
          <ToArrow
            className="h-3 w-3 shrink-0 text-hud-drift"
            aria-label={link.r > 0 ? 'rises' : 'falls'}
          />
        </span>
        <span className="mt-1.5 flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-hud-line">
            <span
              className="block h-full rounded-full bg-hud-drift"
              style={{ width: `${Math.round(Math.abs(link.r) * 100)}%` }}
            />
          </span>
          <span className="font-mono text-[11px] text-hud-muted">
            r {Math.abs(link.r).toFixed(2)}
          </span>
          <span className="text-[11px] text-hud-muted">
            {link.lagDays ? 'next day' : 'same day'}
          </span>
        </span>
        <span className="sr-only">. {link.mechanism}</span>
      </button>
    </li>
  );
};
