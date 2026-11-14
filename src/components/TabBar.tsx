/**
 * ARGUS — HUD tab rail (specs/02-ui-dashboard.md §1)
 * Vertical WAI-ARIA tablist on the left from `md` up, horizontal scroller on phones.
 * Roving tabindex; Up/Down (Left/Right on phones), Home/End keyboard navigation.
 */

import React, { useRef } from 'react';
import { Activity, Bot, Eye, LineChart, Siren, Telescope, UserCog, Users } from 'lucide-react';
import { HudTabId } from '../types/argus';
import { useMission } from '../context/MissionContext';

export interface HudTabDef {
  id: HudTabId;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

export const HUD_TAB_DEFS: HudTabDef[] = [
  { id: 'biotwin', label: 'Bio-Twin', icon: <Activity className="w-4 h-4" /> },
  { id: 'trends', label: 'Trends', icon: <LineChart className="w-4 h-4" /> },
  { id: 'forecast', label: 'Forecast', icon: <Telescope className="w-4 h-4" /> },
  { id: 'eyes', label: 'Eyes', icon: <Eye className="w-4 h-4" /> },
  { id: 'ai', label: 'ARGUS AI', icon: <Bot className="w-4 h-4" /> },
  { id: 'emergency', label: 'Emergency', icon: <Siren className="w-4 h-4" /> },
  { id: 'crew', label: 'Crew', icon: <Users className="w-4 h-4" />, adminOnly: true },
  { id: 'users', label: 'Users', icon: <UserCog className="w-4 h-4" />, adminOnly: true },
];

export const visibleTabs = (isAdmin: boolean) => HUD_TAB_DEFS.filter((t) => isAdmin || !t.adminOnly);

export const tabId = (id: HudTabId) => `hud-tab-${id}`;
export const panelId = (id: HudTabId) => `hud-panel-${id}`;

export const TabBar: React.FC<{ isAdmin: boolean; activeTab: HudTabId }> = ({ isAdmin, activeTab }) => {
  const { setActiveTab, zoneStatuses } = useMission();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabs = visibleTabs(isAdmin);
  const redCount = Object.values(zoneStatuses).filter((s) => s === 'red').length;

  const badge = (id: HudTabId): React.ReactNode =>
    id === 'biotwin' && redCount > 0 ? (
      <span className="ml-auto inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
        {redCount}
        <span className="sr-only"> zones in alert</span>
      </span>
    ) : null;

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const n = tabs.length;
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (index + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = tabs[next].id;
    setActiveTab(id);
    refs.current[id]?.focus();
  };

  return (
    <nav
      aria-label="ARGUS sections"
      className="sticky top-0 z-20 border-b border-hud-line bg-hud-bg/90 backdrop-blur-md md:top-0 md:h-[calc(100vh-1px)] md:w-48 md:shrink-0 md:border-b-0 md:border-r md:bg-hud-bg/60"
    >
      <div className="flex md:h-full md:flex-col">
        <div
          role="tablist"
          aria-orientation="vertical"
          className="no-scrollbar flex flex-1 gap-1 overflow-x-auto px-2 py-1.5 md:flex-col md:overflow-x-visible md:overflow-y-auto md:px-2 md:py-3"
        >
          {tabs.map((t, i) => {
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
                className={`hud-focus flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 font-display text-[13px] tracking-wide transition-colors md:w-full ${
                  selected
                    ? 'bg-hud-accent/15 text-hud-accent'
                    : 'text-hud-muted hover:bg-hud-panel hover:text-hud-text'
                } ${t.id === 'users' ? 'md:mt-3 md:border-t md:border-hud-line md:pt-3' : ''}`}
              >
                <span aria-hidden="true">{t.icon}</span>
                {t.label}
                {badge(t.id)}
              </button>
            );
          })}
        </div>
        <div className="flex items-center px-2 py-1.5 md:px-2 md:pb-4">
          <button
            type="button"
            onClick={() => setActiveTab('emergency')}
            className="hud-focus flex items-center justify-center gap-2 rounded-lg border border-red-500/60 bg-red-600/20 px-3 py-2 font-display text-xs font-bold tracking-widest text-red-200 transition-colors hover:bg-red-600/40 md:w-full"
            aria-label="SOS: open emergency protocols"
          >
            <Siren className="h-4 w-4" aria-hidden="true" />
            SOS
          </button>
        </div>
      </div>
    </nav>
  );
};
