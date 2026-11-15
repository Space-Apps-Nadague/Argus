/**
 * ARGUS — Astronaut Readiness Guidance & Unified Surveillance
 * HUD v2 layout (specs/02-ui-dashboard.md §1, §6)
 *
 * - Sign-in: `AuthGate.tsx` (first-run admin setup, then username + password)
 * - Top bar: `TopMissionBar.tsx` (brand, location, comm delay, clock, readiness, user menu, admin crew strip)
 * - Left tab rail: `TabBar.tsx` (Bio-Twin · Trends · Forecast · Eyes · ARGUS · Crew/Users for admins)
 * - ARGUS console: `console/ConsoleTab.tsx`, state in `AssistantContext` (kept across tab switches)
 * - Panels: one panel per tab; only the active panel is mounted
 */

import React, { Component } from 'react';
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
import { ConsoleTab } from './components/console/ConsoleTab';
import { AssistantProvider } from './context/AssistantContext';
import { CognitionTab } from './components/CognitionTab';
import { CrewTab } from './components/CrewTab';
import { UsersTab } from './components/UsersTab';
import { PhotoboothTab } from './components/PhotoboothTab';
import { CrewManagerModal } from './components/CrewManagerModal';
import { LifeThreatAlert } from './components/LifeThreatAlert';
import { SpacecraftAlert } from './components/SpacecraftAlert';

const PANELS: Record<HudTabId, React.FC> = {
  biotwin: BioTwinTab,
  trends: TrendsTab,
  forecast: ForecastTab,
  eyes: EyesTab,
  console: ConsoleTab,
  cognition: CognitionTab,
  crew: CrewTab,
  users: UsersTab,
  photobooth: PhotoboothTab,
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
      {canViewHealth && <LifeThreatAlert />}
      <SpacecraftAlert />
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

interface HudErrorBoundaryProps {
  children: React.ReactNode;
  onSignOut: () => void;
}

interface HudErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

class HudErrorBoundary extends Component<HudErrorBoundaryProps, HudErrorBoundaryState> {
  state: HudErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<HudErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(_error: Error, info: React.ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-hud-bg p-4 text-hud-text hud-grid-bg">
        <div role="alert" className="w-full max-w-lg rounded-xl border border-red-500/40 bg-hud-surface/90 p-5 shadow-xl">
          <h1 className="font-display text-base font-semibold text-red-300">ARGUS HUD hit an unexpected error</h1>
          <p className="mt-1.5 text-sm text-hud-muted">{error.message || 'Unknown render error'}</p>
          {componentStack && (
            <details className="mt-3 rounded-lg border border-hud-line bg-hud-bg/60 p-2.5 text-xs text-hud-muted">
              <summary className="cursor-pointer font-medium text-hud-text">Component stack</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{componentStack.trim()}</pre>
            </details>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="hud-focus rounded-lg bg-hud-accent/20 px-3 py-1.5 text-xs font-medium text-hud-accent hover:bg-hud-accent/30"
            >
              Reload page
            </button>
            <button
              type="button"
              onClick={this.props.onSignOut}
              className="hud-focus rounded-lg border border-hud-line px-3 py-1.5 text-xs font-medium text-hud-text hover:bg-hud-surface"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/** Remounts the mission state per signed-in user so crew users are locked to their own astronaut. */
const SignedInApp: React.FC = () => {
  const { currentUser, removeAccountsForCrew, lockedCrewId, canViewHealth, mode, logout } = useAuth();
  if (!currentUser) return null;
  return (
    <HudErrorBoundary key={currentUser.id} onSignOut={logout}>
      <MissionProvider
        lockedCrewId={lockedCrewId}
        canViewHealth={canViewHealth}
        serverBacked={mode === 'server'}
        onCrewDeleted={removeAccountsForCrew}
      >
        <AssistantProvider>
          <Hud />
        </AssistantProvider>
      </MissionProvider>
    </HudErrorBoundary>
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
