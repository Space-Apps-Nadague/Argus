import { describe, expect, it } from 'vitest';
import { extractJson } from '../ai/json';
import { ThinkFilter } from '../ai/llm';
import { GuidanceLlmSchema } from '../schemas';

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('handles markdown fences and surrounding prose', () => {
    expect(extractJson('Sure! Here it is:\n```json\n{"a": [1, 2]}\n```\nHope that helps.')).toEqual({ a: [1, 2] });
  });

  it('strips <think> reasoning blocks from local thinking models', () => {
    expect(extractJson('<think>the user wants {"x":0}…</think>\n{"ok": true}')).toEqual({ ok: true });
  });

  it('throws when there is no JSON object', () => {
    expect(() => extractJson('I cannot help with that.')).toThrow(SyntaxError);
  });
});

describe('LLM output validation', () => {
  it('coerces numeric strings and fills defaults from weaker models', () => {
    const parsed = GuidanceLlmSchema.safeParse({
      headline: 'h',
      hazardContextSummary: 's',
      plainLanguageExplanation: 'e',
      earthConsultUrgency: 'priority_packet',
      guidedSteps: [{ title: 't', plainInstruction: 'p', estimatedMinutes: '10' }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.guidedSteps[0]).toMatchObject({ estimatedMinutes: 10, hardwareRequired: 'None' });
    }
  });

  it('rejects an invented urgency level', () => {
    const parsed = GuidanceLlmSchema.safeParse({
      headline: 'h',
      hazardContextSummary: 's',
      plainLanguageExplanation: 'e',
      earthConsultUrgency: 'whenever',
      guidedSteps: [{ title: 't', plainInstruction: 'p' }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('ThinkFilter', () => {
  it('removes think spans split across stream chunks', () => {
    const f = new ThinkFilter();
    const out = ['Hel', 'lo <thi', 'nk>secret plan</th', 'ink> world', '!'].map((c) => f.push(c)).join('') + f.flush();
    expect(out).toBe('Hello  world!');
  });

  it('passes through text with a stray "<" that is not a think tag', () => {
    const f = new ThinkFilter();
    const out = ['SpO2 <', ' 92% is a red flag'].map((c) => f.push(c)).join('') + f.flush();
    expect(out).toBe('SpO2 < 92% is a red flag');
  });
});
