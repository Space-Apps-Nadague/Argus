/**
 * ARGOS — The Thousand Eyes: the science (pure functions, no UI).
 * Ported from ARGOS_The_Thousand_Eyes.html: bz, phase, ser, base, stat, pdi, reds, ready0, dayVals, lagp, reg, links.
 *
 * ARGOS never compares a person to a population. Every reading is compared with that person's own
 * pre-flight baseline, after subtracting the adaptation expected at their location.
 */

import { INDICATORS, INDICATOR_BY_KEY } from './indicators';
import { expectedShift } from './locationShift';
import type {
  Baseline,
  CheckIn,
  Indicator,
  IndicatorStatus,
  Link,
  LocationKey,
  Person,
  Phase,
  Status,
} from './types';

export const DAY = 86_400_000;

export const avg = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
/** Sample standard deviation (n-1). */
export function sdv(a: number[]): number {
  if (a.length < 2) return NaN;
  const m = avg(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
/** Format a number, "–" when not finite. */
export const fmt = (x: number | undefined | null, d = 1): string =>
  x != null && Number.isFinite(x) ? (+x).toFixed(d) : '–';

/** "Badness" in sigma units, depending on which direction is worse. */
export function badness(ind: Indicator, z: number): number {
  return ind.dir === 'h' ? z : ind.dir === 'l' ? -z : Math.abs(z);
}

export function phaseAt(p: Person, t: number): Phase {
  if (p.ret && t >= p.ret) return 'rec';
  if (p.launch && t >= p.launch) return 'mis';
  return 'pre';
}

function phaseStart(p: Person, ph: Phase): number {
  return ph === 'rec' ? p.ret ?? p.created : ph === 'mis' ? p.launch ?? p.created : p.created;
}

/** Day number within the current phase (1-based). */
export function dayOfPhase(p: Person, t: number): number {
  return Math.floor((t - phaseStart(p, phaseAt(p, t))) / DAY) + 1;
}

interface SeriesPoint {
  t: number;
  v: number;
  env: LocationKey;
}

/** Time series of one indicator, optionally filtered by phase. */
export function series(p: Person, key: string, phases?: Phase[]): SeriesPoint[] {
  return p.checkIns
    .filter((e) => e.values[key] != null && (!phases || phases.includes(e.phase)))
    .map((e) => ({ t: e.t, v: e.values[key] as number, env: e.env ?? p.env }));
}

/** Personal baseline. Mission-only indicators use earlier in-mission values. */
export function baseline(p: Person, key: string, now: number): Baseline | null {
  const ind = INDICATOR_BY_KEY[key];
  if (!ind) return null;
  if (ind.flag === 'X') {
    const a = series(p, key, ['mis'])
      .slice(0, -1)
      .map((x) => x.v);
    return a.length >= 3 && phaseAt(p, now) === 'mis'
      ? { mean: avg(a), sd: Math.max(sdv(a), ind.sd), n: a.length, provisional: false }
      : null;
  }
  let a = series(p, key, ['pre']);
  let provisional = false;
  if (!a.length) {
    a = series(p, key, ['mis']).slice(0, 3);
    provisional = true;
  }
  if (!a.length) return null;
  const v = a.map((x) => x.v);
  return {
    mean: avg(v),
    sd: v.length >= 3 ? Math.max(sdv(v), ind.sd * 0.5) : ind.sd,
    n: v.length,
    provisional,
  };
}

/** Status of one indicator: 0 on baseline, 1 drifting, 2 red flag. */
export function indicatorStatus(p: Person, key: string, now: number): IndicatorStatus {
  const ind = INDICATOR_BY_KEY[key];
  const b = baseline(p, key, now);
  const ph = phaseAt(p, now);
  let a = series(p, key, [ph]);
  if (!a.length) a = series(p, key).slice(-1);
  if (!a.length || !b) return { key, indicator: ind, n: 0, expectedShift: 0, badness: 0, red: false };

  const z = a.map((x) => (x.v - b.mean - expectedShift(x.env, key)) / b.sd);
  let e = 0;
  const smoothed = z.map((q, i) => (e = i ? 0.3 * q + 0.7 * e : q));
  const cur = a[a.length - 1].v;
  const zc = z[z.length - 1];
  const ec = smoothed[smoothed.length - 1];
  const bad = badness(ind, ec);
  const red = (ind.redLow != null && cur < ind.redLow) || (ind.redHigh != null && cur > ind.redHigh);
  let status: Status = red ? 2 : (bad > 1.13 && a.length >= 2) || badness(ind, zc) >= 2.5 ? 1 : 0;
  if (ph === 'pre' && !red) status = 0; // before flight, only red flags show

  return {
    key,
    indicator: ind,
    n: a.length,
    baseline: b,
    expectedShift: expectedShift(a[a.length - 1].env, key),
    current: cur,
    z: zc,
    ewma: ec,
    badness: Math.max(0, bad),
    red,
    status,
  };
}

/** Status of every indicator that has data. */
export function allStatuses(p: Person, now: number): IndicatorStatus[] {
  return INDICATORS.map((i) => indicatorStatus(p, i.key, now)).filter((s) => s.n > 0);
}

/** Personal deviation index (RMS badness of baseline indicators), in sigma. */
export function deviationIndex(statuses: IndicatorStatus[]): number {
  const a = statuses.filter((s) => !s.indicator.flag);
  return a.length ? Math.sqrt(avg(a.map((s) => s.badness ** 2))) : NaN;
}

export const redFlagCount = (statuses: IndicatorStatus[]): number => statuses.filter((s) => s.red).length;

/** Personal readiness 0–100. */
export function readiness(statuses: IndicatorStatus[]): number | null {
  const p = deviationIndex(statuses);
  return Number.isFinite(p) ? Math.round(clamp(100 - 22 * p - 15 * redFlagCount(statuses), 0, 100)) : null;
}

// ── Hidden links ──────────────────────────────────────────────────────────

type DayValues = Record<number, Partial<Record<string, number>>>;

export function dayValues(checkIns: CheckIn[]): DayValues {
  const g: DayValues = {};
  checkIns.forEach((e) => {
    const k = Math.floor(e.t / DAY);
    g[k] = Object.assign(g[k] || {}, e.values);
  });
  return g;
}

function laggedPairs(g: DayValues, a: string, b: string, lag: 0 | 1): [number[], number[]] {
  const x: number[] = [];
  const y: number[] = [];
  Object.keys(g)
    .map(Number)
    .forEach((k) => {
      const u = g[k][a];
      const v = g[k + lag]?.[b];
      if (u != null && v != null) {
        x.push(u);
        y.push(v);
      }
    });
  return [x, y];
}

export function regression(x: number[], y: number[], minN: number): { r: number; slope: number; n: number } | null {
  const n = x.length;
  if (n < minN) return null;
  const mx = avg(x);
  const my = avg(y);
  let a = 0;
  let b = 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    a += (x[i] - mx) * (y[i] - my);
    b += (x[i] - mx) ** 2;
    c += (y[i] - my) ** 2;
  }
  return b && c ? { r: a / Math.sqrt(b * c), slope: a / b, n } : null;
}

/** Statistically found links (|r| >= 0.6, n >= 7), strongest 8. */
export function findLinks(p: Person): Link[] {
  const g = dayValues(p.checkIns);
  const keys = INDICATORS.filter((i) => i.flag !== 'X').map((i) => i.key);
  const out: Link[] = [];
  keys.forEach((a) =>
    keys.forEach((b) => {
      if (a === b) return;
      ([0, 1] as const).forEach((lag) => {
        if (lag === 0 && a > b) return;
        const [x, y] = laggedPairs(g, a, b, lag);
        const r = regression(x, y, 7);
        if (r && Math.abs(r.r) >= 0.6) out.push({ a, b, lagDays: lag, r: r.r, n: r.n });
      });
    })
  );
  return out.sort((p1, q) => Math.abs(q.r) - Math.abs(p1.r)).slice(0, 8);
}

export function linkText(l: Link): string {
  const A = INDICATOR_BY_KEY[l.a].label;
  const B = INDICATOR_BY_KEY[l.b].label;
  return `${A} ${l.lagDays ? '→ next-day' : '↔ same-day'} ${B}: r=${fmt(l.r, 2)}, n=${l.n}`;
}

/** One-line advice to bring an abnormal indicator back. */
export function adviceFor(s: IndicatorStatus): string | null {
  if (!s.status || !s.indicator.tip || s.z == null) return null;
  const above = s.z > 0;
  return (above ? s.indicator.tip.above : s.indicator.tip.below) || null;
}
