/**
 * ARGUS — dual clock (specs/02-ui-dashboard.md §6).
 * Earth time is always shown as Houston (NASA JSC, Mission Control). When the astronaut is away from
 * Earth, the local time of the mission area is shown next to it: Mars time on Mars, Moon time on the
 * Moon / Gateway, station time (UTC, as on the ISS) in LEO, and ship time (UTC) in transit.
 */

import type { SpaceLocation } from '../types/argus';
import { leoOrbit, lunarDay, marsTime } from './spaceLocations';

export const HOUSTON_TZ = 'America/Chicago';

export interface ClockLine {
  /** Short place label, e.g. "Earth · Houston", "Mars". */
  label: string;
  /** Main reading, e.g. "14:03:22 CST", "MTC 09:41". */
  time: string;
  /** Secondary reading, e.g. "Sat 14 Nov", "Sol 53,812". */
  detail: string;
}

const utc = (d: Date) => d.toISOString().slice(11, 19);

export function earthClock(now: Date): ClockLine {
  const time = now.toLocaleTimeString('en-GB', {
    timeZone: HOUSTON_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
  const detail = now.toLocaleDateString('en-GB', { timeZone: HOUSTON_TZ, weekday: 'short', day: 'numeric', month: 'short' });
  return { label: 'Earth · Houston', time, detail };
}

/** Local time of the mission area, or null when the astronaut is on Earth. */
export function missionAreaClock(loc: SpaceLocation, now: Date): ClockLine | null {
  if (loc.id === 'earth_pre' || loc.id === 'earth_post') return null;
  switch (loc.clock) {
    case 'mars': {
      const m = marsTime(now);
      return { label: 'Mars', time: `MTC ${m.mtc}`, detail: `Sol ${m.sol.toLocaleString('en-US')}` };
    }
    case 'lunar': {
      const d = lunarDay(now);
      return { label: 'Moon', time: `Day ${d.toFixed(1)} / 29.5`, detail: `lunar cycle · UTC ${utc(now).slice(0, 5)}` };
    }
    case 'leo': {
      const o = leoOrbit(now);
      return { label: 'Station', time: `GMT ${utc(now)}`, detail: `orbit ${o.minute}/92 min · ${o.side} side` };
    }
    default:
      return { label: 'Ship', time: `UTC ${utc(now)}`, detail: 'ship time' };
  }
}
