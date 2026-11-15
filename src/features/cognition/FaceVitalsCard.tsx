/**
 * Camera health check results after a cognition game (specs/02-ui-dashboard.md §2.8).
 * Screening signs vs the crew member's own baseline. Not a diagnosis.
 */
import React from 'react';
import { AlertTriangle, Eye } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { FACE_BASELINE_MIN, type FaceFinding, type FaceVitalsSummary } from './faceVitals';

const fmt = (v: number | null, digits = 1) => (v === null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(digits));

export const FaceVitalsCard: React.FC<{ summary: FaceVitalsSummary; findings: FaceFinding[]; onViewAlert?: () => void }> = ({ summary, findings, onViewAlert }) => {
  const changed = findings.filter((f) => f.flag === 'changed' || f.flag === 'out_of_range');
  const red = changed.some((f) => f.severity === 'red');
  const calibrating = findings.every((f) => f.flag === null);
  return (
    <Card title="Camera health check" icon={<Eye className="h-4 w-4" />} actions={<span className="text-xs text-hud-muted">face seen {summary.faceSeenPct}% of {summary.seconds} s</span>}>
      {summary.faceSeenPct < 50 ? (
        <p className="text-sm text-hud-muted">The face was not visible enough to measure. Next time, sit facing the camera in even light.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <p className={`text-sm ${red ? 'text-status-red' : changed.length ? 'text-status-yellow' : 'text-hud-muted'}`}>
              {changed.length
                ? `${changed.length} sign${changed.length > 1 ? 's' : ''} need${changed.length > 1 ? '' : 's'} attention. Look again in good light; if it repeats, tell the CMO.`
                : calibrating
                  ? `No sign out of range. Building your baseline: ${FACE_BASELINE_MIN} games with the camera on.`
                  : 'Everything in your usual range.'}
            </p>
            {onViewAlert && (
              <button type="button" className={`hud-btn ml-auto ${red ? 'border-status-red/60 text-status-red' : 'border-status-yellow/60 text-status-yellow'}`} onClick={onViewAlert}>
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> View health alert
              </button>
            )}
          </div>
          <ul className="divide-y divide-hud-line text-sm">
            {findings.map((f) => (
              <li key={f.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                <span className="min-w-[11rem] text-hud-text">{f.label}</span>
                <span className="font-mono tabular-nums text-hud-text">
                  {fmt(f.value, f.key === 'faceWidthRatio' ? 3 : 1)} <span className="text-xs text-hud-muted">{f.unit}</span>
                </span>
                {f.baseline !== null && <span className="text-xs text-hud-muted">usual {fmt(f.baseline, f.key === 'faceWidthRatio' ? 3 : 1)}</span>}
                <span
                  className={`ml-auto text-xs ${
                    f.severity === 'red' ? 'text-status-red' : f.flag === 'changed' || f.flag === 'out_of_range' ? 'text-status-yellow' : f.flag === 'usual' ? 'text-status-green' : 'text-hud-muted'
                  }`}
                >
                  {f.note}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 text-[11px] text-hud-muted">
        Measured on this device from the camera; no video is saved or sent. Screening signs compared with your own baseline, not a diagnosis.
        Lighting, distance and head angle affect colour and size.
      </p>
    </Card>
  );
};
