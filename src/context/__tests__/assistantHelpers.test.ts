import { describe, expect, it } from 'vitest';
import { cleanTranscript, isProtocolLive, PROTOCOL_ACTIVE_MS } from '../AssistantContext';
import { wavToFloat32 } from '../../services/speech/deviceSpeech';
import { encodeWav } from '../../services/speech/audio';

describe('assistant helpers', () => {
  const run = (minutesAgo: number, done: number, steps = 3) => ({
    startedAtIso: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    steps: Array.from({ length: steps }, (_, i) => `step ${i + 1}`),
    completed: Object.fromEntries(Array.from({ length: done }, (_, i) => [i + 1, new Date().toISOString()])),
  });

  it('only treats a recent, unfinished protocol as live', () => {
    expect(isProtocolLive(null)).toBe(false);
    expect(isProtocolLive(run(2, 1))).toBe(true);
    expect(isProtocolLive(run(2, 3))).toBe(false);
    expect(isProtocolLive(run(PROTOCOL_ACTIVE_MS / 60_000 + 1, 0))).toBe(false);
  });

  it("drops Whisper's silence artefacts but keeps real speech", () => {
    expect(cleanTranscript('[BLANK_AUDIO]')).toBe('');
    expect(cleanTranscript(' you ')).toBe('');
    expect(cleanTranscript('(wind blowing)')).toBe('');
    expect(cleanTranscript(' Log resting heart rate 68. ')).toBe('Log resting heart rate 68.');
  });

  it('decodes the WAV the microphone produces', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0.25]);
    const back = wavToFloat32(encodeWav(samples, 16000));
    expect(back.length).toBe(4);
    back.forEach((v, i) => expect(v).toBeCloseTo(samples[i], 3));
  });
});
