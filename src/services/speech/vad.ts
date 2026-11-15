/**
 * Energy-based voice activity detection for hands-free turn-taking
 * (specs/04-ai-backend.md §4.2). Pure state machine: feed it one level per audio frame.
 *
 * The noise floor adapts while nobody is speaking, so cabin fan noise does not trigger it.
 */

export interface VadOptions {
  /** Level must exceed floor × this to count as speech. */
  ratio: number;
  /** Absolute minimum speech level (RMS 0–1). */
  minLevel: number;
  /** Milliseconds of speech before a turn starts. */
  startMs: number;
  /** Milliseconds of silence that end a turn. */
  endMs: number;
  /** Turns shorter than this are discarded as noise. */
  minTurnMs: number;
  /** Hard cap on one turn. */
  maxTurnMs: number;
}

export const DEFAULT_VAD: VadOptions = { ratio: 3, minLevel: 0.012, startMs: 120, endMs: 900, minTurnMs: 300, maxTurnMs: 45_000 };

export type VadEvent = 'none' | 'start' | 'end' | 'discard';

/** Exponential-smoothing factor for a time constant, independent of frame size. */
const alpha = (frameMs: number, tauMs: number) => 1 - Math.exp(-frameMs / tauMs);

export class Vad {
  private floor = 0.004;
  private speaking = false;
  private aboveMs = 0;
  private belowMs = 0;
  private turnMs = 0;
  private voicedMs = 0;
  /** Recent levels (with durations) for the rolling minimum used while someone is talking. */
  private recent: Array<{ level: number; ms: number }> = [];
  private recentMs = 0;

  constructor(private readonly opts: VadOptions = DEFAULT_VAD) {}

  get isSpeaking(): boolean {
    return this.speaking;
  }

  get threshold(): number {
    return Math.max(this.opts.minLevel, this.floor * this.opts.ratio);
  }

  reset(): void {
    this.speaking = false;
    this.aboveMs = this.belowMs = this.turnMs = this.voicedMs = 0;
  }

  private track(level: number, frameMs: number): number {
    this.recent.push({ level, ms: frameMs });
    this.recentMs += frameMs;
    while (this.recentMs > 400 && this.recent.length > 1) this.recentMs -= this.recent.shift()!.ms;
    let min = Infinity;
    for (const r of this.recent) min = Math.min(min, r.level);
    return min;
  }

  /** @param level RMS of the frame  @param frameMs frame duration */
  push(level: number, frameMs: number): VadEvent {
    const recentMin = this.track(level, frameMs);
    const loud = level > this.threshold;

    if (!this.speaking) {
      if (loud) {
        this.aboveMs += frameMs;
        if (this.aboveMs >= this.opts.startMs) {
          this.speaking = true;
          this.turnMs = this.aboveMs;
          this.voicedMs = this.aboveMs;
          this.belowMs = 0;
          return 'start';
        }
      } else {
        this.aboveMs = 0;
        // Track the room while quiet: fast down, slow up.
        this.floor += (level - this.floor) * alpha(frameMs, level < this.floor ? 150 : 1500);
      }
      return 'none';
    }

    // Speech has dips between syllables; steady fan noise does not. Following the rolling
    // minimum lets the floor climb to constant noise without climbing to the voice itself.
    if (recentMin > this.floor) this.floor += (recentMin - this.floor) * alpha(frameMs, 1500);

    this.turnMs += frameMs;
    if (loud) {
      this.belowMs = 0;
      this.voicedMs += frameMs;
    } else {
      this.belowMs += frameMs;
    }
    if (this.belowMs >= this.opts.endMs || this.turnMs >= this.opts.maxTurnMs) {
      const keep = this.voicedMs >= this.opts.minTurnMs;
      this.reset();
      return keep ? 'end' : 'discard';
    }
    return 'none';
  }
}
