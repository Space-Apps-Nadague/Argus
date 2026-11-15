/**
 * Splits a token stream into speakable chunks so speech can start on the first sentence
 * while the rest of the reply is still being generated (specs/04-ai-backend.md §4.2).
 */

const SENTENCE_END = /([.!?…]+["')\]]?|[\n]+)\s+/g;
const ABBREVIATIONS = /\b(?:Dr|Mr|Mrs|Ms|vs|e\.g|i\.e|approx|min|max|No|St)\.$/i;

/** Characters that should never be read aloud. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>|]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export class SentenceChunker {
  private buffer = '';
  private first = true;

  /**
   * @param minChars  smallest chunk worth a synthesis call (short fragments are merged)
   * @param firstMinChars  smaller minimum for the first chunk, to cut time to first audio
   */
  constructor(
    private readonly minChars = 60,
    private readonly firstMinChars = 20,
    private readonly maxChars = 320
  ) {}

  /** Adds streamed text; returns any chunks that are now complete. */
  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];
    for (;;) {
      const chunk = this.take();
      if (!chunk) break;
      out.push(chunk);
    }
    return out;
  }

  /** Returns whatever is left at the end of the reply. */
  flush(): string[] {
    const rest = cleanForSpeech(this.buffer);
    this.buffer = '';
    this.first = true;
    return rest ? [rest] : [];
  }

  reset(): void {
    this.buffer = '';
    this.first = true;
  }

  private take(): string | null {
    const min = this.first ? this.firstMinChars : this.minChars;
    SENTENCE_END.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SENTENCE_END.exec(this.buffer)) !== null) {
      const end = m.index + m[1].length;
      const candidate = this.buffer.slice(0, end);
      if (ABBREVIATIONS.test(candidate) || /\d\.$/.test(candidate)) continue; // "Dr." or "38." mid-number
      if (cleanForSpeech(candidate).length < min) continue;
      this.buffer = this.buffer.slice(m.index + m[0].length);
      this.first = false;
      return cleanForSpeech(candidate);
    }
    // A very long run with no sentence end: break at the last comma or space.
    if (this.buffer.length > this.maxChars) {
      const window = this.buffer.slice(0, this.maxChars);
      const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' '));
      if (cut > min) {
        const candidate = this.buffer.slice(0, cut + 1);
        this.buffer = this.buffer.slice(cut + 1);
        this.first = false;
        return cleanForSpeech(candidate);
      }
    }
    return null;
  }
}
