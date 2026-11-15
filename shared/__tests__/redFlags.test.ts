import { describe, expect, it } from 'vitest';
import { detectCrisisLanguage, detectRedFlags } from '../redFlags';

describe('detectRedFlags', () => {
  it('flags acute medical danger and points at the medical protocol', () => {
    for (const text of ['I have crushing chest pain', "I can't breathe", 'she passed out', 'my speech is slurred', 'כאב חזק בחזה', 'קשה לי לנשום']) {
      const r = detectRedFlags(text);
      expect(r.medical, text).toBe(true);
      expect(r.protocolId, text).toBe('medical');
    }
  });

  it('flags crisis language in English and Hebrew', () => {
    for (const text of ['I want to die', 'thinking about killing myself', 'אני רוצה למות', 'להתאבד']) {
      const r = detectRedFlags(text);
      expect(r.crisis, text).toBe(true);
      expect(r.flagged).toBe(true);
      expect(detectCrisisLanguage(text).crisis).toBe(true);
    }
  });

  it('maps habitat emergencies to their protocol', () => {
    expect(detectRedFlags('there is smoke in node 2').protocolId).toBe('fire');
    expect(detectRedFlags('cabin pressure is dropping fast').protocolId).toBe('depress');
    expect(detectRedFlags('I smell ammonia').protocolId).toBe('toxic');
    expect(detectRedFlags('solar storm warning just came in').protocolId).toBe('radiation');
    expect(detectRedFlags('the CO2 alarm is going off').protocolId).toBe('co2');
  });

  it('does not flag ordinary talk', () => {
    for (const text of ['I slept badly and feel stressed', 'how is my heart rate?', 'we ran the fire drill today', 'my radiation dose looks fine', 'log resting heart rate 68']) {
      expect(detectRedFlags(text).flagged, text).toBe(false);
    }
  });
});
