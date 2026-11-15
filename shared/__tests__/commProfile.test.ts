import { describe, expect, it } from 'vitest';
import { SPACE_LOCATIONS, commDelayAt } from '../../src/data/spaceLocations';
import { COMM_TIER_PROFILES, downgradeTier, resolveCommTier, tierForDelay } from '../commProfile';

describe('comm tier', () => {
  it('maps real locations to tiers by light time', () => {
    const at = (id: keyof typeof SPACE_LOCATIONS) => tierForDelay(commDelayAt(SPACE_LOCATIONS[id], new Date('2026-11-15T00:00:00Z')).seconds);
    expect(at('earth_pre')).toBe('live');
    expect(at('leo')).toBe('live');
    expect(at('gateway')).toBe('relay');
    expect(at('lunar_surface')).toBe('relay');
    expect(at('mars_transit')).toBe('autonomous');
    expect(at('mars_surface')).toBe('autonomous');
  });

  it('goes autonomous when offline or on bad input', () => {
    expect(resolveCommTier({ oneWayDelaySec: 0, online: false })).toBe('autonomous');
    expect(tierForDelay(Number.NaN)).toBe('autonomous');
  });

  it('lets an override move away from Earth but never toward it', () => {
    expect(resolveCommTier({ oneWayDelaySec: 0.2, override: 'autonomous' })).toBe('autonomous');
    expect(resolveCommTier({ oneWayDelaySec: 0.2, override: 'relay' })).toBe('relay');
    expect(resolveCommTier({ oneWayDelaySec: 600, override: 'live' })).toBe('autonomous');
    expect(resolveCommTier({ oneWayDelaySec: 1.3, override: 'live' })).toBe('relay');
  });

  it('downgrades live → relay → autonomous → none', () => {
    expect(downgradeTier('live')).toBe('relay');
    expect(downgradeTier('relay')).toBe('autonomous');
    expect(downgradeTier('autonomous')).toBeNull();
  });

  it('keeps the on-ship tier off Earth engines', () => {
    const p = COMM_TIER_PROFILES.autonomous;
    expect(p.stt).not.toContain('cloud');
    expect(p.tts).not.toContain('live');
    expect(p.frameIntervalMs).toBeNull();
    expect(p.earthLink).toBe('store-and-forward');
  });
});
