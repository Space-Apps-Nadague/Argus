/**
 * ARGUS — Astronaut Readiness Guidance & Unified Surveillance
 * Tabbed HUD layout (specs/02-ui-dashboard.md §1–§2)
 *
 * - Top bar: `TopMissionBar.tsx` (brand, comm delay, readiness, scenario, crew strip)
 * - Tab bar: `TabBar.tsx` (Bio-Twin · Trends · Check-in · Flight Surgeon · Crew)
 * - Panels: one full-width panel per tab; only the active panel is mounted
 * - Dialog: `CrewManagerModal.tsx` (add crew member)
 */

import React from 'react';
import { MissionProvider, useMission } from './context/MissionContext';
import { HudTabId } from './types/argus';
import { TopMissionBar } from './components/TopMissionBar';
import { TabBar, HUD_TAB_DEFS, panelId, tabId } from './components/TabBar';
import { BioTwinTab } from './components/BioTwinTab';
import { TrendsTab } from './components/TrendsTab';
import { CheckInTab } from './components/CheckInTab';
import { FlightSurgeonPanel } from './components/FlightSurgeonPanel';
import { CrewTab } from './components/CrewTab';
import { CrewManagerModal } from './components/CrewManagerModal';

const PANELS: Record<HudTabId, React.FC> = {
  biotwin: BioTwinTab,
  trends: TrendsTab,
  checkin: CheckInTab,
  surgeon: FlightSurgeonPanel,
  crew: CrewTab,
};

const ActivePanel: React.FC = () => {
  const { activeTab } = useMission();
  return (
    <>
      {HUD_TAB_DEFS.map(({ id }) => {
        const Panel = PANELS[id];
        const active = id === activeTab;
        return (
          <div key={id} role="tabpanel" id={panelId(id)} aria-labelledby={tabId(id)} hidden={!active} tabIndex={0} className="outline-none">
            {active && <Panel />}
          </div>
        );
      })}
    </>
  );
};

export const App: React.FC = () => (
  <MissionProvider>
    <div className="min-h-screen bg-hud-bg text-hud-text hud-grid-bg">
      <TopMissionBar />
      <TabBar />
      <CrewManagerModal />
      <main className="mx-auto w-full max-w-[1800px] p-3 md:p-4">
        <ActivePanel />
      </main>
    </div>
  </MissionProvider>
);

export default App;
