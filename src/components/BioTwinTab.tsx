/**
 * ARGUS — Bio-Twin tab (specs/02-ui-dashboard.md §2.1)
 * 3D hero stage + selected-zone vital tiles. Clicking a tile opens Trends for that metric.
 */

import React, { useState } from 'react';
import { CheckCircle2, Circle, Send, Stethoscope } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { BODY_ZONES } from '../data/telemetryScenarios';
import { computeDrift } from '../utils/driftAnalytics';
import { evaluateMetricStatus, formatFlightNormBadge } from '../utils/triageEngine';
import { BioTwinMap } from './BioTwinMap';
import { InfoTip } from './InfoTip';
import { VitalLoggerModal } from './VitalLoggerModal';
import { Card } from './ui/Card';
import { StatTile } from './ui/StatTile';
import { StatusPill } from './ui/StatusPill';
import { ZoneIcon, ZONE_SHORT_NAME } from './ui/ZoneIcon';

export const BioTwinTab: React.FC = () => {
  const {
    selectedZone,
    selectedMetricId,
    setSelectedMetricId,
    currentZoneReadings,
    zoneStatuses,
    environment,
    setActiveTab,
    guidance,
    completedStepIds,
    toggleStepCompleted,
    queueEarthPacket,
    queuedPackets,
  } = useMission();
  const [isLoggerOpen, setIsLoggerOpen] = useState(false);
  const zone = BODY_ZONES[selectedZone];
  const zoneStatus = zoneStatuses[selectedZone];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 flex flex-col min-w-0">
        <BioTwinMap />
      </div>

      <div className="flex flex-col gap-4 min-w-0">
        <Card
          title={
            <span className="flex items-center gap-2">
              <ZoneIcon zone={selectedZone} />
              {ZONE_SHORT_NAME[selectedZone]}
            </span>
          }
          actions={
            <>
              <button
                type="button"
                onClick={() => setIsLoggerOpen(true)}
                className="hud-focus rounded border border-hud-accent/40 bg-hud-accent/10 px-2 py-1 text-xs font-mono text-hud-accent hover:bg-hud-accent/20 transition-colors"
                title="Log Vital Reading for this zone"
              >
                + Log Vital
              </button>
              <StatusPill status={zoneStatus} size="md" />
              <InfoTip label={`About ${zone.name}`} align="right">
                <strong className="block text-hud-text">{zone.name}</strong>
                <span className="block text-hud-muted">{zone.anatomicalSubtitle}</span>
                <span className="mt-1 block">{zone.nasaHazardFocus}</span>
              </InfoTip>
            </>
          }
          bodyClassName="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2.5"
        >
          {currentZoneReadings.map((r) => (
            <StatTile
              key={r.metricId}
              label={r.label}
              value={r.currentValue}
              unit={r.unit}
              status={evaluateMetricStatus(r.metricId, r.currentValue, environment)}
              drift={computeDrift(r.metricId, r.history)}
              selected={r.metricId === selectedMetricId}
              onClick={() => {
                setSelectedMetricId(r.metricId);
                setActiveTab('trends');
              }}
              info={
                <>
                  <span className="block">{r.plainDescription}</span>
                  <span className="mt-1 block font-mono text-hud-accent">{formatFlightNormBadge(r.metricId, r.unit, environment)}</span>
                  <span className="block font-mono text-hud-muted">{r.deltaFromBaseline}</span>
                </>
              }
            />
          ))}
        </Card>

        {zoneStatus !== 'green' && (
          <Card
            title="Flight Surgeon Countermeasures"
            icon={<Stethoscope className="h-4 w-4" />}
            bodyClassName="p-4 space-y-3"
          >
            <div className="space-y-1">
              <p className="text-sm font-semibold text-hud-text">{guidance.headline}</p>
              <p className="text-xs text-hud-muted">{guidance.plainLanguageExplanation}</p>
            </div>

            <ul className="space-y-2">
              {guidance.guidedSteps.map((step) => {
                const done = completedStepIds.includes(step.id);
                return (
                  <li key={step.id}>
                    <button
                      type="button"
                      onClick={() => toggleStepCompleted(step.id)}
                      aria-pressed={done}
                      className={`hud-focus flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                        done
                          ? 'border-emerald-500/50 bg-emerald-950/25 text-hud-muted'
                          : 'border-hud-line bg-hud-panel/60 text-hud-text hover:border-hud-accent/60'
                      }`}
                    >
                      {done ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                      ) : (
                        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-hud-accent" aria-hidden="true" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className={`text-xs font-semibold ${done ? 'line-through' : ''}`}>{step.title}</span>
                          <span className="font-mono text-[10px] text-hud-accent">{step.estimatedMinutes} min</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-hud-muted">{step.plainInstruction}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-hud-muted/80">{step.hardwareRequired}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                className="hud-btn text-xs"
                onClick={() => queueEarthPacket(guidance.headline)}
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Queue Earth Packet{queuedPackets.length > 0 ? ` (${queuedPackets.length})` : ''}
              </button>
              <button type="button" className="hud-btn text-xs" onClick={() => setActiveTab('console')}>
                <Stethoscope className="h-3.5 w-3.5" aria-hidden="true" />
                Open ARGUS
              </button>
            </div>
          </Card>
        )}
      </div>

      <VitalLoggerModal
        isOpen={isLoggerOpen}
        onClose={() => setIsLoggerOpen(false)}
        initialZone={selectedZone}
        initialMetricId={selectedMetricId}
      />
    </div>
  );
};
