import { describe, expect, it } from 'vitest';
import { downsample, encodeWav, float32ToPcm16, pcm16ToFloat32, pcmRateFromMime, rms } from '../audio';
import { LiveSession } from '../liveSession';
import { cleanForSpeech, SentenceChunker } from '../sentenceChunker';
import { SpeechOutput, pickBrowserVoice, type SynthResult } from '../speechOutput';
import { Vad } from '../vad';

describe('SentenceChunker', () => {
  it('releases the first sentence early and merges short fragments later', () => {
    const c = new SentenceChunker();
    expect(c.push('Okay Elena, I hear ')).toEqual([]);
    expect(c.push('you. That sounds ')).toEqual(['Okay Elena, I hear you.']);
    expect(c.push('hard. Really. ')).toEqual([]); // too short to be worth a call yet
    const next = c.push('Tell me more about what happened during the EVA prep this morning. And ');
    expect(next).toEqual(['That sounds hard. Really. Tell me more about what happened during the EVA prep this morning.']);
    expect(c.flush()).toEqual(['And']);
  });

  it('does not split on decimals or abbreviations', () => {
    const c = new SentenceChunker(10, 10);
    const out = [...c.push('Your temperature is 38. 2 is not right, it is 38.2 degrees per Dr. Chen today. Next '), ...c.flush()];
    expect(out[0]).toContain('Dr. Chen today.');
    expect(out.join(' ')).toContain('38.2 degrees');
  });

  it('breaks very long runs without punctuation', () => {
    const c = new SentenceChunker();
    const out = c.push('word '.repeat(120));
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].length).toBeLessThanOrEqual(320);
  });

  it('strips markdown before speaking', () => {
    expect(cleanForSpeech('**Rest** now.\n- drink `water`\n# Plan')).toBe('Rest now. drink water Plan');
  });
});

describe('audio helpers', () => {
  it('round-trips PCM16', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 0.99, -1]);
    const back = pcm16ToFloat32(float32ToPcm16(samples));
    back.forEach((v, i) => expect(v).toBeCloseTo(samples[i], 3));
  });

  it('downsamples 48 kHz to 16 kHz', () => {
    const out = downsample(new Float32Array(4800).fill(0.25), 48000, 16000);
    expect(out.length).toBe(1600);
    expect(out[10]).toBeCloseTo(0.25, 5);
  });

  it('writes a valid WAV header', () => {
    const wav = encodeWav(new Float32Array(160), 16000);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16000);
    expect(wav.length).toBe(44 + 320);
  });

  it('reads the sample rate from a mime type', () => {
    expect(pcmRateFromMime('audio/pcm;rate=24000')).toBe(24000);
    expect(pcmRateFromMime('audio/l16; rate=16000')).toBe(16000);
    expect(pcmRateFromMime(undefined)).toBe(24000);
    expect(rms(new Float32Array([1, -1]))).toBe(1);
  });
});

describe('Vad', () => {
  const run = (vad: Vad, level: number, ms: number) => {
    const events: string[] = [];
    for (let t = 0; t < ms; t += 30) {
      const e = vad.push(level, 30);
      if (e !== 'none') events.push(e);
    }
    return events;
  };

  it('starts on speech and ends after a pause', () => {
    const vad = new Vad();
    expect(run(vad, 0.003, 600)).toEqual([]);
    expect(run(vad, 0.08, 600)).toEqual(['start']);
    expect(run(vad, 0.003, 600)).toEqual([]); // pause shorter than endMs
    expect(run(vad, 0.08, 300)).toEqual([]);
    expect(run(vad, 0.003, 1000)).toEqual(['end']);
  });

  it('adapts to steady cabin noise', () => {
    const vad = new Vad();
    expect(run(vad, 0.02, 3000).filter((e) => e === 'end').length).toBeLessThanOrEqual(1);
    run(vad, 0.02, 4000);
    expect(vad.threshold).toBeGreaterThan(0.04);
    expect(run(vad, 0.02, 1000)).toEqual([]);
    expect(run(vad, 0.2, 300)).toEqual(['start']);
  });

  it('discards blips', () => {
    const vad = new Vad({ ratio: 3, minLevel: 0.012, startMs: 60, endMs: 300, minTurnMs: 400, maxTurnMs: 45_000 });
    expect(run(vad, 0.1, 90)).toEqual(['start']);
    expect(run(vad, 0.001, 400)).toEqual(['discard']);
  });
});

