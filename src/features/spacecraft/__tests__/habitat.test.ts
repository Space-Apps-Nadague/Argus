import { describe, expect, it } from 'vitest';
import { eventSpeech, parseVoiceIntent, SPACECRAFT_EVENT_IDS, SPACECRAFT_EVENTS, statusSpeech, valueAt } from '../habitat';

describe('spacecraft link', () => {
  it('every event has a reading, at least one automatic action and advice', () => {
    for (const id of SPACECRAFT_EVENT_IDS) {
      const ev = SPACECRAFT_EVENTS[id];
      expect(ev.actions.some((a) => a.tier === 'auto')).toBe(true);
      expect(ev.advice.length).toBeGreaterThan(0);
      expect(ev.reading.value).not.toBe(ev.reading.target);
    }
  });

  it('says what it detected, what it changed, what to do and what it needs confirmed', () => {
    const s = eventSpeech(SPACECRAFT_EVENTS.co2_spike, 'VEGA');
    expect(s).toContain('Cabin CO2 jumped to 7.8 millimeters of mercury in the Lab');
    expect(s).toContain('I set the CO2 scrubber to maximum, turned the Lab fans to high and boosted the air flow between modules.');
    expect(s).toContain('VEGA, please move to Node 1 until CO2 is below 4 millimeters of mercury.');
    expect(eventSpeech(SPACECRAFT_EVENTS.o2_low)).toContain('above 20.5 percent');
    expect(s).toContain('Shall I start the backup lithium hydroxide canister? Say confirm or cancel.');
    expect(eventSpeech(SPACECRAFT_EVENTS.humidity_high)).not.toContain('Shall I');
  });

  it('recovers toward the target after acting', () => {
    const r = SPACECRAFT_EVENTS.co2_spike.reading;
    expect(valueAt(r, 0)).toBe(7.8);
    expect(valueAt(r, r.recoverySec / 2)).toBeLessThan(7.8);
    expect(Math.abs(valueAt(r, r.recoverySec) - r.target)).toBeLessThan((r.value - r.target) * 0.06);
    const o2 = SPACECRAFT_EVENTS.o2_low.reading;
    expect(valueAt(o2, 20)).toBeGreaterThan(o2.value);
  });

  it('understands short voice replies', () => {
    expect(parseVoiceIntent('Confirm')).toBe('confirm');
    expect(parseVoiceIntent('yes do it')).toBe('confirm');
    expect(parseVoiceIntent('no, cancel that')).toBe('cancel');
    expect(parseVoiceIntent('undo')).toBe('undo');
    expect(parseVoiceIntent("what's the status")).toBe('status');
    expect(parseVoiceIntent('banana')).toBeNull();
  });

  it('speaks the live status', () => {
    const ev = SPACECRAFT_EVENTS.co2_spike;
    expect(statusSpeech(ev, 5.2)).toBe('Cabin ppCO2 (Lab) is now 5.2 millimeters of mercury, coming down.');
    expect(statusSpeech(ev, 3.1)).toContain('back in the normal range');
  });
});
