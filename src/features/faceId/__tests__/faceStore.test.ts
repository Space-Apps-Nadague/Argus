import { describe, expect, it } from 'vitest';
import { averageDescriptors, detectBlink, eyeAspectRatio, faceDistance, FaceEnrollment, matchFace, upsertEnrollment } from '../faceStore';

const vec = (v: number) => new Array(128).fill(v);
const enrol = (userId: string, v: number): FaceEnrollment => ({ userId, username: userId, descriptor: vec(v), createdAtIso: '2026-11-15T00:00:00Z' });

describe('faceStore', () => {
  it('measures descriptor distance', () => {
    expect(faceDistance([0, 0], [3, 4])).toBe(5);
    expect(faceDistance([1], [1, 2])).toBe(Infinity);
  });

  it('matches the closest enrolled face under the threshold only', () => {
    const list = [enrol('a', 0), enrol('b', 0.02)];
    expect(matchFace(vec(0.019), list)?.enrollment.userId).toBe('b');
    expect(matchFace(vec(0.5), list)).toBeNull();
  });

  it('averages captures into one template', () => {
    expect(averageDescriptors([[0, 2], [2, 4]])).toEqual([1, 3]);
  });

  it('computes the eye aspect ratio and detects a blink', () => {
    const open = [{ x: 0, y: 0 }, { x: 1, y: -0.3 }, { x: 2, y: -0.3 }, { x: 3, y: 0 }, { x: 2, y: 0.3 }, { x: 1, y: 0.3 }];
    expect(eyeAspectRatio(open)).toBeCloseTo(0.2, 5);
    expect(detectBlink([0.3, 0.31, 0.15, 0.3])).toBe(true);
    expect(detectBlink([0.3, 0.31, 0.3, 0.29])).toBe(false);
    expect(detectBlink([0.15, 0.3])).toBe(false);
  });

  it('keeps one enrollment per user', () => {
    const list = upsertEnrollment([enrol('a', 0), enrol('b', 1)], enrol('a', 2));
    expect(list.map((e) => [e.userId, e.descriptor[0]])).toEqual([['b', 1], ['a', 2]]);
  });
});
