/**
 * ARGUS — When does the crew member need to train? (specs/02-ui-dashboard.md §2.6 Training)
 * Deterministic rules on the latest readings, using the same gravity-specific thresholds as triage.
 */

import type { BodyZoneId, GravityEnvironment, TriageStatus, VitalSignReading } from '../../types/argus';
import { evaluateMetricStatus, getMetricThreshold } from '../../utils/triageEngine';
import type { ExerciseId } from './exercises';

export interface TrainingReason {
  metricId: string;
  text: string;
  status: TriageStatus;
}

export interface TrainingPlan {
  /** 'required': metrics call for training today. 'optional': all good, maintenance only. 'unsafe': do not exercise now. */
  state: 'required' | 'optional' | 'unsafe';
  reasons: TrainingReason[];
  exercises: ExerciseId[];
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function latest(zones: Record<BodyZoneId, VitalSignReading[]>, metricId: string): VitalSignReading | undefined {
  for (const list of Object.values(zones)) {
    const r = list.find((m) => m.metricId === metricId);
    if (r) return r;
  }
  return undefined;
}

export function recommendTraining(
  zones: Record<BodyZoneId, VitalSignReading[]>,
  zoneStatuses: Record<BodyZoneId, TriageStatus>,
  environment: GravityEnvironment
): TrainingPlan {
  // Safety first: no training with a heart alert, fever or low oxygen.
  const unsafe: TrainingReason[] = [];
  if (zoneStatuses.cardio === 'red') {
    unsafe.push({ metricId: 'cardio', text: 'Cardiovascular zone is in alert.', status: 'red' });
  }
  const temp = latest(zones, 'core_temp');
  if (temp && temp.currentValue >= 38) {
    unsafe.push({ metricId: 'core_temp', text: `Body temperature is ${fmt(temp.currentValue)} ${temp.unit} (fever).`, status: 'red' });
  }
  const spo2 = latest(zones, 'spo2');
  if (spo2 && spo2.currentValue < 93) {
    unsafe.push({ metricId: 'spo2', text: `Blood oxygen is ${fmt(spo2.currentValue)} ${spo2.unit}.`, status: 'red' });
  }
  if (unsafe.length) return { state: 'unsafe', reasons: unsafe, exercises: [] };

  const reasons: TrainingReason[] = [];
  const picks = new Set<ExerciseId>();
  const low = (metricId: string) => {
    const r = latest(zones, metricId);
    if (!r) return null;
    const status = evaluateMetricStatus(metricId, r.currentValue, environment);
    const range = getMetricThreshold(metricId, environment);
    return status !== 'green' && r.currentValue < range.nominalMin ? { r, status } : null;
  };

  const bmd = low('bmd_delta');
  if (bmd) {
    reasons.push({ metricId: 'bmd_delta', status: bmd.status, text: `${bmd.r.label} is ${fmt(bmd.r.currentValue)} ${bmd.r.unit}: bone density is dropping. Load the hips and spine.` });
    ['squats', 'lunges', 'pushups'].forEach((e) => picks.add(e as ExerciseId));
  }
  const load = low('ared_load');
  if (load) {
    reasons.push({ metricId: 'ared_load', status: load.status, text: `${load.r.label} is ${fmt(load.r.currentValue)} ${load.r.unit}, below today's target. Add resistance work.` });
    ['squats', 'pushups', 'plank'].forEach((e) => picks.add(e as ExerciseId));
  }
  if (zoneStatuses.musculo !== 'green') {
    reasons.push({ metricId: 'musculo', status: zoneStatuses.musculo, text: 'Musculoskeletal zone is out of range. Strengthen the trunk that protects the spine.' });
    ['plank', 'crunches', 'squats'].forEach((e) => picks.add(e as ExerciseId));
  }

  if (!reasons.length) return { state: 'optional', reasons: [], exercises: [] };
  return { state: 'required', reasons, exercises: [...picks] };
}
