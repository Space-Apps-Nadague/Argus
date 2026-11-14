/**
 * ARGUS — Statistics primitives shared by the HUD and the server (specs/05-data-platform.md §5).
 * Thin wrappers over `simple-statistics` that tolerate empty input.
 */

import { mean as ssMean, median as ssMedian, quantileSorted, sampleStandardDeviation } from 'simple-statistics';

export const mean = (a: number[]): number => (a.length ? ssMean(a) : NaN);
export const sampleSd = (a: number[]): number => (a.length >= 2 ? sampleStandardDeviation(a) : 0);
export const median = (a: number[]): number => (a.length ? ssMedian(a) : NaN);

/** Unscaled median absolute deviation. */
export function mad(a: number[], med = median(a)): number {
  return a.length ? ssMedian(a.map((x) => Math.abs(x - med))) : NaN;
}

export function quantile(a: number[], p: number): number {
  if (!a.length) return NaN;
  return quantileSorted([...a].sort((x, y) => x - y), p);
}

/** Ordinary least squares slope & intercept; null with < 3 points or no x variance. */
export function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  if (xs.length < 3) return null;
  const xm = mean(xs);
  const ym = mean(ys);
  let sxx = 0;
  let sxy = 0;
  xs.forEach((x, i) => {
    sxx += (x - xm) ** 2;
    sxy += (x - xm) * (ys[i] - ym);
  });
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: ym - slope * xm };
}

export interface Summary {
  n: number;
  mean: number;
  sd: number;
  median: number;
  mad: number;
  p05: number;
  p95: number;
}

export function summarize(values: number[]): Summary {
  const med = median(values);
  return {
    n: values.length,
    mean: mean(values),
    sd: sampleSd(values),
    median: med,
    mad: mad(values, med),
    p05: quantile(values, 0.05),
    p95: quantile(values, 0.95),
  };
}
