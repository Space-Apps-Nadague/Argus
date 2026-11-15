import { describe, expect, it } from 'vitest';
import { decideCare, earthPacketNote } from '../routing';
import type { CognitionEvaluation } from '../types';

const ev = (status: CognitionEvaluation['status'], z = -2.5): CognitionEvaluation => ({ status, declineZ: z, baselineMedian: 50, baselineN: 5 });
const base = { gameId: 'dsst' as const, recentStatuses: [] as Array<'green' | 'yellow' | 'red' | 'calibrating'>, neuroZone: 'green' as const, behavioralZone: 'green' as const };

describe('cognition care routing', () => {
  it('does nothing for green or calibrating', () => {
    expect(decideCare({ ...base, evaluation: ev('green', 0) }).route).toBe('none');
    expect(decideCare({ ...base, evaluation: ev('calibrating') }).route).toBe('none');
  });

  it('keeps a single moderate decline on board', () => {
    const d = decideCare({ ...base, evaluation: ev('yellow') });
    expect(d.route).toBe('onboard');
    expect(d.notifyEarth).toBe(false);
    expect(d.onboardSteps.length).toBeGreaterThan(0);
  });

  it('alerts Earth for a severe decline', () => {
    const d = decideCare({ ...base, evaluation: ev('red', -4) });
    expect(d.route).toBe('earth');
    expect(d.notifyEarth).toBe(true);
  });

  it('alerts Earth when a decline repeats', () => {
    expect(decideCare({ ...base, recentStatuses: ['yellow'], evaluation: ev('yellow') }).route).toBe('earth');
  });

  it('alerts Earth and opens the medical protocol when the neuro zone is red', () => {
    const d = decideCare({ ...base, neuroZone: 'red', evaluation: ev('yellow') });
    expect(d.route).toBe('earth');
    expect(d.openMedicalProtocol).toBe(true);
  });

  it('writes a packet note with the decline size', () => {
    const input = { ...base, evaluation: ev('red', -4.2) };
    expect(earthPacketNote(input, decideCare(input))).toContain('-4.2σ');
  });
});
