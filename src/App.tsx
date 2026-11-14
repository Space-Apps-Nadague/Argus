/**
 * ARGUS — Astronaut Readiness Guidance & Unified Surveillance
 * HUD v2 layout (specs/02-ui-dashboard.md §1, §6)
 *
 * - Sign-in: `AuthGate.tsx` (first-run admin setup, then username + password)
 * - Top bar: `TopMissionBar.tsx` (brand, location, comm delay, clock, readiness, user menu, admin crew strip)
 * - Left tab rail: `TabBar.tsx` (Bio-Twin · Trends · Forecast · Eyes · ARGUS AI · Emergency · Crew/Users for admins)
 * - Panels: one panel per tab; only the active panel is mounted
 */

import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { MissionProvider, useMission } from './context/MissionContext';
import { HudTabId } from './types/argus';
import { AuthGate } from './components/AuthGate';
import { TopMissionBar } from './components/TopMissionBar';
import { TabBar, panelId, tabId, visibleTabs } from './components/TabBar';
import { ScheduledRoutineBanner } from './components/ScheduledRoutineBanner';
import { BioTwinTab } from './components/BioTwinTab';
import { TrendsTab } from './components/TrendsTab';
import { ForecastTab } from './components/ForecastTab';
import { EyesTab } from './components/EyesTab';
import { AiTab } from './components/AiTab';
import { EmergencyTab } from './components/EmergencyTab';
import { CrewTab } from './components/CrewTab';
import { UsersTab } from './components/UsersTab';
import { CrewManagerModal } from './components/CrewManagerModal';

const PANELS: Record<HudTabId, React.FC> = {
  biotwin: BioTwinTab,
  trends: TrendsTab,
  forecast: ForecastTab,
  eyes: EyesTab,
  ai: AiTab,
  emergency: EmergencyTab,
  crew: CrewTab,
  users: UsersTab,
};

const Hud: React.FC = () => {
  const { isAdmin, canManageRoster, canViewHealth, mode } = useAuth();
  const { activeTab: storedTab } = useMission();
  const access = { isAdmin, canManageRoster, canViewHealth };
  const tabs = visibleTabs(access);
  // A user may have a stored tab their role can't see; fall back to the first visible one.
  const activeTab: HudTabId = tabs.some((t) => t.id === storedTab) ? storedTab : tabs[0]?.id ?? 'biotwin';

  return (
    <div className="min-h-screen bg-hud-bg text-hud-text hud-grid-bg">
      <TopMissionBar />
      {canManageRoster && <CrewManagerModal />}
      {mode === 'local' && (
        <div role="status" className="border-b border-yellow-500/40 bg-yellow-500/10 px-4 py-1 text-center text-[11px] text-yellow-200">
          Offline demo · no ARGUS database connected, data stays in this browser
        </div>
      )}
      <div className="md:flex">
        <TabBar access={access} activeTab={activeTab} />
        <main className="mx-auto w-full min-w-0 max-w-[1800px] p-3 md:p-4">
          {canViewHealth && <ScheduledRoutineBanner />}
          {tabs.map(({ id }) => {
            const Panel = PANELS[id];
            const active = id === activeTab;
            return (
              <div
                key={id}
                role="tabpanel"
                id={panelId(id)}
                aria-labelledby={tabId(id)}
                hidden={!active}
                tabIndex={0}
                className="outline-none min-w-0"
              >
                {active && <Panel />}
              </div>
            );
          })}
        </main>
      </div>
    </div>
  );
};

/** Remounts the mission state per signed-in user so crew users are locked to their own astronaut. */
const SignedInApp: React.FC = () => {
  const { currentUser, removeAccountsForCrew, lockedCrewId, mode } = useAuth();
  if (!currentUser) return null;
  return (
    <MissionProvider
      key={currentUser.id}
      lockedCrewId={lockedCrewId}
      serverBacked={mode === 'server'}
      onCrewDeleted={removeAccountsForCrew}
    >
      <Hud />
    </MissionProvider>
  );
};

export const App: React.FC = () => (
  <AuthProvider>
    <AuthGate>
      <SignedInApp />
    </AuthGate>
  </AuthProvider>
);

export default App;
