import { describe, expect, it } from 'vitest';
import { resolveLiveGuidance } from '../../context/MissionContext';
import { DEFAULT_CREW_ROSTER, getCrewAdjustedZones, getOfflineFlightSurgeonGuidance } from '../../data/telemetryScenarios';
import { applyCheckIns } from '../checkIns';
import { CheckInEntry } from '../../types/argus';

const crew = DEFAULT_CREW_ROSTER[0];
const env = '0g_transit' as const;
const entry = (values: CheckInEntry['values']): CheckInEntry => ({
  id: 'e1',
  crewId: crew.id,
  missionDay: 30,
  timestampIso: '2026-11-14T08:00:00.000Z',
  values,
});
const liveNeuro = (values: CheckInEntry['values']) =>
  applyCheckIns(getCrewAdjustedZones('nominal', crew), [entry(values)]).neuro;

describe('resolveLiveGuidance (specs/01-data-schema.md §6)', () => {
  it('keeps guidance when live status already matches', () => {
    const g = getOfflineFlightSurgeonGuidance('nominal', 'neuro', env, crew);
    expect(resolveLiveGuidance(g, getCrewAdjustedZones('nominal', crew).neuro, env, crew)).toBe(g);
  });

  it('picks the protocol whose cause matches the check-in (high CO₂ → CO₂ protocol, not SANS)', () => {
    const g = getOfflineFlightSurgeonGuidance('nominal', 'neuro', env, crew);
    const out = resolveLiveGuidance(g, liveNeuro({ cabin_co2: 9 }), env, crew);
    const co2 = getOfflineFlightSurgeonGuidance('high_co2', 'neuro', env, crew);
    expect(out.triageStatus).toBe('red');
    expect(out.scenarioId).toBe('nominal');
    expect(out.headline).toBe(co2.headline);
    expect(out.headline).not.toMatch(/SANS/);
  });

  it('uses the SANS protocol when ONSD is the driver', () => {
    const g = getOfflineFlightSurgeonGuidance('nominal', 'neuro', env, crew);
    const sans = getOfflineFlightSurgeonGuidance('sans_alert', 'neuro', env, crew);
    const out = resolveLiveGuidance(g, liveNeuro({ onsd: 6.5 }), env, crew);
    expect(out.headline).toBe(sans.headline);
  });

  it('escalates cached guidance when no single protocol covers every driver (ONSD + CO₂)', () => {
    const g = getOfflineFlightSurgeonGuidance('nominal', 'neuro', env, crew);
    const out = resolveLiveGuidance(g, liveNeuro({ onsd: 6.5, cabin_co2: 9 }), env, crew);
    expect(out.triageStatus).toBe('red');
    expect(out.headline.startsWith('Check-in out of range — ')).toBe(true);
    expect(out.earthConsultUrgency).toBe('immediate_emergency_packet');
    expect(out.guidedSteps).toBe(g.guidedSteps);
  });

  it('keeps live AI content but follows the live status', () => {
    const g = { ...getOfflineFlightSurgeonGuidance('nominal', 'neuro', env, crew), source: 'live_ai' as const };
    const out = resolveLiveGuidance(g, liveNeuro({ onsd: 6.5 }), env, crew);
    expect(out.source).toBe('live_ai');
    expect(out.triageStatus).toBe('red');
    expect(out.guidedSteps).toBe(g.guidedSteps);
    expect(out.earthConsultUrgency).toBe('immediate_emergency_packet');
    // idempotent: no double prefix
    expect(resolveLiveGuidance(out, liveNeuro({ onsd: 6.5 }), env, crew)).toBe(out);
  });
});