describe('SpeechOutput', () => {
  function harness(synth: (text: string) => Promise<SynthResult>) {
    const played: string[] = [];
    const browser: string[] = [];
    const player = {
      playing: false,
      onIdle: null as null | (() => void),
      onStart: null as null | (() => void),
      enqueueEncoded: async (b64: string) => {
        played.push(b64);
        return true;
      },
      stop: () => played.push('STOP'),
    };
    const speaking: boolean[] = [];
    const out = new SpeechOutput({
      synthesize: (text) => synth(text),
      player: player as never,
      browserSpeak: async (text) => void browser.push(text),
      browserCancel: () => {},
      onSpeakingChange: (s) => speaking.push(s),
    });
    return { out, played, browser, speaking };
  }
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it('plays sentences in order even when synthesis finishes out of order', async () => {
    const h = harness(async (text) => {
      await new Promise((r) => setTimeout(r, text.startsWith('First') ? 15 : 1));
      return { audioBase64: text.slice(0, 5), mimeType: 'audio/wav', useBrowserSpeechFallback: false };
    });
    h.out.begin();
    h.out.push('First sentence is here now. ');
    h.out.push('Second sentence follows right after the first one, long enough to be its own chunk. ');
    h.out.end();
    await settle();
    await settle();
    expect(h.played.filter((p) => p !== 'STOP')).toEqual(['First', 'Secon']);
  });

  it('falls back to the browser voice for the rest of the reply', async () => {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      return { audioBase64: '', mimeType: 'audio/wav', useBrowserSpeechFallback: true };
    });
    h.out.say('No server voice is available right now. So the browser speaks this whole answer instead, start to finish.');
    await settle();
    expect(h.browser.length).toBeGreaterThanOrEqual(1);
    expect(h.browser.join(' ')).toContain('No server voice');
    expect(h.played.filter((p) => p !== 'STOP')).toEqual([]);
    // Once the browser has taken over, later sentences do not ask the server again.
    const before = calls;
    h.out.push('One more sentence after the switch, long enough to be its own chunk of speech. ');
    h.out.end();
    await settle();
    expect(calls).toBe(before);
  });

  it('cancel drops queued speech (barge-in)', async () => {
    const h = harness(async (text) => {
      await new Promise((r) => setTimeout(r, 10));
      return { audioBase64: text.slice(0, 3), mimeType: 'audio/wav', useBrowserSpeechFallback: false };
    });
    h.out.say('This will be interrupted before it is ever played back to the crew.');
    h.out.cancel();
    await settle();
    expect(h.played.filter((p) => p !== 'STOP')).toEqual([]);
    expect(h.out.isSpeaking).toBe(false);
  });

  it('prefers the chosen browser voice, then a natural English one', () => {
    const v = (name: string, lang: string) => ({ name, lang, default: false }) as SpeechSynthesisVoice;
    const voices = [v('Hans', 'de-DE'), v('Plain', 'en-US'), v('Aria Natural', 'en-US')];
    expect(pickBrowserVoice(voices, 'Plain')?.name).toBe('Plain');
    expect(pickBrowserVoice(voices)?.name).toBe('Aria Natural');
    expect(pickBrowserVoice([v('Hans', 'de-DE')])?.name).toBe('Hans');
  });
});

describe('LiveSession', () => {
  function fakeSocket() {
    const sent: unknown[] = [];
    const socket = {
      readyState: 1,
      send: (data: string) => sent.push(JSON.parse(data)),
      close: () => {},
      onopen: null as null | ((e: unknown) => void),
      onmessage: null as null | ((e: { data: unknown }) => void),
      onclose: null as null | ((e: { reason?: string }) => void),
      onerror: null as null | ((e: unknown) => void),
    };
    return { socket, sent };
  }
  const fakePlayer = () => {
    const chunks: number[] = [];
    return { chunks, player: { onIdle: null, onStart: null, playing: false, enqueuePcm: (s: Float32Array, rate: number) => (chunks.push(rate * 1 + s.length * 0), true), stop: () => chunks.push(-1) } };
  };

  async function open(events = {}) {
    const { socket, sent } = fakeSocket();
    const { player, chunks } = fakePlayer();
    const session = new LiveSession({ wsUrl: 'wss://x', setup: { setup: { model: 'm' } }, socketFactory: () => socket as never, player: player as never }, events);
    const ready = session.connect(500);
    socket.onopen?.({});
    socket.onmessage?.({ data: JSON.stringify({ setupComplete: {} }) });
    await ready;
    return { session, socket, sent, chunks };
  }

  it('sends setup first, then streams audio and frames', async () => {
    const { session, sent } = await open();
    expect(sent[0]).toEqual({ setup: { model: 'm' } });
    session.sendAudio(new Float32Array(160));
    session.sendFrame('abc');
    expect(sent[1]).toMatchObject({ realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000' } } });
    expect(sent[2]).toEqual({ realtimeInput: { video: { data: 'abc', mimeType: 'image/jpeg' } } });
  });

  it('plays incoming speech and reports the finished turn', async () => {
    const turns: Array<{ input: string; output: string }> = [];
    const { session, chunks } = await open({ onTurnComplete: (t: { input: string; output: string }) => turns.push(t) });
    await session.handle({
      serverContent: {
        inputTranscription: { text: 'I slept badly' },
        outputTranscription: { text: 'I am sorry to hear that.' },
        modelTurn: { parts: [{ inlineData: { data: 'AAAAAA==', mimeType: 'audio/pcm;rate=24000' } }] },
      },
    });
    await session.handle({ serverContent: { turnComplete: true } });
    expect(chunks).toContain(24000);
    expect(turns).toEqual([{ input: 'I slept badly', output: 'I am sorry to hear that.' }]);
  });

  it('stops playback when interrupted and answers tool calls', async () => {
    const { session, sent, chunks } = await open({ onToolCall: async () => ({ ok: true, note: 'logged' }) });
    await session.handle({ serverContent: { interrupted: true } });
    expect(chunks).toContain(-1);
    await session.handle({ toolCall: { functionCalls: [{ id: 'c1', name: 'log_checkin_reading', args: { metricId: 'spo2', value: 97 } }] } });
    expect(sent[sent.length - 1]).toEqual({ toolResponse: { functionResponses: [{ id: 'c1', name: 'log_checkin_reading', response: { result: { ok: true, note: 'logged' } } }] } });
  });

  it('rejects when the session never becomes ready', async () => {
    const { socket } = fakeSocket();
    const session = new LiveSession({ wsUrl: 'wss://x', setup: {}, socketFactory: () => socket as never, player: fakePlayer().player as never });
    await expect(session.connect(30)).rejects.toThrow(/did not answer/);
  });
});
