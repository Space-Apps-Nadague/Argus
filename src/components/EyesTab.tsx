/**
 * ARGUS — Eyes tab (specs/02-ui-dashboard.md §2.4b)
 * The Thousand Eyes ring (src/features/thousandEyes: one eye per indicator vs. the person's own baseline)
 * plus every metric's numbers and the active configuration.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Download, Eye, LineChart, Settings2, Table2 } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { useAuth } from '../context/AuthContext';
import type { BodyZoneId, VitalSignReading } from '../types/argus';
import type { AiProviderStatus } from '../types/aiApi';
import { TELEMETRY_SCENARIOS, ZONE_ORDER } from '../data/telemetryScenarios';
import { formatCommDelay } from '../data/spaceLocations';
import { computeDrift, forecastMetric, formatSigma } from '../utils/driftAnalytics';
import { ENVIRONMENT_META, evaluateMetricStatus, getMetricThreshold, STATUS_COLORS } from '../utils/triageEngine';
import { fetchAiStatus } from '../services/argusApi';
import { crewApi } from '../services/dataApi';
import { formatValue } from '../utils/forecastSummary';
import { Card } from './ui/Card';
import { ThousandEyes } from '../features/thousandEyes/ThousandEyes';
import { buildPerson } from '../features/thousandEyes/adapter';
import { STATUS_HEX } from '../features/thousandEyes/statusColors';
import { StatusPill } from './ui/StatusPill';
import { ZONE_SHORT_NAME } from './ui/ZoneIcon';

const DRIFT = '#a78bfa';

export const EyesTab: React.FC = () => {
  const {
    zones,
    environment,
    metricLinks,
    readinessScore,
    activeCrewMember,
    spaceLocation,
    spaceLocationId,
    scenarioId,
    selectedMetricId,
    setSelectedMetricId,
    setSelectedZone,
    setActiveTab,
    serverBacked,
    setCrewAiConsent,
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

  // The ring is evaluated at a fixed time per data change (no per-second re-renders).
  const evalNow = useMemo(() => Date.now(), [zones, spaceLocationId, activeCrewMember.id]);
  const person = useMemo(
    () =>
      buildPerson({
        locationId: spaceLocationId,
        metrics: ZONE_ORDER.flatMap((z) => zones[z]),
        now: evalNow,
      }),
    [spaceLocationId, zones, evalNow]
  );

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
          <ThousandEyes person={person} now={evalNow} locationLabel={spaceLocation.label} />
          <ul className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-hud-muted">
            <li><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: STATUS_HEX.ok }} />On baseline</li>
            <li><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: STATUS_HEX.warn }} />▲ Drifting</li>
            <li><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: STATUS_HEX.critical }} />! Red flag</li>
            <li><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: STATUS_HEX.none }} />No data</li>
            <li><span className="mr-1 inline-block h-0.5 w-4 bg-hud-drift align-middle" />Hidden link in your data</li>
          </ul>
          <p className="mt-1 text-center text-[11px] text-hud-muted">
            Each eye compares you only with your own pre-flight baseline. Tap an eye for details.
          </p>
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
            {serverBacked && <YourData
              crewId={activeCrewMember.id}
              callsign={activeCrewMember.callsign}
              aiConsent={activeCrewMember.aiConsent ?? true}
              canExport={currentUser?.role === 'flight_surgeon' || currentUser?.crewId === activeCrewMember.id}
              setAiConsent={setCrewAiConsent}
            />}
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

/**
 * Data rights (specs/05 §6, specs/02 §2.4b): the Cloud AI switch (`ai_consent`) and the JSON export.
 * Server mode only; the server re-checks every permission.
 */
const YourData: React.FC<{
  crewId: string;
  callsign: string;
  aiConsent: boolean;
  canExport: boolean;
  setAiConsent: (crewId: string, consent: boolean) => Promise<void>;
}> = ({ crewId, callsign, aiConsent, canExport, setAiConsent }) => {
  const [busy, setBusy] = useState<'consent' | 'export' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [crewId]);

  const toggle = async () => {
    setBusy('consent');
    setError(null);
    try {
      await setAiConsent(crewId, !aiConsent);
    } catch (err) {
      setError((err as Error).message || 'Could not change the setting.');
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy('export');
    setError(null);
    try {
      const data = await crewApi.exportData(crewId);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `argus-${crewId}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message || 'Download failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Section label="Your data" />
      <dt className="self-center text-hud-muted">Cloud AI</dt>
      <dd className="flex min-w-0 items-center gap-2 text-hud-text">
        <button
          type="button"
          role="switch"
          aria-checked={aiConsent}
          aria-label={`Cloud AI for ${callsign}`}
          disabled={busy !== null}
          onClick={toggle}
          className={`hud-focus relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:cursor-wait disabled:opacity-60 ${
            aiConsent ? 'border-hud-accent bg-hud-accent/30' : 'border-hud-line bg-hud-panel'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
              aiConsent ? 'translate-x-5 bg-hud-accent' : 'translate-x-1 bg-hud-muted'
            }`}
          />
        </button>
        <span className="text-xs">{aiConsent ? 'On' : 'Off · offline answers only'}</span>
      </dd>
      {canExport && (
        <>
          <dt className="self-center text-hud-muted">Export</dt>
          <dd className="min-w-0">
            <button type="button" className="hud-btn" disabled={busy !== null} onClick={download}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {busy === 'export' ? 'Preparing…' : 'Download data'}
            </button>
          </dd>
        </>
      )}
      {error && (
        <p role="alert" className="col-span-2 text-xs text-red-300">
          {error}
        </p>
      )}
    </>
  );
};

const Row: React.FC<{ k: string; v: string }> = ({ k, v }) => (
  <>
    <dt className="text-hud-muted">{k}</dt>
    <dd className="min-w-0 break-words text-hud-text">{v}</dd>
  </>
);
