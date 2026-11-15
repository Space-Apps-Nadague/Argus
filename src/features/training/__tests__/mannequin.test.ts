import { describe, expect, it } from 'vitest';
import { ANKLE_HEIGHT, CONTACT_HEIGHT, EXERCISE_MOTIONS, lerpPose, placeSkeleton, repetitionPhase } from '../mannequin';

const at = (id: string, t: number) => {
  const m = EXERCISE_MOTIONS[id];
  return placeSkeleton(lerpPose(m.from, m.to, t), m.rig);
};

describe('training mannequin', () => {
  it('keeps the feet planted and lowers the hips in a squat', () => {
    const top = at('squats', 0);
    const bottom = at('squats', 1);
    for (const s of [top, bottom]) {
      expect(s.ankleL.y).toBeCloseTo(ANKLE_HEIGHT, 5);
      expect(s.ankleL.z).toBeCloseTo(0, 5);
    }
    expect(top.pelvis.y).toBeGreaterThan(0.9);
    expect(bottom.pelvis.y).toBeLessThan(0.6);
    expect(bottom.kneeL.y).toBeCloseTo(bottom.pelvis.y, 1); // thighs parallel to the floor
  });

  it('keeps hands and toes on the floor during a push-up without the hands sliding', () => {
    const top = at('pushups', 0);
    const bottom = at('pushups', 1);
    for (const s of [top, bottom, at('pushups', 0.5)]) {
      expect(s.handL.y).toBeCloseTo(CONTACT_HEIGHT, 5);
      expect(s.toeL.y).toBeCloseTo(CONTACT_HEIGHT, 5);
      expect(s.handL.z).toBeCloseTo(top.handL.z, 5);
    }
    expect(top.shoulder.y - top.handL.y).toBeGreaterThan(0.5); // arms straight at the top
    expect(bottom.shoulder.y).toBeLessThan(0.35); // chest close to the floor
    expect(bottom.pelvis.y).toBeGreaterThan(0.1);
  });

  it('rests the forearms and toes on the floor in a plank', () => {
    const s = at('plank', 0);
    expect(s.elbowL.y).toBeCloseTo(0.05, 2);
    expect(s.toeL.y).toBeCloseTo(CONTACT_HEIGHT, 5);
    expect(Math.abs(s.shoulder.z - s.elbowL.z)).toBeLessThan(0.05); // elbows under the shoulders
  });

  it('curls the upper body off the floor in a crunch', () => {
    const down = at('crunches', 0);
    const up = at('crunches', 1);
    expect(down.pelvis.y).toBeCloseTo(0.12, 5);
    expect(up.head.y).toBeGreaterThan(down.head.y + 0.2);
    expect(down.ankleL.y).toBeLessThan(0.2);
  });

  it('drops the back knee near the floor in a lunge', () => {
    const s = at('lunges', 1);
    expect(s.ankleL.y).toBeCloseTo(ANKLE_HEIGHT, 5);
    expect(s.kneeR.y).toBeLessThan(0.2);
    expect(s.toeR.y).toBeGreaterThan(-0.02);
  });

  it('cycles the repetition phase between 0 and 1', () => {
    expect(repetitionPhase(0, 3)).toBe(0);
    expect(repetitionPhase(1.5, 3)).toBe(1);
    expect(repetitionPhase(3, 3)).toBe(0);
  });
});
