/**
 * ARGUS — Mission clock (specs/02-ui-dashboard.md §6)
 * Two clocks: Earth (Houston, Mission Control) and, away from Earth, the mission area's own time.
 * Ticks once per second in its own component so the rest of the HUD doesn't re-render.
 */

import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import type { SpaceLocation } from '../types/argus';
import { earthClock, missionAreaClock, type ClockLine } from '../data/dualClock';

export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

const Line: React.FC<{ line: ClockLine; accent?: boolean }> = ({ line, accent }) => (
  <div className="flex items-baseline gap-1.5 whitespace-nowrap font-mono">
    <span className={`text-[10px] uppercase tracking-wide ${accent ? 'text-hud-accent' : 'text-hud-muted'}`}>{line.label}</span>
    <span className="text-xs text-hud-text">{line.time}</span>
    <span className="text-[10px] text-hud-muted">{line.detail}</span>
  </div>
);

export const MissionClock: React.FC<{ location: SpaceLocation; missionDay: number }> = ({ location, missionDay }) => {
  const now = useNow();
  const area = missionAreaClock(location, now);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-hud-line bg-hud-panel/80 px-3 py-1.5" aria-live="off">
      <Clock className="h-4 w-4 shrink-0 text-hud-accent" aria-hidden="true" />
      <div className="leading-tight">
        <time dateTime={now.toISOString()} className="block">
          {area && <Line line={area} accent />}
          <Line line={earthClock(now)} />
        </time>
        <div className="font-mono text-[10px] text-hud-muted">Mission day {missionDay}</div>
      </div>
    </div>
  );
};
