/**
 * ARGUS — Anomaly detectors (specs/05-data-platform.md §5.3). Informational only: never change triage.
 * Source: SRC-063 (robust z with MAD, NIST e-Handbook 1.3.5.17), SRC-064 (EWMA and CUSUM, NIST 6.3.2)
 */

/** 1.4826 · MAD estimates σ for normally distributed data (Source: SRC-063). */
export const MAD_TO_SD = 1.4826;
/** |robust z| at or above this is an outlier (Iglewicz & Hoaglin; Source: SRC-063). */
export const ROBUST_Z_LIMIT = 3.5;
/** Minutes an outlier must persist before it counts (suppresses wearable artifacts). */
export const PERSISTENCE_MIN = 10;
export const EWMA_ALPHA = 0.3;
/**
 * Exposure metrics whose change from Earth is environmental, not physiological (spec 05 §5.2):
 * their personal baseline is early flight (mission days 1–7) instead of Earth pre-flight.
 */
export const DRIFT_FROM_EARLY_FLIGHT: readonly string[] = ['rad_dose'];

/** Points that form a metric's personal baseline: Earth pre-flight days (missionDay ≤ 0) if present, else early flight. */
export function baselinePoints<T extends { missionDay: number }>(metricId: string, sorted: T[], n = 7): T[] {
  const earth = sorted.filter((p) => p.missionDay < 1);
  if (earth.length >= 2 && !DRIFT_FROM_EARLY_FLIGHT.includes(metricId)) return earth;
  return sorted.filter((p) => p.missionDay >= 1).slice(0, n);
}
/** CUSUM reference value k and decision interval h, in σ units (Source: SRC-064). */
export const CUSUM_K = 0.5;
export const CUSUM_H = 4;

export function robustZ(x: number, median: number, mad: number, madFloor = 1e-6): number {
  return (x - median) / (MAD_TO_SD * Math.max(mad, madFloor));
}

/** Exponentially weighted moving average of z-scores (first value seeds the average). */
export function ewma(z: number[], alpha = EWMA_ALPHA): number[] {
  const out: number[] = [];
  z.forEach((zi, i) => out.push(i === 0 ? zi : alpha * zi + (1 - alpha) * out[i - 1]));
  return out;
}

export type DriftSeverity = 'steady' | 'watch' | 'drifting';
export const severityOf = (ewmaZ: number): DriftSeverity => (Math.abs(ewmaZ) >= 2 ? 'drifting' : Math.abs(ewmaZ) >= 1 ? 'watch' : 'steady');

/**
 * Two one-sided CUSUMs on z-scores. Returns, per index, +1 (upward shift alarm), −1 (downward) or 0.
 * After an alarm the statistic keeps accumulating, so a sustained shift stays flagged.
 */
export function cusum(z: number[], k = CUSUM_K, h = CUSUM_H): { flags: number[]; hi: number[]; lo: number[] } {
  let sHi = 0;
  let sLo = 0;
  const flags: number[] = [];
  const hi: number[] = [];
  const lo: number[] = [];
  for (const zi of z) {
    sHi = Math.max(0, sHi + zi - k);
    sLo = Math.max(0, sLo - zi - k);
    hi.push(sHi);
    lo.push(sLo);
    flags.push(sHi > h ? 1 : sLo > h ? -1 : 0);
  }
  return { flags, hi, lo };
}

/** Index runs [start, end] where `flag(i)` holds for at least `minLen` consecutive items. */
export function runs<T>(items: T[], flag: (item: T, i: number) => boolean, minLen = 1): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let start = -1;
  items.forEach((item, i) => {
    if (flag(item, i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= minLen) out.push({ start, end: i - 1 });
      start = -1;
    }
  });
  if (start >= 0 && items.length - start >= minLen) out.push({ start, end: items.length - 1 });
  return out;
}

/** Merges runs separated by fewer than `gap` items (one episode, not many). */
export function mergeRuns(list: Array<{ start: number; end: number }>, gap: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const r of list) {
    const last = out[out.length - 1];
    if (last && r.start - last.end <= gap) last.end = r.end;
    else out.push({ ...r });
  }
  return out;
}

