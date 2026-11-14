/**
 * ARGUS — ARGUS AI tab (specs/02-ui-dashboard.md §2.4)
 * Every Flight Surgeon tool lives here: Chat · Flight Surgeon · Diagnostics · Plan · Wellbeing.
 */

import React, { useState } from 'react';
import { Bot, ClipboardList, HeartHandshake, MessageSquare, Microscope, Stethoscope } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { Card } from './ui/Card';
import { FlightSurgeonPanel } from './FlightSurgeonPanel';
import { ChatPanel } from './ai/ChatPanel';
import { DiagnosticsPanel, PlanPanel } from './ai/InsightPanels';
import { WellbeingPanel } from './ai/WellbeingPanel';
import { ProviderBadge, useAiStatus } from './ai/shared';

type Section = 'chat' | 'surgeon' | 'diagnostics' | 'plan' | 'wellbeing';

const SECTIONS: Array<{ id: Section; label: string; icon: React.ReactNode }> = [
  { id: 'chat', label: 'Chat', icon: <MessageSquare className="h-4 w-4" /> },
  { id: 'surgeon', label: 'Flight Surgeon', icon: <Stethoscope className="h-4 w-4" /> },
  { id: 'diagnostics', label: 'Diagnostics', icon: <Microscope className="h-4 w-4" /> },
  { id: 'plan', label: 'Plan', icon: <ClipboardList className="h-4 w-4" /> },
  { id: 'wellbeing', label: 'Wellbeing', icon: <HeartHandshake className="h-4 w-4" /> },
];

export const AiTab: React.FC = () => {
  const { activeCrewMember, runtimeApiKey } = useMission();
  const { status, checked } = useAiStatus(runtimeApiKey);
  const [section, setSection] = useState<Section>('chat');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold tracking-wide text-hud-text">
          <Bot className="h-5 w-5 text-hud-accent" aria-hidden="true" />
          ARGUS AI · {activeCrewMember.callsign}
        </h2>
        <ProviderBadge status={status} checked={checked} />
        <div className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-hud-line bg-hud-panel/60 p-1 md:ml-auto" role="group" aria-label="AI section">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={section === s.id}
              onClick={() => setSection(s.id)}
              className="hud-seg flex shrink-0 items-center gap-1.5 px-3 py-1.5"
            >
              <span aria-hidden="true">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {section === 'surgeon' ? (
        <FlightSurgeonPanel />
      ) : (
        <Card>
          {section === 'chat' && <ChatPanel />}
          {section === 'diagnostics' && <DiagnosticsPanel />}
          {section === 'plan' && <PlanPanel />}
          {section === 'wellbeing' && <WellbeingPanel />}
        </Card>
      )}
    </div>
  );
};
