import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import { sameGlyph } from '../Glyph';
import { makeAmTrial } from '../games/AbstractMatching';
import { makeMrTrial } from '../games/MatrixReasoning';
import { lineAngleError } from '../games/LineOrientation';

describe('game generators', () => {
  it('abstract matching target always shares a rule with exactly its answer pair', () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 200; i++) {
      const t = makeAmTrial(rand);
      expect(['left', 'right']).toContain(t.answer);
    }
  });

  it('matrix reasoning has 4 distinct options including the answer', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const t = makeMrTrial(rand);
      expect(t.options).toHaveLength(4);
      expect(sameGlyph(t.options[t.answerIdx], t.cells[8])).toBe(true);
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) expect(sameGlyph(t.options[a], t.options[b])).toBe(false);
    }
  });

  it('line angle error treats lines as undirected', () => {
    expect(lineAngleError(10, 190)).toBe(0);
    expect(lineAngleError(0, 90)).toBe(90);
    expect(lineAngleError(5, 175)).toBe(10);
  });
});
