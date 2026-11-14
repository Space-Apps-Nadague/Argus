/**
 * ARGUS — Bio-Twin tab (specs/02-ui-dashboard.md §2.1)
 * 3D hero stage + selected-zone vital tiles. Clicking a tile opens Trends for that metric.
 */

import React from 'react';
import { Stethoscope } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { BODY_ZONES } from '../data/telemetryScenarios';
import { computeDrift } from '../utils/driftAnalytics';
import { evaluateMetricStatus, formatFlightNormBadge } from '../utils/triageEngine';
import { BioTwinMap } from './BioTwinMap';
import { InfoTip } from './InfoTip';
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
  } = useMission();
  const zone = BODY_ZONES[selectedZone];
  const zoneStatus = zoneStatuses[selectedZone];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col lg:col-span-2">
        <BioTwinMap />
      </div>

      <div className="flex min-w-0 flex-col gap-4">
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
                onClick={() => {
                  setActiveTab('trends');
                }}
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
          <Card bodyClassName="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-hud-text truncate">{guidance.headline}</p>
              <p className="text-xs text-hud-muted">{guidance.guidedSteps.length} guided steps</p>
            </div>
            <button type="button" className="hud-btn shrink-0" onClick={() => setActiveTab('surgeon')}>
              <Stethoscope className="h-4 w-4" aria-hidden="true" />
              Open
            </button>
          </Card>
        )}
      </div>
    </div>
  );
};
