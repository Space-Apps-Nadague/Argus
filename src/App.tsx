/**
 * ARGUS — Astronaut Readiness Guidance & Unified Surveillance
 * Single-Screen Spacecraft HUD Layout (specs/02-ui-dashboard.md)
 *
 * Grid Proportions:
 * - Top Bar: `TopMissionBar.tsx` + Interactive Crew Roster Strip
 * - Left Column (25% / 3 of 12 cols): `TelemetryPanel.tsx` (Vital Cards & 14/30d Recharts AreaChart)
 * - Center Hero Stage (50% / 6 of 12 cols): `BioTwinMap.tsx` (Central 3D Sculpted Male/Female Bio-Twin)
 * - Right Column (25% / 3 of 12 cols): `FlightSurgeonPanel.tsx` (Autonomous Flight Surgeon & Visual Self-Exam)
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

        <main className="flex-1 max-w-[1920px] w-full mx-auto p-3 md:p-4 grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch">
          {/* Left Column — 25% (3 of 12 cols on desktop): Longitudinal Telemetry & Drift */}
          <div className="lg:col-span-3 order-2 lg:order-1 flex flex-col">
            <TelemetryPanel />
          </div>

          {/* Center Hero Column — 50% (6 of 12 cols on desktop): 3D Holographic Human Bio-Twin Stage */}
          <div className="lg:col-span-6 order-1 lg:order-2 flex flex-col">
            <BioTwinMap />
          </div>

          {/* Right Column — 25% (3 of 12 cols on desktop): Autonomous Flight Surgeon & Triage */}
          <div className="lg:col-span-3 order-3 lg:order-3 flex flex-col">
            <FlightSurgeonPanel />
          </div>
        </main>
      </div>
    </MissionProvider>
  );
};

export default App;
