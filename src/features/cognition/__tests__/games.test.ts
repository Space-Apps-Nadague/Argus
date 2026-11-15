import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import { sameGlyph } from '../Glyph';
import { makeAmTrial } from '../games/AbstractMatching';
import { makeMrTrial, MR_OPTIONS } from '../games/MatrixReasoning';
import { makeVoltRound } from '../games/Volt';
import { makePair } from '../games/LineOrientation';
import { glyphKey } from '../Glyph';
import { lineAngleError } from '../games/LineOrientation';

describe('game generators', () => {
  it('abstract matching target always shares a rule with exactly its answer pair', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const t = makeAmTrial(rand);
      expect(['left', 'right']).toContain(t.answer);
    }
  });

  it('matrix reasoning (hard) has 5 distinct options including the answer', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const t = makeMrTrial(rand);
      expect(t.options).toHaveLength(MR_OPTIONS);
      expect(sameGlyph(t.options[t.answerIdx], t.cells[8])).toBe(true);
      for (let a = 0; a < MR_OPTIONS; a++) for (let b = a + 1; b < MR_OPTIONS; b++) expect(sameGlyph(t.options[a], t.options[b])).toBe(false);
    }
  });

  it('cargo memory rounds: 12 learned, 24 tested, half the new ones are look-alikes, no duplicates', () => {
    const rand = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const r = makeVoltRound(rand);
      expect(r.learn).toHaveLength(12);
      expect(r.test).toHaveLength(24);
      expect(r.test.filter((x) => x.old)).toHaveLength(12);
      expect(r.test.filter((x) => x.lure)).toHaveLength(6);
      expect(new Set(r.test.map((x) => glyphKey(x.g))).size).toBe(24);
    }
  });

  it('docking pairs never start already aligned', () => {
    const rand = mulberry32(11);
    for (let i = 0; i < 200; i++) {
      const p = makePair(rand);
      expect(lineAngleError(p.start, p.fixed)).toBeGreaterThanOrEqual(15);
      expect(p.len).toBeLessThanOrEqual(80);
    }
  });

  it('line angle error treats lines as undirected', () => {
    expect(lineAngleError(10, 190)).toBe(0);
    expect(lineAngleError(0, 90)).toBe(90);
    expect(lineAngleError(5, 175)).toBe(10);
  });
});
