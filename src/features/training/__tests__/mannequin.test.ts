import { describe, expect, it } from 'vitest';
import { ANKLE_HEIGHT, aredBar, CONTACT_HEIGHT, EXERCISE_MOTIONS, lerpPose, pedalPoints, placeSkeleton, repetitionPhase, SEG, skeletonAt } from '../mannequin';

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

  it('keeps the ARED squat feet planted with the bar on the shoulders', () => {
    const m = EXERCISE_MOTIONS.aredSquat;
    const bottom = skeletonAt(m, m.period / 2);
    expect(bottom.ankleL.y).toBeCloseTo(ANKLE_HEIGHT, 5);
    expect(bottom.pelvis.y).toBeLessThan(0.6);
    expect(Math.abs(aredBar(bottom, 'shoulders').y - bottom.shoulder.y)).toBeLessThan(0.05);
  });

  it('hinges at the hips in an ARED deadlift with the bar below the knees', () => {
    const m = EXERCISE_MOTIONS.aredDeadlift;
    const bottom = skeletonAt(m, m.period / 2);
    expect(bottom.ankleL.y).toBeCloseTo(ANKLE_HEIGHT, 5);
    expect(bottom.handL.y).toBeLessThan(bottom.kneeL.y);
    expect(bottom.neck.y).toBeLessThan(1.2);
  });

  it('lifts the heels with the toes planted in a heel raise', () => {
    const m = EXERCISE_MOTIONS.aredHeelRaise;
    const down = skeletonAt(m, 0);
    const up = skeletonAt(m, m.period / 2);
    expect(up.toeL.y).toBeCloseTo(CONTACT_HEIGHT, 5);
    expect(up.ankleL.y).toBeGreaterThan(down.ankleL.y + 0.06);
  });

  it('alternates the feet on the treadmill with one foot on the belt', () => {
    const m = EXERCISE_MOTIONS.treadmill;
    const a = skeletonAt(m, 0);
    const b = skeletonAt(m, m.period / 2);
    expect(Math.min(a.ankleL.y, a.ankleR.y)).toBeCloseTo(ANKLE_HEIGHT, 5);
    expect(a.ankleL.z).toBeGreaterThan(a.ankleR.z);
    expect(b.ankleL.z).toBeLessThan(b.ankleR.z);
  });

  it('keeps the feet on the pedals and the leg lengths fixed on the cycle ergometer', () => {
    const m = EXERCISE_MOTIONS.cycle;
    const c = m.rig.cycle!;
    for (const t of [0, 0.3, 0.55, 0.8]) {
      const s = skeletonAt(m, t);
      const angle = ((t % m.period) / m.period) * Math.PI * 2;
      const { left } = pedalPoints(c.crank, c.radius, angle);
      expect(Math.hypot(s.ankleL.y - left.y, s.ankleL.z - left.z)).toBeLessThan(0.06);
      expect(Math.hypot(s.kneeL.y - s.pelvis.y, s.kneeL.z - s.pelvis.z)).toBeCloseTo(SEG.thigh, 3);
      expect(Math.hypot(s.ankleL.y - s.kneeL.y, s.ankleL.z - s.kneeL.z)).toBeCloseTo(SEG.shin, 3);
      expect(s.handL).toEqual(c.handlebar);
    }
  });

  it('cycles the repetition phase between 0 and 1', () => {
    expect(repetitionPhase(0, 3)).toBe(0);
    expect(repetitionPhase(1.5, 3)).toBe(1);
    expect(repetitionPhase(3, 3)).toBe(0);
  });
});
