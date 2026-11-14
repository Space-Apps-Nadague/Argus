/**
 * ARGUS — Mission clock (specs/02-ui-dashboard.md §6)
 * Ticks once per second in its own component so the rest of the HUD doesn't re-render.
 */

import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import type { SpaceLocation } from '../types/argus';
import { locationClockLine } from '../data/spaceLocations';

export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export const MissionClock: React.FC<{ location: SpaceLocation; missionDay: number }> = ({ location, missionDay }) => {
  const now = useNow();
  const date = now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const utc = now.toISOString().slice(11, 19);
  const local = locationClockLine(location, now);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-hud-line bg-hud-panel/80 px-3 py-1.5" aria-live="off">
      <Clock className="h-4 w-4 shrink-0 text-hud-accent" aria-hidden="true" />
      <div className="leading-tight">
        <div className="font-mono text-xs text-hud-text">
          <time dateTime={now.toISOString()}>
            {date} · {time}
          </time>
        </div>
        <div className="font-mono text-[11px] text-hud-muted">
          UTC {utc} · Mission day {missionDay}
          {local ? ` · ${local}` : ''}
        </div>
      </div>
    </div>
  );
};
