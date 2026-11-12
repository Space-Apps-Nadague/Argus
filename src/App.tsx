/**
 * ARGUS — Astronaut Readiness Guidance & Unified Surveillance
 * Single-Screen Spacecraft HUD Layout (specs/02-ui-dashboard.md)
 *
 * Grid Proportions:
 * - Top Bar: `TopMissionBar.tsx` + Interactive Crew Roster Strip
 * - Left Column (30%): `BioTwinMap.tsx` (3D Holographic Human Bio-Twin)
 * - Center Column (40%): `TelemetryPanel.tsx` (Vital Cards & 14/30d Recharts AreaChart)
 * - Right Column (30%): `FlightSurgeonPanel.tsx` (Autonomous Flight Surgeon & Visual Self-Exam)
 * - Modal: `CrewManagerModal.tsx` (Crew Roster Inspector & Custom Crew Member Creator)
 */

import React from 'react';
import { MissionProvider } from './context/MissionContext';
import { TopMissionBar } from './components/TopMissionBar';
import { BioTwinMap } from './components/BioTwinMap';
import { TelemetryPanel } from './components/TelemetryPanel';
import { FlightSurgeonPanel } from './components/FlightSurgeonPanel';
import { CrewManagerModal } from './components/CrewManagerModal';

export const App: React.FC = () => {
  return (
    <MissionProvider>
      <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 hud-grid-bg">
        <TopMissionBar />
        <CrewManagerModal />

        <main className="flex-1 max-w-[1800px] w-full mx-auto p-3 md:p-4 grid grid-cols-1 lg:grid-cols-10 gap-3.5 items-stretch">
          {/* Left Column — 30% (3 of 10 cols on desktop) */}
          <div className="lg:col-span-3 flex flex-col">
            <BioTwinMap />
          </div>

          {/* Center Column — 40% (4 of 10 cols on desktop) */}
          <div className="lg:col-span-4 flex flex-col">
            <TelemetryPanel />
          </div>

          {/* Right Column — 30% (3 of 10 cols on desktop) */}
          <div className="lg:col-span-3 flex flex-col">
            <FlightSurgeonPanel />
          </div>
        </main>
      </div>
    </MissionProvider>
  );
};

export default App;
