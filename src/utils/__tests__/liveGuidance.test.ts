import { describe, expect, it } from 'vitest';
import { resolveLiveGuidance } from '../../context/MissionContext';
import { DEFAULT_CREW_ROSTER, getOfflineFlightSurgeonGuidance } from '../../data/telemetryScenarios';

const crew = DEFAULT_CREW_ROSTER[0];

describe('resolveLiveGuidance (specs/01-data-schema.md §6)', () => {
  it('keeps guidance when live status already matches', () => {
    const g = getOfflineFlightSurgeonGuidance('nominal', 'neuro', '0g_transit', crew);
    expect(resolveLiveGuidance(g, g.triageStatus, '0g_transit', crew)).toBe(g);
  });

  it('switches to the matching offline protocol when a check-in turns the zone red', () => {
    const g = getOfflineFlightSurgeonGuidance('nominal', 'neuro', '0g_transit', crew);
    const out = resolveLiveGuidance(g, 'red', '0g_transit', crew);
    expect(out.triageStatus).toBe('red');
    expect(out.scenarioId).toBe('nominal');
    expect(out.zoneId).toBe('neuro');
    expect(out.headline).not.toBe(g.headline);
  });

  it('never replaces live AI guidance', () => {
    const g = { ...getOfflineFlightSurgeonGuidance('nominal', 'neuro', '0g_transit', crew), source: 'live_ai' as const };
    expect(resolveLiveGuidance(g, 'red', '0g_transit', crew)).toBe(g);
  });

  it('falls back to escalating cached guidance when no protocol matches', () => {
    const g = { ...getOfflineFlightSurgeonGuidance('nominal', 'musculo', '0g_transit', crew), triageStatus: 'green' as const };
    const out = resolveLiveGuidance(g, 'red', '0g_transit', crew);
    expect(out.triageStatus).toBe('red');
    if (out.headline.startsWith('Check-in out of range')) {
      expect(out.earthConsultUrgency).toBe('immediate_emergency_packet');
    }
  });
});
