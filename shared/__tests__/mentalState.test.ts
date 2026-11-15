import { describe, expect, it } from 'vitest';
import type { VisualObservation } from '../../src/types/assistant';
import { pickCountermeasure } from '../countermeasures';
import { combineAssessment, extractCuesFromText, mergeCues, reportTimingFor, shouldAutoReport, urgencyForConcern } from '../mentalState';

const tired: VisualObservation = {
  capturedAtIso: '2026-11-15T10:00:00Z', windowSec: 30, facePresent: true, presenceRatio: 1, blinkRatePerMin: 28, perclos: 0.22,
  yawnsPerMin: 2, affect: 'flat', emotion: null, fatigue: 'high', posture: 'slumped', restlessness: 'low', pulseBpmEstimate: null, pulseConfidence: null, notes: [],
};

describe('mental state', () => {
  it('finds nothing in neutral talk', () => {
    const a = combineAssessment({ userMessages: ['How is my heart rate today?', 'Thanks, feeling good'] });
    expect(a.concernLevel).toBe('none');
    expect(a.mood).toBe('good');
  });

  it('reads cues from what the crew member says, and respects negation', () => {
    const r = extractCuesFromText(["I'm so stressed and I can't sleep", 'I miss my family']);
    expect(r.cues.stress).toBe(2);
    expect(r.cues.sleepProblem).toBe(2);
    expect(r.cues.isolation).toBe(2);
    expect(extractCuesFromText(["I'm not stressed at all"]).cues.stress).toBe(0);
  });

  it('lets older messages fade', () => {
    const r = extractCuesFromText(['I feel hopeless', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(r.cues.hopelessness).toBeLessThan(3);
  });

  it('raises to concern on hopelessness and to urgent on crisis language', () => {
    expect(combineAssessment({ userMessages: ['honestly it all feels hopeless and I feel so sad'] }).concernLevel).toBe('concern');
    const urgent = combineAssessment({ userMessages: ['I want to die'] });
    expect(urgent.concernLevel).toBe('urgent');
    expect(urgent.score).toBe(100);
  });

  it('a model can raise cues but never lower them', () => {
    const base = combineAssessment({ userMessages: ["I'm overwhelmed and depressed"] });
    const lowered = combineAssessment({ userMessages: ["I'm overwhelmed and depressed"], modelCues: { stress: 0, lowMood: 0 }, modelSummary: 'They are fine.' });
    expect(lowered.cues.stress).toBe(base.cues.stress);
    expect(lowered.concernLevel).toBe(base.concernLevel);
    const raised = combineAssessment({ userMessages: ['fine I guess'], modelCues: { lowMood: 3, isolation: 2 } });
    expect(raised.cues.lowMood).toBe(3);
    expect(raised.concernLevel).toBe('concern');
    expect(mergeCues({ stress: 1 }, { stress: 3 }, { stress: 2 }).stress).toBe(3);
  });

  it('a model summary cannot replace the crisis summary', () => {
    const a = combineAssessment({ userMessages: ['I want to kill myself'], modelSummary: 'Doing well.' });
    expect(a.summary).toMatch(/crisis/i);
  });

  it('uses the camera for fatigue, capped below "strong"', () => {
    const a = combineAssessment({ userMessages: ['all good'], observation: tired });
    expect(a.cues.fatigue).toBe(2);
    expect(a.fatigue).toBe('high');
    expect(a.evidence.some((e) => e.source === 'camera')).toBe(true);
    expect(a.concernLevel).not.toBe('concern');
  });

  it('takes floors from the self-report model', () => {
    expect(combineAssessment({ userMessages: ['hi'], selfReport: { riskScore: 70, status: 'red', trend: 'worsening' } }).concernLevel).toBe('concern');
    expect(combineAssessment({ userMessages: ['hi'], selfReport: { riskScore: 40, status: 'yellow', trend: 'stable' } }).concernLevel).toBe('watch');
  });

  it('reports the trend against the previous assessment', () => {
    const before = combineAssessment({ userMessages: ['all good'] });
    const after = combineAssessment({ userMessages: ["I'm overwhelmed, lonely and can't sleep"], previous: before });
    expect(after.trend).toBe('worsening');
  });

  it('applies the Earth reporting rules', () => {
    expect(reportTimingFor('urgent')).toBe('immediate');
    expect(reportTimingFor('concern')).toBe('auto');
    expect(reportTimingFor('watch')).toBe('digest');
    expect(urgencyForConcern('urgent')).toBe('immediate_emergency_packet');
    expect(shouldAutoReport('concern', null)).toBe(true);
    expect(shouldAutoReport('concern', 'concern')).toBe(false);
    expect(shouldAutoReport('urgent', 'concern')).toBe(true);
    expect(shouldAutoReport('watch', null)).toBe(false);
  });

  it('picks a countermeasure for the strongest cue and does not repeat', () => {
    const a = combineAssessment({ userMessages: ["I'm panicking"] });
    const first = pickCountermeasure(a.cues);
    expect(first?.id).toBe('box_breathing');
    expect(pickCountermeasure(a.cues, ['box_breathing'])?.id).toBe('grounding');
  });
});
