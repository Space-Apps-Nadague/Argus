/**
 * ARGUS — Manual Vital Check-In Logger Modal (`VitalLoggerModal.tsx`)
 * Single Source of Truth: specs/01-data-schema.md (§2, §6) & specs/02-ui-dashboard.md (§2.1, §2.2)
 *
 * Accessible from `+ Log Vital` in BioTwinTab and TrendsTab (TelemetryPanel).
 * Supports systolic_bp, blood_glucose (mg/dL), core_temp, daily_sleep_hours,
 * mood_index, and all zone vitals with deterministic triage preview.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Activity, X } from 'lucide-react';
import { useMission } from '../context/MissionContext';
import { ZONE_ORDER } from '../data/telemetryScenarios';
import { BodyZoneId, MetricId } from '../types/argus';
import { formatFlightNormBadge, METRIC_INPUT_RANGES } from '../utils/triageEngine';
import {
  computePresetValue,
  CORE_VITAL_SHORTCUTS,
  evaluateVitalInputPreview,
  VitalPresetLevel,
} from '../utils/vitalLogger';
import { StatusPill, STATUS_WORD } from './ui/StatusPill';
import { ZoneIcon, ZONE_SHORT_NAME } from './ui/ZoneIcon';

export interface VitalLoggerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialZone?: BodyZoneId;
  initialMetricId?: string;
}

export const VitalLoggerModal: React.FC<VitalLoggerModalProps> = ({
  isOpen,
  onClose,
  initialZone,
  initialMetricId,
}) => {
  const {
    zones,
    selectedZone,
    selectedMetricId,
    environment,
    activeCrewMember,
    latestDay,
    logVitalReading,
  } = useMission();

  const titleId = useId();
  const metricSelectId = useId();
  const valueInputId = useId();
  const helpTextId = useId();
  const errorTextId = useId();

  const [logZone, setLogZone] = useState<BodyZoneId>(initialZone ?? selectedZone);
  const [logMetricKey, setLogMetricKey] = useState<string>(initialMetricId ?? selectedMetricId);
  const [rawValue, setRawValue] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const valueInputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<Element | null>(null);

  // Sync zone/metric & manage focus when modal opens/closes
  useEffect(() => {
    if (!isOpen) return;
    openerRef.current = document.activeElement;
    const targetZone = initialZone ?? selectedZone;
    const zoneReadings = zones[targetZone] || [];
    const requestedMetric = initialMetricId ?? selectedMetricId;
    const hasMetric = zoneReadings.some((r) => r.metricId === requestedMetric);

    setLogZone(targetZone);
    setLogMetricKey(hasMetric ? requestedMetric : zoneReadings[0]?.metricId ?? 'systolic_bp');
    setRawValue('');
    setStatusMessage(null);
    setSubmitError(null);

    const focusTimer = window.setTimeout(() => {
      valueInputRef.current?.focus();
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [isOpen, initialZone, initialMetricId, selectedZone, selectedMetricId, zones, onClose]);

  const zoneReadings = zones[logZone] || [];
  const activeReading =
    zoneReadings.find((r) => r.metricId === logMetricKey) || zoneReadings[0];
  const metricId = (activeReading?.metricId ?? 'systolic_bp') as MetricId;
  const unit = activeReading?.unit ?? '';
  const inputRange = METRIC_INPUT_RANGES[metricId] ?? {
    min: 0,
    max: 999,
    how: 'Standard sensor measurement.',
  };

  const preview = useMemo(
    () => evaluateVitalInputPreview(metricId, rawValue, environment),
    [metricId, rawValue, environment]
  );

  if (!isOpen) return null;

  const handleZoneChange = (zoneId: BodyZoneId) => {
    setLogZone(zoneId);
    const nextReadings = zones[zoneId] || [];
    if (!nextReadings.some((r) => r.metricId === logMetricKey)) {
      setLogMetricKey(nextReadings[0]?.metricId ?? 'systolic_bp');
    }
    setRawValue('');
    setStatusMessage(null);
    setSubmitError(null);
  };

  const handleShortcutClick = (zoneId: BodyZoneId, targetMetricId: MetricId) => {
    setLogZone(zoneId);
    setLogMetricKey(targetMetricId);
    setRawValue('');
    setStatusMessage(null);
    setSubmitError(null);
    valueInputRef.current?.focus();
  };

  const applyPreset = (preset: VitalPresetLevel) => {
    const val = computePresetValue(metricId, preset, environment);
    setRawValue(String(val));
    setStatusMessage(null);
    setSubmitError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview.valid || preview.value === null) {
      valueInputRef.current?.focus();
      return;
    }
    setIsSubmitting(true);
    setStatusMessage(null);
    setSubmitError(null);
    try {
      await logVitalReading(logZone, metricId, preview.value);
      const resultStatus = preview.status ?? 'green';
      setStatusMessage(
        `Logged ${activeReading?.label ?? metricId}: ${preview.value} ${unit} to MD-${
          latestDay || 30
        } for ${activeCrewMember.callsign} (${STATUS_WORD[resultStatus]}).`
      );
      setRawValue('');
    } catch (err) {
      console.error('Failed to log vital reading:', err);
      setSubmitError('Could not save reading. Check connection and retry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="hud-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Activity className="h-4 w-4 text-hud-accent shrink-0" aria-hidden="true" />
            <h2
              id={titleId}
              className="font-display text-sm font-semibold tracking-wide text-hud-text"
            >
              Log Vital Reading · MD-{latestDay || 30}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close vital logger"
            className="hud-focus rounded-lg border border-hud-line bg-hud-bg/60 p-1.5 text-hud-muted hover:text-hud-text transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Quick Core Vitals */}
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-hud-muted">
              Quick Core Vitals
            </p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick core vitals">
              {CORE_VITAL_SHORTCUTS.map((s) => {
                const active = metricId === s.metricId;
                return (
                  <button
                    key={s.metricId}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleShortcutClick(s.zoneId, s.metricId)}
                    className={`hud-focus rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? 'border-hud-accent/70 bg-hud-accent/15 text-hud-accent'
                        : 'border-hud-line bg-hud-bg/60 text-hud-muted hover:text-hud-text'
                    }`}
                  >
                    {s.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Zone Selector */}
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-hud-muted">
              Body Zone
            </p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Select body zone">
              {ZONE_ORDER.map((z) => {
                const active = z === logZone;
                return (
                  <button
                    key={z}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleZoneChange(z)}
                    className={`hud-focus flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? 'border-hud-accent/70 bg-hud-accent/15 text-hud-text'
                        : 'border-hud-line text-hud-muted hover:text-hud-text'
                    }`}
                  >
                    <ZoneIcon zone={z} className="h-3.5 w-3.5" />
                    {ZONE_SHORT_NAME[z]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Metric & Value Row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 min-w-0">
            <div className="min-w-0">
              <label htmlFor={metricSelectId} className="mb-1 block text-xs text-hud-muted">
                Vital Indicator
              </label>
              <select
                id={metricSelectId}
                value={metricId}
                onChange={(e) => {
                  setLogMetricKey(e.target.value);
                  setRawValue('');
                  setStatusMessage(null);
                  setSubmitError(null);
                }}
                className="hud-input"
              >
                {zoneReadings.map((r) => (
                  <option key={r.metricId} value={r.metricId}>
                    {r.label} ({r.unit})
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0">
              <label htmlFor={valueInputId} className="mb-1 block text-xs text-hud-muted">
                Reading ({unit})
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={valueInputRef}
                  id={valueInputId}
                  type="number"
                  step="any"
                  min={inputRange.min}
                  max={inputRange.max}
                  value={rawValue}
                  onChange={(e) => {
                    setRawValue(e.target.value);
                    setSubmitError(null);
                  }}
                  placeholder={
                    activeReading ? `Now ${activeReading.currentValue}` : 'Enter value'
                  }
                  aria-invalid={preview.error ? 'true' : undefined}
                  aria-describedby={preview.error ? `${errorTextId} ${helpTextId}` : helpTextId}
                  className="hud-input"
                />
                {preview.status && <StatusPill status={preview.status} size="md" />}
              </div>
              {preview.error && (
                <p id={errorTextId} className="mt-1 text-xs text-status-red">
                  {preview.error}
                </p>
              )}
            </div>
          </div>

          {/* Guidance + Flight Norm */}
          <div
            id={helpTextId}
            className="rounded-lg border border-hud-line bg-hud-bg/50 px-3 py-2 text-xs text-hud-muted space-y-1"
          >
            <p className="text-hud-text">{inputRange.how}</p>
            <p className="font-mono text-[11px]">
              {formatFlightNormBadge(metricId, unit, environment)} · Allowed {inputRange.min}–
              {inputRange.max} {unit}
            </p>
          </div>

          {/* Quick Presets + Submit Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Demo presets">
              <span className="text-[11px] text-hud-muted">Preset:</span>
              {(['nominal', 'yellow', 'red'] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="hud-btn py-1 px-2 text-[11px]"
                >
                  {preset === 'nominal' ? 'Nominal' : preset === 'yellow' ? 'Caution' : 'Alert'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="hud-btn">
                Close
              </button>
              <button
                type="submit"
                disabled={!preview.valid || isSubmitting}
                className="hud-btn-primary py-1.5 px-3 text-xs"
              >
                {isSubmitting ? 'Saving…' : 'Record reading'}
              </button>
            </div>
          </div>

          {/* Live confirmation / error */}
          {statusMessage && (
            <p
              role="status"
              aria-live="polite"
              className="rounded-lg border border-status-green/40 bg-status-green/10 px-3 py-2 text-xs text-hud-text"
            >
              {statusMessage}
            </p>
          )}
          {submitError && (
            <p
              role="alert"
              className="rounded-lg border border-status-red/50 bg-status-red/10 px-3 py-2 text-xs text-status-red"
            >
              {submitError}
            </p>
          )}
        </form>
      </div>
    </div>
  );
};
