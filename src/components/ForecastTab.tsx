/**
 * ARGUS — Forecast tab (specs/02-ui-dashboard.md §2.3)
 * Readable 3-day outlook: readiness per day + one plain sentence per metric, worst first,
 * then the health outlook (possible conditions and the checks that confirm or rule them out).
 */

import React, { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Telescope } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { buildForecastSummary, type ForecastDirection, formatValue } from '../utils/forecastSummary';
import { STATUS_COLORS } from '../utils/triageEngine';
import { readinessStatus } from './TopMissionBar';
import { Card } from './ui/Card';
import { HealthOutlookCard } from './HealthOutlookCard';
import { StatusIcon, StatusPill, STATUS_WORD } from './ui/StatusPill';
import { ZoneIcon, ZONE_SHORT_NAME } from './ui/ZoneIcon';

const DIRECTION: Record<ForecastDirection, { word: string; className: string; icon: React.ReactNode }> = {
  worse: { word: 'Getting worse', className: 'text-status-red', icon: <ArrowUpRight className="h-4 w-4" aria-hidden="true" /> },
  steady: { word: 'Steady', className: 'text-hud-muted', icon: <ArrowRight className="h-4 w-4" aria-hidden="true" /> },
  better: { word: 'Improving', className: 'text-status-green', icon: <ArrowDownRight className="h-4 w-4" aria-hidden="true" /> },
};

const DAY_LABELS = ['Today', 'Tomorrow', 'In 2 days', 'In 3 days'];

export const ForecastTab: React.FC = () => {
  const { zones, environment, setSelectedMetricId, setSelectedZone, setActiveTab } = useMission();
  const [filter, setFilter] = useState<'changing' | 'all'>('changing');
  const summary = useMemo(() => buildForecastSummary(zones, environment), [zones, environment]);

  const rows = filter === 'all' ? summary.rows : summary.rows.filter((r) => r.direction !== 'steady' || r.statusDay3 !== 'green');

  const openTrend = (zone: typeof rows[number]['zoneId'], metricId: string) => {
    setSelectedZone(zone);
    setSelectedMetricId(metricId);
    setActiveTab('trends');
  };

  return (
    <div className="space-y-4">
      <Card title="Readiness outlook" icon={<Telescope className="h-4 w-4" />}>
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {summary.readiness.map((score, i) => {
            const st = readinessStatus(score);
            return (
              <li key={i} className="hud-tile p-3">
                <div className="text-xs text-hud-muted">{DAY_LABELS[i]}</div>
                <div className="mt-1 flex items-center gap-2">
                  <span style={{ color: STATUS_COLORS[st] }}>
                    <StatusIcon status={st} className="h-4 w-4" />
                  </span>
                  <span className="font-mono text-2xl font-semibold" style={{ color: STATUS_COLORS[st] }}>
                    {score}%
                  </span>
                </div>
                <div className="text-[11px] text-hud-muted">{STATUS_WORD[st]}</div>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card
        title="What changes in the next 3 days"
        actions={
          <div className="flex rounded-lg border border-hud-line p-0.5" role="group" aria-label="Filter">
            <button type="button" className="hud-seg" aria-pressed={filter === 'changing'} onClick={() => setFilter('changing')}>
              Changing
            </button>
            <button type="button" className="hud-seg" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All ({summary.rows.length})
            </button>
          </div>
        }
        bodyClassName="px-2 pb-2"
      >
        {rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-hud-muted">Nothing is expected to change. Every metric stays nominal.</p>
        ) : (
          <ul className="divide-y divide-hud-line">
            {rows.map((r) => {
              const d = DIRECTION[r.direction];
              const day3 = r.projected[2];
              return (
                <li key={r.metricId}>
                  <button
                    type="button"
                    onClick={() => openTrend(r.zoneId, r.metricId)}
                    className="hud-focus grid w-full grid-cols-1 gap-2 rounded-lg px-2 py-3 text-left hover:bg-hud-bg/60 md:grid-cols-[minmax(0,1.4fr)_auto_minmax(0,1fr)_auto] md:items-center md:gap-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-hud-text">
                        <ZoneIcon zone={r.zoneId} className="h-4 w-4 shrink-0 text-hud-muted" />
                        <span className="truncate">{r.label}</span>
                        <span className="text-[11px] font-normal text-hud-muted">{ZONE_SHORT_NAME[r.zoneId]}</span>
                      </div>
                      <div className="mt-0.5 font-mono text-sm text-hud-text">
                        {formatValue(r.today, r.unit)}
                        {day3 !== null && (
                          <>
                            <span className="mx-1.5 text-hud-muted">→</span>
                            {formatValue(day3, r.unit)}
                            <span className="ml-1.5 font-sans text-xs text-hud-muted">in 3 days</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <StatusPill status={r.statusToday} />
                      <ArrowRight className="h-3.5 w-3.5 text-hud-muted" aria-hidden="true" />
                      <StatusPill status={r.statusDay3} />
                    </div>
                    <div className="text-xs text-hud-muted">
                      {r.lower !== null && r.upper !== null
                        ? `Likely between ${formatValue(r.lower, r.unit)} and ${formatValue(r.upper, r.unit)}`
                        : 'Not enough history to project'}
                    </div>
                    <div className={`flex items-center gap-1 text-xs font-medium ${d.className}`}>
                      {d.icon}
                      {d.word}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="px-2 pt-2 text-[11px] text-hud-muted">
          Projection from the last 10 days with a 90% range. Not a diagnosis. Tap a row to open its trend.
        </p>
      </Card>

      <HealthOutlookCard />
    </div>
  );
};
