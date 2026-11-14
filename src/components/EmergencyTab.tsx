/**
 * ARGUS — Emergency tab (specs/02-ui-dashboard.md §2.4c, specs/01-data-schema.md §10)
 * Step checklists with timestamps; "Notify Earth" queues an emergency packet with the log.
 */

import React, { useState } from 'react';
import {
  Biohazard,
  CheckCircle2,
  Circle,
  CloudFog,
  Flame,
  HeartPulse,
  Play,
  Radio,
  RotateCcw,
  Send,
  Siren,
  Sun,
  Wind,
} from 'lucide-react';
import { useMission } from '../context/MissionContext';
import type { EmergencyProtocol, EmergencyProtocolId, EmergencyRun } from '../types/argus';
import { EMERGENCY_DISCLAIMER, EMERGENCY_PROTOCOLS } from '../data/emergencyProtocols';
import { formatCommDelay } from '../data/spaceLocations';
import { Card } from './ui/Card';

const ICONS: Record<string, React.FC<{ className?: string }>> = { Flame, Wind, Biohazard, HeartPulse, Sun, CloudFog };

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function formatRunLog(protocol: EmergencyProtocol, run: EmergencyRun): string {
  const lines = protocol.steps.map((step, i) => `${run.completed[i] ? `✔ ${time(run.completed[i])}` : '✖ not done'} — ${step}`);
  return `EMERGENCY: ${protocol.title} · started ${time(run.startedAtIso)}\n${lines.join('\n')}`;
}

export const EmergencyTab: React.FC = () => {
  const { activeCrewMember, spaceLocation, zoneStatuses, queueEarthPacket } = useMission();
  const [runs, setRuns] = useState<Partial<Record<EmergencyProtocolId, EmergencyRun>>>({});
  const [sent, setSent] = useState<string | null>(null);
  const delay = formatCommDelay(spaceLocation);
  const redZones = Object.values(zoneStatuses).filter((s) => s === 'red').length;

  const start = (id: EmergencyProtocolId) =>
    setRuns((prev) => ({
      ...prev,
      [id]: { protocolId: id, crewId: activeCrewMember.id, startedAtIso: new Date().toISOString(), completed: {} },
    }));

  const toggle = (id: EmergencyProtocolId, step: number) =>
    setRuns((prev) => {
      const run = prev[id] ?? { protocolId: id, crewId: activeCrewMember.id, startedAtIso: new Date().toISOString(), completed: {} };
      const completed = { ...run.completed };
      if (completed[step]) delete completed[step];
      else completed[step] = new Date().toISOString();
      return { ...prev, [id]: { ...run, completed } };
    });

  const reset = (id: EmergencyProtocolId) =>
    setRuns(({ [id]: _removed, ...rest }) => rest);

  const notify = (protocol: EmergencyProtocol) => {
    const run = runs[protocol.id];
    if (!run) return;
    const packet = queueEarthPacket(formatRunLog(protocol, run));
    setSent(`${protocol.title}: packet ${packet.packetId} queued for Earth (${delay} one-way).`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/50 bg-red-950/40 px-4 py-3" role="note">
        <Siren className="h-5 w-5 shrink-0 text-red-300" aria-hidden="true" />
        <p className="text-sm text-red-100">
          <strong>Act first, report as you act.</strong> Earth is <span className="font-mono">{delay}</span> away one-way from{' '}
          {spaceLocation.label}.
        </p>
        {redZones > 0 && (
          <span className="ml-auto rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-semibold text-white">
            {redZones} zone{redZones > 1 ? 's' : ''} in alert — consider “Crew medical emergency”
          </span>
        )}
      </div>

      {sent && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-status-green/40 bg-status-green/10 px-3 py-2 text-sm text-status-green">
          <Radio className="h-4 w-4" aria-hidden="true" />
          {sent}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {EMERGENCY_PROTOCOLS.map((p) => {
          const Icon = ICONS[p.icon] ?? Siren;
          const run = runs[p.id];
          const done = run ? Object.keys(run.completed).length : 0;
          return (
            <Card
              key={p.id}
              title={p.title}
              icon={<Icon className="h-4 w-4 text-red-300" />}
              className={run ? 'border-red-500/60' : ''}
              actions={
                run ? (
                  <span className="font-mono text-[11px] text-hud-muted">
                    {done}/{p.steps.length} · {time(run.startedAtIso)}
                  </span>
                ) : null
              }
            >
              <p className="mb-3 text-xs text-hud-muted">{p.trigger}</p>
              <ol className="space-y-1.5">
                {p.steps.map((step, i) => {
                  const at = run?.completed[i];
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        aria-pressed={Boolean(at)}
                        onClick={() => toggle(p.id, i)}
                        className="hud-focus flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-hud-bg/60"
                      >
                        {at ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-green" aria-hidden="true" />
                        ) : (
                          <Circle className="mt-0.5 h-4 w-4 shrink-0 text-hud-muted" aria-hidden="true" />
                        )}
                        <span className={at ? 'text-hud-muted line-through' : 'text-hud-text'}>
                          <span className="mr-1 font-mono text-xs text-hud-muted">{i + 1}.</span>
                          {step}
                        </span>
                        {at && <span className="ml-auto shrink-0 font-mono text-[11px] text-hud-muted">{time(at)}</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-3 flex flex-wrap gap-2">
                {!run ? (
                  <button type="button" className="hud-btn border-red-500/60 text-red-200" onClick={() => start(p.id)}>
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    Start
                  </button>
                ) : (
                  <>
                    <button type="button" className="hud-btn border-red-500/60 text-red-100" onClick={() => notify(p)}>
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />
                      Notify Earth
                    </button>
                    <button type="button" className="hud-btn" onClick={() => reset(p.id)}>
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Reset
                    </button>
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="text-[11px] text-hud-muted">{EMERGENCY_DISCLAIMER}</p>
    </div>
  );
};
