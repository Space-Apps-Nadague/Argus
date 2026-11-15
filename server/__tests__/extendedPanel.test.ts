import { describe, expect, it } from 'vitest';
import { DEFAULT_CREW_ROSTER, TELEMETRY_SCENARIOS } from '../../src/data/telemetryScenarios';
import { EXTRA_METRICS } from '../../src/data/scenarioExtensions';
import { METRIC_IDS, METRIC_THRESHOLDS_0G, evaluateAllZones } from '../../src/utils/triageEngine';
import { ACTIVE_DEVICE_KINDS, METRIC_BY_ID } from '../db/catalog';
import { simulate } from '../ingest/simulator';

const SCENARIOS = Object.keys(TELEMETRY_SCENARIOS) as Array<keyof typeof TELEMETRY_SCENARIOS>;

describe('extended 31-metric panel', () => {
  it('has seven scenarios, each carrying every metric with a full 30-day history', () => {
    expect(SCENARIOS).toHaveLength(7);
    for (const id of SCENARIOS) {
      const readings = Object.values(TELEMETRY_SCENARIOS[id].zones).flat();
      expect(new Set(readings.map((r) => r.metricId))).toEqual(new Set(METRIC_IDS));
      expect(readings).toHaveLength(31);
      for (const r of readings) {
        expect(r.history).toHaveLength(30);
        expect(r.history[29].value).toBe(r.currentValue);
      }
    }
  });

  it('defines thresholds, catalog rows and plausible values for every new metric', () => {
    for (const m of EXTRA_METRICS) {
      expect(METRIC_THRESHOLDS_0G[m.metricId], m.metricId).toBeDefined();
      const def = METRIC_BY_ID.get(m.metricId);
      expect(def, m.metricId).toBeDefined();
      for (const id of SCENARIOS) {
        const r = Object.values(TELEMETRY_SCENARIOS[id].zones).flat().find((x) => x.metricId === m.metricId)!;
        for (const p of r.history) {
          expect(p.value).toBeGreaterThanOrEqual(def!.plausibleMin);
          expect(p.value).toBeLessThanOrEqual(def!.plausibleMax);
        }
      }
    }
  });

  it('keeps each new scenario telling its own story', () => {
    const zones = (id: keyof typeof TELEMETRY_SCENARIOS) => evaluateAllZones(TELEMETRY_SCENARIOS[id].zones, '0g_transit');
    expect(zones('nominal')).toEqual({ neuro: 'green', cardio: 'green', musculo: 'green', metabolic: 'green', immune: 'green', behavioral: 'green' });
    expect(zones('dehydration').cardio).toBe('red');
    expect(zones('sleep_loss').behavioral).toBe('red');
    expect(zones('deconditioning').musculo).toBe('red');
    expect(zones('solar_storm').immune).toBe('red');
    expect(zones('sans_alert').neuro).toBe('red');
  });

  it('simulates every new metric from the active kit, denser than before', () => {
    const crew = DEFAULT_CREW_ROSTER[0];
    const start = new Date('2026-11-01T00:00:00Z');
    const batch = simulate({ crew, scenarioId: 'dehydration', from: start, to: new Date(start.getTime() + 6 * 86_400_000), templateStart: start });
    for (const kind of batch.keys()) expect(ACTIVE_DEVICE_KINDS).toContain(kind);
    const counts = new Map<string, number>();
    for (const r of [...batch.values()].flat()) counts.set(r.metric, (counts.get(r.metric) ?? 0) + 1);
    for (const m of EXTRA_METRICS) expect(counts.get(m.metricId), m.metricId).toBeGreaterThan(0);
    for (const id of ['hydration_intake', 'caloric_intake', 'skin_temp']) expect(counts.get(id), id).toBeGreaterThan(0);
    // SpO₂ every 2 minutes (default) and CGM every 5 minutes.
    expect(counts.get('spo2')).toBeGreaterThanOrEqual(6 * 720 - 1);
    expect(counts.get('blood_glucose')).toBeLessThanOrEqual(6 * 288 + 6);
  });
});
