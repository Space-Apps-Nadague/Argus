/**
 * ARGUS — Eyes tab (specs/02-ui-dashboard.md §2.4b)
 * A readable "Thousand Eyes" ring (one eye per metric, grouped by zone, violet links)
 * plus every metric's numbers and the active configuration.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Eye, LineChart, Settings2, Table2 } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { useAuth } from '../context/AuthContext';
import type { BodyZoneId, VitalSignReading } from '../types/argus';
import type { AiProviderStatus } from '../types/aiApi';
import { TELEMETRY_SCENARIOS, ZONE_ORDER } from '../data/telemetryScenarios';
import { formatCommDelay } from '../data/spaceLocations';
import { computeDrift, forecastMetric, formatSigma } from '../utils/driftAnalytics';
import { ENVIRONMENT_META, evaluateMetricStatus, getMetricThreshold, STATUS_COLORS } from '../utils/triageEngine';
import { fetchAiStatus } from '../services/argusApi';
import { formatValue } from '../utils/forecastSummary';
import { Card } from './ui/Card';
import { StatusPill } from './ui/StatusPill';
import { ZONE_SHORT_NAME } from './ui/ZoneIcon';

const SIZE = 560;
const C = SIZE / 2;
const R = 190;
const DRIFT = '#a78bfa';

interface EyeNode {
  reading: VitalSignReading;
  zone: BodyZoneId;
  angle: number;
  x: number;
  y: number;
}

function layoutEyes(zones: Record<BodyZoneId, VitalSignReading[]>): { eyes: EyeNode[]; arcs: Array<{ zone: BodyZoneId; a0: number; a1: number }> } {
  const slots = ZONE_ORDER.reduce((n, z) => n + zones[z].length, 0) + ZONE_ORDER.length; // one gap slot per zone
  const step = (Math.PI * 2) / slots;
  let a = -Math.PI / 2 + step / 2;
  const eyes: EyeNode[] = [];
  const arcs: Array<{ zone: BodyZoneId; a0: number; a1: number }> = [];
  ZONE_ORDER.forEach((zone) => {
    const a0 = a;
    zones[zone].forEach((reading) => {
      eyes.push({ reading, zone, angle: a, x: C + R * Math.cos(a), y: C + R * Math.sin(a) });
      a += step;
    });
    arcs.push({ zone, a0: a0 - step * 0.4, a1: a - step * 0.6 });
    a += step; // gap between zones
  });
  return { eyes, arcs };
}

const polar = (r: number, a: number) => [C + r * Math.cos(a), C + r * Math.sin(a)] as const;

function arcPath(r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export const EyesTab: React.FC = () => {
  const {
    zones,
    environment,
    metricLinks,
    readinessScore,
    activeCrewMember,
    spaceLocation,
    scenarioId,
    selectedMetricId,
    setSelectedMetricId,
    setSelectedZone,
    setActiveTab,
  } = useMission();
  const { currentUser } = useAuth();
  const [ai, setAi] = useState<AiProviderStatus | null>(null);
  const [aiChecked, setAiChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchAiStatus().then((s) => {
      if (!alive) return;
      setAi(s);
      setAiChecked(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const { eyes, arcs } = useMemo(() => layoutEyes(zones), [zones]);
  const byMetric = useMemo(() => new Map(eyes.map((e) => [e.reading.metricId, e])), [eyes]);

  const select = (zone: BodyZoneId, metricId: string) => {
    setSelectedZone(zone);
    setSelectedMetricId(metricId);
  };

  const rows = useMemo(
    () =>
      ZONE_ORDER.flatMap((zone) =>
        zones[zone].map((r) => {
          const drift = computeDrift(r.metricId, r.history);
          const fc = forecastMetric(r.metricId, r.history);
          return {
            zone,
            r,
            drift,
            status: evaluateMetricStatus(r.metricId, r.currentValue, environment),
            t: getMetricThreshold(r.metricId, environment),
            day3: fc?.[2]?.mean ?? null,
          };
        })
      ),
    [zones, environment]
  );

  const env = ENVIRONMENT_META[environment];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="The Thousand Eyes" icon={<Eye className="h-4 w-4" />} bodyClassName="p-2 sm:p-4">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto block w-full max-w-[560px]" role="img" aria-label="Ring of eyes, one per metric, colored by status">
            {/* zone arcs + labels */}
            {arcs.map(({ zone, a0, a1 }) => {
              const mid = (a0 + a1) / 2;
              const [lx, ly] = polar(R - 62, mid);
              return (
                <g key={zone}>
                  <path d={arcPath(R - 44, a0, a1)} stroke="#334155" strokeWidth={3} fill="none" strokeLinecap="round" />
                  <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill="#94a3b8" fontWeight={600}>
                    {ZONE_SHORT_NAME[zone]}
                  </text>
                </g>
              );
            })}

            {/* links */}
            {metricLinks.map((l) => {
              const a = byMetric.get(l.fromMetricId);
              const b = byMetric.get(l.toMetricId);
              if (!a || !b) return null;
              return (
                <path
                  key={`${l.fromMetricId}-${l.toMetricId}`}
                  d={`M ${a.x} ${a.y} Q ${C} ${C} ${b.x} ${b.y}`}
                  stroke={DRIFT}
                  strokeWidth={1 + Math.abs(l.r) * 2.5}
                  strokeOpacity={0.35 + Math.abs(l.r) * 0.4}
                  fill="none"
                >
                  <title>{`${l.fromMetricId} → ${l.toMetricId} (r ${l.r.toFixed(2)}): ${l.mechanism}`}</title>
                </path>
              );
            })}

            {/* center */}
            <text x={C} y={C - 10} textAnchor="middle" fontSize={34} fontWeight={700} fill={STATUS_COLORS[readinessScore >= 85 ? 'green' : readinessScore >= 70 ? 'yellow' : 'red']}>
              {readinessScore}%
            </text>
            <text x={C} y={C + 16} textAnchor="middle" fontSize={12} fill="#94a3b8">
              {activeCrewMember.callsign} readiness
            </text>

            {/* eyes */}
            {eyes.map((e) => {
              const st = evaluateMetricStatus(e.reading.metricId, e.reading.currentValue, environment);
              const drift = computeDrift(e.reading.metricId, e.reading.history);
              const z = drift?.ewmaZ ?? 0;
              const pupilDx = Math.max(-5, Math.min(5, z * 2));
              const selected = e.reading.metricId === selectedMetricId;
              const [lx, ly] = polar(R + 40, e.angle);
              const cos = Math.cos(e.angle);
              const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
              return (
                <g
                  key={e.reading.metricId}
                  role="button"
                  tabIndex={0}
                  aria-label={`${e.reading.label}: ${e.reading.currentValue} ${e.reading.unit}, ${st}`}
                  onClick={() => select(e.zone, e.reading.metricId)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      select(e.zone, e.reading.metricId);
                    }
                  }}
                  className="cursor-pointer outline-none [&:focus-visible>ellipse:first-child]:stroke-cyan-400"
                >
                  {drift && drift.level !== 'steady' && (
                    <circle cx={e.x} cy={e.y} r={25} fill="none" stroke={DRIFT} strokeWidth={2} strokeDasharray={drift.level === 'watch' ? '4 4' : undefined} />
                  )}
                  <ellipse cx={e.x} cy={e.y} rx={20} ry={13} fill="#0f172a" stroke={selected ? '#22d3ee' : '#475569'} strokeWidth={selected ? 3 : 1.5} />
                  <circle cx={e.x + pupilDx} cy={e.y} r={8} fill={STATUS_COLORS[st]} />
                  <circle cx={e.x + pupilDx} cy={e.y} r={3.2} fill="#020617" />
                  <text x={lx} y={ly - 6} textAnchor={anchor} fontSize={11.5} fill="#e2e8f0" fontWeight={selected ? 700 : 500}>
                    {e.reading.label.length > 18 ? `${e.reading.label.slice(0, 17)}…` : e.reading.label}
                  </text>
                  <text x={lx} y={ly + 9} textAnchor={anchor} fontSize={11} fill={STATUS_COLORS[st]} fontFamily="ui-monospace, monospace">
                    {formatValue(e.reading.currentValue, e.reading.unit)}
                  </text>
                </g>
              );
            })}
          </svg>
          <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-hud-muted">
            <li><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-status-green align-middle" />Pupil color = status</li>
            <li>Pupil shift = drift direction</li>
            <li><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border-2 border-dashed border-hud-drift align-middle" />Watch · solid = drifting</li>
            <li><span className="mr-1 inline-block h-0.5 w-4 bg-hud-drift align-middle" />Linked metrics</li>
          </ul>
        </Card>

        <Card title="Configuration" icon={<Settings2 className="h-4 w-4" />}>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <Section label="Signed in" />
            <Row k="User" v={`${currentUser?.username ?? '—'} (${currentUser?.role ?? '—'})`} />
            <Section label="Astronaut" />
            <Row k="Name" v={`${activeCrewMember.name} · "${activeCrewMember.callsign}"`} />
            <Row k="Role" v={activeCrewMember.role} />
            <Row k="Profile" v={`${activeCrewMember.sex}, ${activeCrewMember.age} y, blood ${activeCrewMember.bloodType}`} />
            <Row k="Baselines" v={`Resting HR ${activeCrewMember.restingHrBaselineBpm} bpm · ONSD ${activeCrewMember.preFlightOnsdMm} mm`} />
            <Row k="Mission days" v={`${activeCrewMember.missionDaysLogged} logged · streak ${activeCrewMember.countermeasureStreakSols} sols`} />
            {activeCrewMember.medicalNotes && <Row k="Notes" v={activeCrewMember.medicalNotes} />}
            <Section label="Mission" />
            <Row k="Location" v={spaceLocation.label} />
            <Row k="Gravity" v={spaceLocation.gravityLabel} />
            <Row k="Comm delay" v={`${formatCommDelay(spaceLocation)} one-way`} />
            <Row k="Scenario" v={TELEMETRY_SCENARIOS[scenarioId].label} />
            <Row k="Thresholds" v={`${env.label} table (all locations for now)`} />
            <Section label="AI" />
            <Row
              k="Providers"
              v={
                !aiChecked
                  ? 'Checking…'
                  : !ai
                    ? 'Backend not running — offline protocols only'
                    : ai.chain.length
                      ? ai.chain.map((p) => `${p.label} (${p.model})`).join(' → ') + ' → offline'
                      : 'None configured — offline protocols only'
              }
            />
          </dl>
        </Card>
      </div>

      <Card title="All metrics" icon={<Table2 className="h-4 w-4" />} bodyClassName="overflow-x-auto px-2 pb-3">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-hud-muted">
            <tr className="border-b border-hud-line">
              <th className="px-2 py-2 font-medium">Zone</th>
              <th className="px-2 py-2 font-medium">Metric</th>
              <th className="px-2 py-2 font-medium">Now</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium">Your baseline</th>
              <th className="px-2 py-2 font-medium">Drift</th>
              <th className="px-2 py-2 font-medium">Nominal</th>
              <th className="px-2 py-2 font-medium">Caution</th>
              <th className="px-2 py-2 font-medium">In 3 days</th>
              <th className="px-2 py-2"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="font-mono text-[13px]">
            {rows.map(({ zone, r, drift, status, t, day3 }) => (
              <tr
                key={r.metricId}
                className={`border-b border-hud-line/60 ${r.metricId === selectedMetricId ? 'bg-hud-accent/10' : ''}`}
              >
                <td className="px-2 py-2 font-sans text-hud-muted">{ZONE_SHORT_NAME[zone]}</td>
                <td className="px-2 py-2 font-sans text-hud-text">{r.label}</td>
                <td className="px-2 py-2 text-hud-text">{formatValue(r.currentValue, r.unit)}</td>
                <td className="px-2 py-2 font-sans"><StatusPill status={status} /></td>
                <td className="px-2 py-2 text-hud-muted">
                  {drift ? `${formatValue(drift.baseline.mean, '')} ± ${formatValue(drift.baseline.sd, '')}` : '—'}
                </td>
                <td className="px-2 py-2" style={{ color: drift && drift.level !== 'steady' ? DRIFT : undefined }}>
                  {drift ? `${formatSigma(drift.ewmaZ)} ${drift.level}` : '—'}
                </td>
                <td className="px-2 py-2 text-hud-muted">{t.nominalMin}–{t.nominalMax}</td>
                <td className="px-2 py-2 text-hud-muted">{t.yellowMin}–{t.yellowMax}</td>
                <td className="px-2 py-2 text-hud-text">{day3 === null ? '—' : formatValue(day3, r.unit)}</td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    className="hud-btn px-2 py-1"
                    aria-label={`Open ${r.label} trend`}
                    onClick={() => {
                      select(zone, r.metricId);
                      setActiveTab('trends');
                    }}
                  >
                    <LineChart className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

const Section: React.FC<{ label: string }> = ({ label }) => (
  <div className="col-span-2 mt-2 border-b border-hud-line pb-1 text-[11px] font-semibold uppercase tracking-wide text-hud-accent first:mt-0">
    {label}
  </div>
);

const Row: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <>
    <dt className="text-hud-muted">{k}</dt>
    <dd className="min-w-0 break-words text-hud-text">{v}</dd>
  </>
);
