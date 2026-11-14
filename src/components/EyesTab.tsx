/**
 * ARGUS — Eyes tab (specs/02-ui-dashboard.md §2.4b)
 * Ported "Thousand Eyes" 31-indicator ring + detail sheet + all metrics table + configuration.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Eye, LineChart, Settings2, Table2 } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { useAuth } from '../context/AuthContext';
import type { BodyZoneId, MetricId } from '../types/argus';
import type { AiProviderStatus } from '../types/aiApi';
import { TELEMETRY_SCENARIOS, ZONE_ORDER } from '../data/telemetryScenarios';
import { formatCommDelay } from '../data/spaceLocations';
import { computeDrift, forecastMetric, formatSigma } from '../utils/driftAnalytics';
import { ENVIRONMENT_META, evaluateMetricStatus, getMetricThreshold } from '../utils/triageEngine';
import { fetchAiStatus } from '../services/argusApi';
import { formatValue } from '../utils/forecastSummary';
import {
  EyeDetailSheet,
  ThousandEyesRing,
  computeDeviationIndex,
  computePersonalReadiness,
  evaluateAllIndicators,
  findHiddenLinks,
  zonesToSeriesMap,
  type ThousandEyesIndicatorId,
} from '../features/thousandEyes';
import { Card } from './ui/Card';
import { StatusPill } from './ui/StatusPill';
import { ZONE_SHORT_NAME } from './ui/ZoneIcon';

export const EyesTab: React.FC = () => {
  const {
    zones,
    environment,
    activeCrewMember,
    spaceLocation,
    spaceLocationId,
    scenarioId,
    selectedMetricId,
    setSelectedMetricId,
    setSelectedZone,
    setActiveTab,
  } = useMission();
  const { currentUser } = useAuth();
  const [ai, setAi] = useState<AiProviderStatus | null>(null);
  const [aiChecked, setAiChecked] = useState(false);
  const [selectedEyeId, setSelectedEyeId] = useState<ThousandEyesIndicatorId | null>(null);

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

  const seriesMap = useMemo(() => zonesToSeriesMap(zones), [zones]);
  const eyeStats = useMemo(
    () => evaluateAllIndicators(seriesMap, spaceLocationId, 'mis'),
    [seriesMap, spaceLocationId]
  );
  const hiddenLinks = useMemo(() => findHiddenLinks(seriesMap), [seriesMap]);
  const personalReadiness = useMemo(() => computePersonalReadiness(eyeStats), [eyeStats]);
  const deviationIndex = useMemo(() => computeDeviationIndex(eyeStats), [eyeStats]);

  const selectedEyeStat = useMemo(
    () => eyeStats.find((s) => s.indicator.id === selectedEyeId) ?? null,
    [eyeStats, selectedEyeId]
  );

  const selectMetric = (zone: BodyZoneId, metricId: string) => {
    setSelectedZone(zone);
    setSelectedMetricId(metricId);
  };

  const openMetricInTrends = (metricId: MetricId) => {
    const zone = ZONE_ORDER.find((z) => zones[z].some((r) => r.metricId === metricId));
    if (zone) setSelectedZone(zone);
    setSelectedMetricId(metricId);
    setActiveTab('trends');
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
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)]">
        <Card
          title="The Thousand Eyes"
          icon={<Eye className="h-4 w-4" />}
          bodyClassName="p-3 sm:p-4"
        >
          <ThousandEyesRing
            stats={eyeStats}
            links={hiddenLinks}
            readinessScore={personalReadiness}
            deviationIndex={deviationIndex}
            selectedId={selectedEyeId}
            onSelect={setSelectedEyeId}
            callsign={activeCrewMember.callsign}
          />
        </Card>

        <div className="space-y-4 min-w-0">
          <EyeDetailSheet
            stat={selectedEyeStat}
            locationLabel={spaceLocation.label}
            onClose={() => setSelectedEyeId(null)}
            onOpenTrends={openMetricInTrends}
          />

          <Card title="Configuration" icon={<Settings2 className="h-4 w-4" />}>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
              <Section label="Signed in" />
              <Row k="User" v={`${currentUser?.username ?? '—'} (${currentUser?.role ?? '—'})`} />
              <Section label="Astronaut" />
              <Row k="Name" v={`${activeCrewMember.name} · "${activeCrewMember.callsign}"`} />
              <Row k="Role" v={activeCrewMember.role} />
              <Row
                k="Profile"
                v={`${activeCrewMember.sex}, ${activeCrewMember.age} y, blood ${activeCrewMember.bloodType}`}
              />
              <Row
                k="Baselines"
                v={`Resting HR ${activeCrewMember.restingHrBaselineBpm} bpm · ONSD ${activeCrewMember.preFlightOnsdMm} mm`}
              />
              <Row
                k="Mission days"
                v={`${activeCrewMember.missionDaysLogged} logged · streak ${activeCrewMember.countermeasureStreakSols} sols`}
              />
              {activeCrewMember.medicalNotes && (
                <Row k="Notes" v={activeCrewMember.medicalNotes} />
              )}
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
      </div>

      <Card
        title="All metrics"
        icon={<Table2 className="h-4 w-4" />}
        bodyClassName="overflow-x-auto px-2 pb-3"
      >
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
              <th className="px-2 py-2">
                <span className="sr-only">Open</span>
              </th>
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
                <td className="px-2 py-2 text-hud-text">
                  {formatValue(r.currentValue, r.unit)}
                </td>
                <td className="px-2 py-2 font-sans">
                  <StatusPill status={status} />
                </td>
                <td className="px-2 py-2 text-hud-muted">
                  {drift
                    ? `${formatValue(drift.baseline.mean, '')} ± ${formatValue(drift.baseline.sd, '')}`
                    : '—'}
                </td>
                <td className="px-2 py-2 text-hud-drift">
                  {drift && drift.level !== 'steady' ? (
                    <span>{`${formatSigma(drift.ewmaZ)} ${drift.level}`}</span>
                  ) : (
                    <span className="text-hud-muted">
                      {drift ? `${formatSigma(drift.ewmaZ)} ${drift.level}` : '—'}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-hud-muted">
                  {t.nominalMin}–{t.nominalMax}
                </td>
                <td className="px-2 py-2 text-hud-muted">
                  {t.yellowMin}–{t.yellowMax}
                </td>
                <td className="px-2 py-2 text-hud-text">
                  {day3 === null ? '—' : formatValue(day3, r.unit)}
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    className="hud-btn px-2 py-1"
                    aria-label={`Open ${r.label} trend`}
                    onClick={() => {
                      selectMetric(zone, r.metricId);
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
