/**
 * ARGUS — Daily Check-in tab (specs/02-ui-dashboard.md §2.3, specs/01-data-schema.md §6)
 * Manual readings with inline range validation, streak, and a status-change summary.
 */

import React, { useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, ClipboardCheck, Flame, Trash2 } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { BodyZoneId, MetricId, TriageStatus } from '../types/argus';
import { ZONE_ORDER } from '../data/telemetryScenarios';
import { applyCheckIns, buildCheckInEntry, lastLoggedDay, validateCheckInValue } from '../utils/checkIns';
import { evaluateAllZones, isMetricId, METRIC_INPUT_RANGES } from '../utils/triageEngine';
import { InfoTip } from './InfoTip';
import { Card } from './ui/Card';
import { StatusPill } from './ui/StatusPill';
import { ZoneIcon, ZONE_SHORT_NAME } from './ui/ZoneIcon';

interface StatusChange {
  zone: BodyZoneId;
  from: TriageStatus;
  to: TriageStatus;
}

export const CheckInTab: React.FC = () => {
  const {
    zones,
    zoneStatuses,
    environment,
    activeCrewMember,
    activeCheckIns,
    addCheckIn,
    deleteCheckIn,
    checkInStreakDays,
    latestDay,
    setActiveTab,
  } = useMission();

  const [day, setDay] = useState<number>(latestDay);
  const [raw, setRaw] = useState<Partial<Record<MetricId, string>>>({});
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ count: number; changes: StatusChange[] } | null>(null);

  const maxDay = latestDay + 1;
  const safeDay = Math.min(Math.max(1, day), maxDay);
  const lastDay = lastLoggedDay(activeCheckIns);

  const errors = useMemo(() => {
    const e: Partial<Record<MetricId, string>> = {};
    (Object.keys(raw) as MetricId[]).forEach((k) => {
      const v = validateCheckInValue(k, raw[k]);
      if (v.ok === false) e[k] = v.error;
    });
    return e;
  }, [raw]);
  const validCount = (Object.keys(raw) as MetricId[]).filter((k) => validateCheckInValue(k, raw[k]).ok === true).length;
  const canSubmit = validCount > 0 && Object.keys(errors).length === 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const { entry } = buildCheckInEntry({ crewId: activeCrewMember.id, missionDay: safeDay, rawValues: raw, note });
    if (!entry) return;
    const after = evaluateAllZones(applyCheckIns(zones, [entry]), environment);
    const changes = ZONE_ORDER.filter((z) => after[z] !== zoneStatuses[z]).map((z) => ({ zone: z, from: zoneStatuses[z], to: after[z] }));
    addCheckIn(entry);
    setResult({ count: Object.keys(entry.values).length, changes });
    setRaw({});
    setNote('');
  };

  const recent = [...activeCheckIns].sort((a, b) => b.timestampIso.localeCompare(a.timestampIso)).slice(0, 8);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <form onSubmit={submit} className="xl:col-span-2 space-y-4" noValidate aria-labelledby="checkin-title">
        {/* Header */}
        <div className="hud-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <h2 id="checkin-title" className="flex items-center gap-2 font-display text-[13px] font-semibold tracking-wide text-hud-text">
            <ClipboardCheck className="h-4 w-4 text-hud-accent" aria-hidden="true" />
            Check-in · {activeCrewMember.callsign}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-hud-line bg-hud-bg" role="group" aria-label="Mission day">
              <button
                type="button"
                className="hud-focus rounded-l-lg p-1.5 text-hud-muted hover:text-hud-text disabled:opacity-40"
                onClick={() => setDay(safeDay - 1)}
                disabled={safeDay <= 1}
                aria-label="Previous day"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[72px] text-center font-mono text-sm text-hud-text" aria-live="polite">
                MD-{safeDay}
                {safeDay === maxDay && <span className="sr-only"> (new day)</span>}
              </span>
              <button
                type="button"
                className="hud-focus rounded-r-lg p-1.5 text-hud-muted hover:text-hud-text disabled:opacity-40"
                onClick={() => setDay(safeDay + 1)}
                disabled={safeDay >= maxDay}
                aria-label="Next day"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-xs text-amber-300" title="Check-in streak">
              <Flame className="h-3.5 w-3.5" aria-hidden="true" />
              {checkInStreakDays}d
              <span className="sr-only"> streak</span>
            </span>
            <span className="text-xs text-hud-muted">{lastDay ? `Last: MD-${lastDay}` : 'No check-ins yet'}</span>
          </div>
        </div>

        {result && (
          <div role="status" className="hud-card border-hud-accent/40 px-4 py-3">
            <p className="text-sm text-hud-text">
              Logged {result.count} reading{result.count === 1 ? '' : 's'}.
              {!result.changes.length && <span className="text-hud-muted"> No zone changed status.</span>}
            </p>
            {result.changes.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {result.changes.map((c) => (
                  <li key={c.zone} className="flex items-center gap-1.5 rounded-lg border border-hud-line bg-hud-bg/60 px-2 py-1 text-xs">
                    <ZoneIcon zone={c.zone} className="h-3.5 w-3.5 text-hud-muted" />
                    {ZONE_SHORT_NAME[c.zone]}
                    <StatusPill status={c.from} />
                    <ArrowRight className="h-3 w-3 text-hud-muted" aria-label="to" />
                    <StatusPill status={c.to} />
                  </li>
                ))}
                <li>
                  <button type="button" className="hud-btn" onClick={() => setActiveTab('biotwin')}>
                    View Bio-Twin
                  </button>
                </li>
              </ul>
            )}
          </div>
        )}

        {/* Fields by zone */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {ZONE_ORDER.map((z) => (
            <fieldset key={z} className="hud-card px-4 pb-3 pt-2">
              <legend className="sr-only">{ZONE_SHORT_NAME[z]}</legend>
              <div className="mb-1 flex items-center gap-2 py-1.5 text-sm font-medium text-hud-text" aria-hidden="true">
                <ZoneIcon zone={z} className="h-4 w-4 text-hud-accent" />
                {ZONE_SHORT_NAME[z]}
              </div>
              <div className="space-y-2">
                {zones[z].map((r) => {
                  if (!isMetricId(r.metricId)) return null;
                  const id = r.metricId;
                  const range = METRIC_INPUT_RANGES[id];
                  const err = errors[id];
                  const inputId = `ci-${id}`;
                  const point = r.history.find((p) => p.missionDay === safeDay);
                  return (
                    <div key={id}>
                      <div className="flex items-center gap-2">
                        <label htmlFor={inputId} className="flex-1 text-xs text-hud-text/90">
                          {r.label}
                        </label>
                        <InfoTip label={`How to measure ${r.label}`} align="right">
                          {range.how}
                          <span className="mt-1 block font-mono text-hud-muted">
                            Allowed {range.min}–{range.max} {r.unit}
                          </span>
                        </InfoTip>
                        <div className="relative w-32">
                          <input
                            id={inputId}
                            inputMode="decimal"
                            value={raw[id] ?? ''}
                            onChange={(e) => setRaw((p) => ({ ...p, [id]: e.target.value }))}
                            placeholder={point ? String(point.value) : String(r.currentValue)}
                            aria-invalid={!!err}
                            aria-describedby={err ? `${inputId}-err` : undefined}
                            className={`hud-input pr-12 text-right ${err ? 'border-status-red focus-visible:ring-status-red' : ''}`}
                          />
                          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[11px] text-hud-muted">
                            {r.unit}
                          </span>
                        </div>
                      </div>
                      {err && (
                        <p id={`${inputId}-err`} className="mt-1 text-right text-[11px] text-red-300">
                          {err} {r.unit}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <div className="hud-card flex flex-col gap-3 p-4">
            <label htmlFor="ci-note" className="text-sm font-medium text-hud-text">
              Note <span className="font-normal text-hud-muted">(optional)</span>
            </label>
            <textarea
              id="ci-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Headache after EVA prep…"
              className="hud-input font-sans"
            />
            <button type="submit" disabled={!canSubmit} className="hud-btn-primary mt-auto">
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
              Log check-in{validCount > 0 ? ` (${validCount})` : ''}
            </button>
          </div>
        </div>
      </form>

      {/* History */}
      <Card title="Recent" bodyClassName="px-4 pb-4">
        {recent.length ? (
          <ul className="space-y-2">
            {recent.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-lg border border-hud-line bg-hud-bg/50 px-3 py-2">
                <span className="font-mono text-sm text-hud-text">MD-{e.missionDay}</span>
                <span className="flex-1 text-xs text-hud-muted">
                  {Object.keys(e.values).length} values · {new Date(e.timestampIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {e.note && <span className="block truncate text-hud-text/80">{e.note}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => deleteCheckIn(e.id)}
                  aria-label={`Delete check-in MD-${e.missionDay}`}
                  className="hud-focus rounded p-1 text-hud-muted hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-hud-muted">No check-ins yet. Log today’s readings to start your streak.</p>
        )}
      </Card>
    </div>
  );
};
