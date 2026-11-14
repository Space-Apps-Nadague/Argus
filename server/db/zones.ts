/**
 * Builds the HUD's zone readings (`Record<BodyZoneId, VitalSignReading[]>`, spec 01 §3) from `daily_metrics`.
 * Labels, units and plain-language text come from the scenario template; values come from the database.
 */

import { and, asc, eq, gte } from 'drizzle-orm';
import type { BodyZoneId, CrewMemberProfile, ScenarioId, TelemetryHistoryPoint, VitalSignReading } from '../../src/types/argus';
import { getCrewAdjustedZones } from '../../src/data/telemetryScenarios';
import type { Db } from './client';
import { dailyMetrics, missions, astronauts } from './schema';

const DAY_MS = 86_400_000;
export const SERIES_DAYS = 30;

const ORIGIN_TO_SOURCE: Record<string, TelemetryHistoryPoint['source']> = {
  wearable: 'wearable',
  simulated: 'wearable',
  check_in: 'check_in',
  clinical: 'clinical',
};

function round(v: number, metricId: string): number {
  const digits = ['onsd', 'wbc_lymph', 'rad_dose', 'bmd_delta'].includes(metricId) ? 2 : metricId === 'spo2' || metricId === 'cabin_co2' ? 1 : 0;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export async function buildZonesFromDb(
  db: Db,
  crew: CrewMemberProfile,
  scenarioId: ScenarioId = crew.defaultScenarioId
): Promise<{ zones: Record<BodyZoneId, VitalSignReading[]>; hasData: boolean; missionStart: Date | null }> {
  const template = getCrewAdjustedZones(scenarioId, crew);
  const mission = (
    await db
      .select({ startAt: missions.startAt })
      .from(astronauts)
      .leftJoin(missions, eq(missions.id, astronauts.missionId))
      .where(eq(astronauts.id, crew.id))
      .limit(1)
  )[0];
  const missionStart = mission?.startAt ?? null;
  const since = new Date(Date.now() - SERIES_DAYS * DAY_MS).toISOString().slice(0, 10);
  const rows = await db
    .select()
    .from(dailyMetrics)
    .where(and(eq(dailyMetrics.astronautId, crew.id), gte(dailyMetrics.day, since)))
    .orderBy(asc(dailyMetrics.day));

  const byMetric = new Map<string, TelemetryHistoryPoint[]>();
  for (const r of rows) {
    const dayMs = Date.parse(`${r.day}T00:00:00Z`);
    const missionDay = missionStart ? Math.floor((dayMs - missionStart.getTime()) / DAY_MS) + 1 : 1;
    if (missionDay < 1) continue;
    const list = byMetric.get(r.metricId) ?? [];
    list.push({ missionDay, dateLabel: `MD-${missionDay}`, value: round(r.value, r.metricId), source: ORIGIN_TO_SOURCE[r.origin] });
    byMetric.set(r.metricId, list);
  }

  const zones = {} as Record<BodyZoneId, VitalSignReading[]>;
  for (const zone of Object.keys(template) as BodyZoneId[]) {
    zones[zone] = template[zone].map((reading) => {
      const history = byMetric.get(reading.metricId);
      if (!history?.length) return reading; // no data yet: keep the template series
      const first = history.slice(0, 7);
      const base = first.reduce((s, p) => s + p.value, 0) / first.length;
      const current = history[history.length - 1].value;
      const diff = round(current - base, reading.metricId);
      return {
        ...reading,
        history,
        currentValue: current,
        deltaFromBaseline: `${diff >= 0 ? '+' : ''}${diff} ${reading.unit} vs first-week baseline`,
      };
    });
  }
  return { zones, hasData: rows.length > 0, missionStart };
}
