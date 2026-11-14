/**
 * ARGUS — HUD Tab Bar (specs/02-ui-dashboard.md §1)
 * WAI-ARIA tabs: roving tabindex, ←/→/Home/End keyboard navigation.
 */

import React, { useRef } from 'react';
import { Activity, ClipboardCheck, LineChart, Stethoscope, Users } from 'lucide-react';
import { HudTabId } from '../types/argus';
import { useMission } from '../context/MissionContext';

export const HUD_TAB_DEFS: { id: HudTabId; label: string; icon: React.ReactNode }[] = [
  { id: 'biotwin', label: 'Bio-Twin', icon: <Activity className="w-4 h-4" /> },
  { id: 'trends', label: 'Trends', icon: <LineChart className="w-4 h-4" /> },
  { id: 'checkin', label: 'Check-in', icon: <ClipboardCheck className="w-4 h-4" /> },
  { id: 'surgeon', label: 'Flight Surgeon', icon: <Stethoscope className="w-4 h-4" /> },
  { id: 'crew', label: 'Crew', icon: <Users className="w-4 h-4" /> },
];

export const tabId = (id: HudTabId) => `hud-tab-${id}`;
export const panelId = (id: HudTabId) => `hud-panel-${id}`;

export const TabBar: React.FC = () => {
  const { activeTab, setActiveTab, zoneStatuses, activeCheckIns, latestDay } = useMission();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const redCount = Object.values(zoneStatuses).filter((s) => s === 'red').length;
  const loggedToday = activeCheckIns.some((e) => e.missionDay >= latestDay);

  const badge = (id: HudTabId): React.ReactNode => {
    if (id === 'biotwin' && redCount > 0) {
      return (
        <span className="ml-1 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
          {redCount}
          <span className="sr-only"> zones in alert</span>
        </span>
      );
    }
    if (id === 'checkin' && !loggedToday) {
      return (
        <span className="ml-1 w-2 h-2 rounded-full bg-hud-accent" aria-hidden="false">
          <span className="sr-only"> (today not logged)</span>
        </span>
      );
    }
    return null;
  };

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const n = HUD_TAB_DEFS.length;
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = HUD_TAB_DEFS[next].id;
    setActiveTab(id);
    refs.current[id]?.focus();
  };

  return (
    <nav className="border-b border-hud-line bg-hud-bg/80 backdrop-blur-md sticky top-0 z-20">
      <div
        role="tablist"
        aria-label="ARGUS sections"
        className="no-scrollbar max-w-[1800px] mx-auto flex gap-1 overflow-x-auto px-3 md:px-4"
      >
        {HUD_TAB_DEFS.map((t, i) => {
          const selected = activeTab === t.id;
          return (
            <button
              key={t.id}
              ref={(el) => (refs.current[t.id] = el)}
              role="tab"
              type="button"
              id={tabId(t.id)}
              aria-selected={selected}
              aria-controls={panelId(t.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`hud-focus relative flex shrink-0 items-center gap-2 px-3.5 py-3 font-display text-[13px] tracking-wide transition-colors ${
                selected ? 'text-hud-accent' : 'text-hud-muted hover:text-hud-text'
              }`}
            >
              <span aria-hidden="true">{t.icon}</span>
              {t.label}
              {badge(t.id)}
              <span
                aria-hidden="true"
                className={`absolute inset-x-2 bottom-0 h-0.5 rounded-full transition-colors ${
                  selected ? 'bg-hud-accent' : 'bg-transparent'
                }`}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
};
