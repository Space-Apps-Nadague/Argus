/**
 * ARGUS — organs of the Bio-Twin and the Thousand Eyes indicators that judge each one.
 * An organ's status is the worst of (a) its indicators against the personal baseline
 * (src/features/thousandEyes/science.ts) and (b) its HUD zone's deterministic triage status
 * (src/utils/triageEngine.ts), so a red zone is always red on the body. Pure data + functions, no UI.
 */

import type { BodyZoneId, TriageStatus } from '../../types/argus';
import { INDICATOR_BY_KEY } from '../thousandEyes/indicators';
import { indicatorStatus } from '../thousandEyes/science';
import type { IndicatorStatus, Person, Status } from '../thousandEyes/types';

export type OrganId = 'brain' | 'eyes' | 'heart' | 'lungs' | 'liver' | 'spleen' | 'kidneys' | 'muscles' | 'bones';

/** Peel levels, outermost first. Each step removes the layer in front. */
export type PeelLevel = 'body' | 'organs' | 'deep' | 'skeleton';

export interface Organ {
  id: OrganId;
  label: string;
  /** HUD zone kept in sync when the organ is selected. */
  zone: BodyZoneId;
  /** Thousand Eyes indicator keys that judge this organ. */
  indicators: readonly string[];
  /** Peel levels where the organ is shown and clickable. */
  levels: readonly PeelLevel[];
}

export const ORGANS: readonly Organ[] = [
  { id: 'brain', label: 'Brain', zone: 'neuro', indicators: ['mood', 'stress', 'energy', 'cohes', 'priv', 'motiv', 'sleep', 'slq', 'diz'], levels: ['body', 'organs', 'deep'] },
  { id: 'eyes', label: 'Eyes', zone: 'neuro', indicators: ['vis'], levels: ['body', 'organs', 'deep'] },
  { id: 'heart', label: 'Heart', zone: 'cardio', indicators: ['rhr', 'hrv', 'sbp', 'dbp'], levels: ['body', 'organs'] },
  { id: 'lungs', label: 'Lungs', zone: 'cardio', indicators: ['spo2', 'resp'], levels: ['body', 'organs'] },
  { id: 'liver', label: 'Liver', zone: 'metabolic', indicators: ['crp', 'wt', 'kcal'], levels: ['body', 'organs'] },
  { id: 'spleen', label: 'Spleen', zone: 'immune', indicators: ['temp', 'sym'], levels: ['body', 'organs', 'deep'] },
  { id: 'kidneys', label: 'Kidneys', zone: 'immune', indicators: ['urine', 'fluid'], levels: ['body', 'organs', 'deep'] },
  { id: 'muscles', label: 'Muscles', zone: 'musculo', indicators: ['grip', 'resist', 'aero'], levels: ['body'] },
  { id: 'bones', label: 'Bones', zone: 'musculo', indicators: ['back', 'height'], levels: ['skeleton'] },
];

export const ORGAN_BY_ID: Readonly<Record<OrganId, Organ>> = Object.fromEntries(ORGANS.map((o) => [o.id, o])) as Record<
  OrganId,
  Organ
>;

export const PEEL_LEVELS: readonly { id: PeelLevel; label: string; hint: string }[] = [
  { id: 'body', label: 'Body', hint: 'Skin and muscles' },
  { id: 'organs', label: 'Organs', hint: 'Skin removed' },
  { id: 'deep', label: 'Deep organs', hint: 'Heart, lungs, liver and ribs removed' },
  { id: 'skeleton', label: 'Skeleton', hint: 'Bones only' },
];

export interface OrganState {
  organ: Organ;
  /** Shown status: worst of `ringStatus` and `zoneStatus`; undefined when neither has data. */
  status?: Status;
  /** Worst status among its Thousand Eyes indicators with data. */
  ringStatus?: Status;
  /** Its HUD zone's triage status (fixed thresholds), when known. */
  zoneStatus?: Status;
  indicators: IndicatorStatus[];
}

export const TRIAGE_TO_STATUS: Readonly<Record<TriageStatus, Status>> = { green: 0, yellow: 1, red: 2 };

/** Worst of the given statuses (2 > 1 > 0), or undefined if none. */
export function worstStatus(statuses: Array<Status | undefined>): Status | undefined {
  let w: Status | undefined;
  statuses.forEach((s) => {
    if (s != null && (w == null || s > w)) w = s;
  });
  return w;
}

export function organStates(
  person: Person,
  now: number,
  zoneStatuses?: Partial<Record<BodyZoneId, TriageStatus>>
): Record<OrganId, OrganState> {
  const out = {} as Record<OrganId, OrganState>;
  ORGANS.forEach((organ) => {
    const indicators = organ.indicators.filter((k) => INDICATOR_BY_KEY[k]).map((k) => indicatorStatus(person, k, now));
    const ringStatus = worstStatus(indicators.map((s) => (s.n ? s.status : undefined)));
    const triage = zoneStatuses?.[organ.zone];
    const zoneStatus = triage ? TRIAGE_TO_STATUS[triage] : undefined;
    out[organ.id] = { organ, indicators, ringStatus, zoneStatus, status: worstStatus([ringStatus, zoneStatus]) };
  });
  return out;
}
