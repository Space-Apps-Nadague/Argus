/**
 * ARGUS — shared deterministic 30-day series builder (kept import-free so scenario modules can share it).
 */

import type { TelemetryHistoryPoint } from '../types/argus';

/**
 * Deterministic helper to generate a 30-day longitudinal series with smooth progression
 * and realistic physiological micro-variability.
 */
export function build30DaySeries(
  startVal: number,
  endVal: number,
  precision: number = 1,
  waveAmp: number = 0.08,
  lateSpikeStartDay: number = 18
): TelemetryHistoryPoint[] {
  const points: TelemetryHistoryPoint[] = [];
  for (let day = 1; day <= 30; day++) {
    let t = (day - 1) / 29;
    // Allow steeper drift after day 18 for crisis scenarios
    if (Math.abs(endVal - startVal) > 0.5 && day >= lateSpikeStartDay) {
      const lateT = (day - lateSpikeStartDay) / (30 - lateSpikeStartDay);
      t = 0.35 + 0.65 * Math.pow(lateT, 1.25);
    } else if (Math.abs(endVal - startVal) > 0.5) {
      t = 0.35 * ((day - 1) / Math.max(1, lateSpikeStartDay - 1));
    }
    const wave = Math.sin(day * 1.15) * waveAmp + Math.cos(day * 0.6) * (waveAmp * 0.5);
    const raw = day === 30 ? endVal : startVal + (endVal - startVal) * t + wave;
    const factor = Math.pow(10, precision);
    points.push({
      missionDay: day,
      dateLabel: `MD-${day}`,
      value: Math.round(raw * factor) / factor,
    });
  }
  return points;
}
