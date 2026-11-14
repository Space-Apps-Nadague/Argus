/**
 * ARGUS — Mission locations & local clocks (specs/01-data-schema.md §8, specs/02-ui-dashboard.md §6)
 * Pure data + time helpers; shared by the HUD and the AI backend.
 */

import type { GravityEnvironment, SpaceLocation, SpaceLocationId } from '../types/argus';

export const SPACE_LOCATIONS: Record<SpaceLocationId, SpaceLocation> = {
  earth_pre: {
    id: 'earth_pre',
    label: 'Earth · before mission',
    gravityG: 1,
    gravityLabel: '1 g',
    commDelaySec: [0, 0],
    radiation: 'shielded',
    clock: 'earth',
    description: 'Pre-flight on the ground: personal baselines are recorded here.',
  },
  earth_post: {
    id: 'earth_post',
    label: 'Earth · after mission',
    gravityG: 1,
    gravityLabel: '1 g',
    commDelaySec: [0, 0],
    radiation: 'shielded',
    clock: 'earth',
    description: 'Back in Earth gravity: recovery phase, compared with the pre-flight baseline.',
  },
  leo: {
    id: 'leo',
    label: 'Space station (LEO)',
    gravityG: 0,
    gravityLabel: '≈0 g',
    commDelaySec: [0, 0.1],
    radiation: 'magnetosphere',
    clock: 'leo',
    description: 'Inside the magnetosphere; about 16 sunrises a day.',
  },
  gateway: {
    id: 'gateway',
    label: 'Lunar Gateway',
    gravityG: 0,
    gravityLabel: '≈0 g',
    commDelaySec: [1.3, 1.3],
    radiation: 'deep_space',
    clock: 'lunar',
    description: 'Beyond the magnetosphere: full galactic cosmic ray and solar-particle exposure.',
  },
  lunar_surface: {
    id: 'lunar_surface',
    label: 'Lunar surface base',
    gravityG: 0.16,
    gravityLabel: '0.16 g',
    commDelaySec: [1.3, 1.3],
    radiation: 'surface',
    clock: 'lunar',
    description: 'Partial gravity; radiation shielding and dust control are critical.',
  },
  mars_transit: {
    id: 'mars_transit',
    label: 'Mars transit',
    gravityG: 0,
    gravityLabel: '≈0 g',
    commDelaySec: [180, 1320],
    radiation: 'deep_space',
    clock: 'earth',
    description: 'Months of weightlessness and deep-space radiation.',
  },
  mars_surface: {
    id: 'mars_surface',
    label: 'Mars surface base',
    gravityG: 0.38,
    gravityLabel: '0.38 g',
    commDelaySec: [180, 1320],
    radiation: 'surface',
    clock: 'mars',
    description: 'Partial gravity; gravity transitions affect balance and orientation.',
  },
  rover: {
    id: 'rover',
    label: 'Pressurised rover (Mars)',
    gravityG: 0.38,
    gravityLabel: '0.38 g',
    commDelaySec: [180, 1320],
    radiation: 'surface',
    clock: 'mars',
    description: 'Small habitable volume far from base; limited medical kit.',
  },
};

export const SPACE_LOCATION_ORDER: SpaceLocationId[] = [
  'earth_pre',
  'leo',
  'gateway',
  'lunar_surface',
  'mars_transit',
  'mars_surface',
  'rover',
  'earth_post',
];

/** Matches the `0g_transit` threshold table and the 14m 22s delay in ENVIRONMENT_META. */
export const DEFAULT_SPACE_LOCATION: SpaceLocationId = 'mars_transit';

/**
 * Which threshold set (specs/01-data-schema.md §2, `ENVIRONMENT_METRIC_THRESHOLDS`) applies at a location.
 * Earth phases use the ISS/LEO set (shielded, closest to clinical norms); open space and transit use 0g.
 */
export const LOCATION_ENVIRONMENT: Record<SpaceLocationId, GravityEnvironment> = {
  earth_pre: 'iss_leo',
  earth_post: 'iss_leo',
  leo: 'iss_leo',
  gateway: '0g_transit',
  mars_transit: '0g_transit',
  lunar_surface: 'lunar_base',
  mars_surface: 'mars_base',
  rover: 'mars_base',
};

export function environmentForLocation(id: SpaceLocationId): GravityEnvironment {
  return LOCATION_ENVIRONMENT[id] ?? '0g_transit';
}

export function isSpaceLocationId(id: unknown): id is SpaceLocationId {
  return typeof id === 'string' && id in SPACE_LOCATIONS;
}

const pad = (n: number) => String(Math.floor(n)).padStart(2, '0');

function formatSeconds(sec: number): string {
  if (sec < 1) return `${Math.round(sec * 1000)} ms`;
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m}m ${pad(s)}s` : `${m} min`;
}

/** Human-readable one-way comm delay, e.g. "none", "1.3 s", "3–22 min". */
export function formatCommDelay(loc: SpaceLocation): string {
  const [lo, hi] = loc.commDelaySec;
  if (hi === 0) return 'none';
  if (lo === hi) return formatSeconds(lo);
  if (lo >= 60) return `${Math.round(lo / 60)}–${Math.round(hi / 60)} min`;
  return `${formatSeconds(lo)}–${formatSeconds(hi)}`;
}

// ── Local clocks ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** Mars Sol Date and Coordinated Mars Time (Allison & McEwen 2000, simplified). */
export function marsTime(date: Date): { sol: number; mtc: string } {
  const jdTT = date.getTime() / MS_PER_DAY + 2440587.5 + 69.184 / 86400;
  const msd = (jdTT - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
  const frac = ((msd % 1) + 1) % 1;
  const hours = frac * 24;
  return { sol: Math.floor(msd), mtc: `${pad(hours)}:${pad((hours % 1) * 60)}` };
}

/** Days since the last new moon (synodic month ≈ 29.53 days, epoch 2000-01-06 18:14 UTC). */
export function lunarDay(date: Date): number {
  const epoch = Date.UTC(2000, 0, 6, 18, 14);
  const synodic = 29.530588853;
  const days = (date.getTime() - epoch) / MS_PER_DAY;
  return ((days % synodic) + synodic) % synodic;
}

/** ISS-like 92-minute orbit: minute in orbit and day/night side (≈ 56 min sunlit). */
export function leoOrbit(date: Date): { minute: number; side: 'day' | 'night' } {
  const minute = (date.getTime() / 60_000) % 92;
  return { minute: Math.floor(minute), side: minute < 56 ? 'day' : 'night' };
}

/** One-line local-time description for the location's clock type. */
export function locationClockLine(loc: SpaceLocation, date: Date): string | null {
  switch (loc.clock) {
    case 'mars': {
      const m = marsTime(date);
      return `Mars sol ${m.sol.toLocaleString('en-US')} · MTC ${m.mtc}`;
    }
    case 'lunar':
      return `Lunar day ${lunarDay(date).toFixed(1)} / 29.5`;
    case 'leo': {
      const o = leoOrbit(date);
      return `Orbit ${o.minute}/92 min · ${o.side} side`;
    }
    default:
      return null;
  }
}
