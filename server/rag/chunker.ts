/**
 * Clinical-unit chunker (specs/05-data-platform.md §3.6).
 *
 * Rules:
 * - a chunk never starts or ends inside a list or table, so a checklist, a dosage with its
 *   contraindications, or a multi-step procedure always stays whole;
 * - a chunk is split only at a Markdown heading or between paragraphs;
 * - a single block larger than `maxTokens` stays whole (oversized beats split).
 */

import { approxTokens } from './text';
import type { RagChunkDraft } from './types';

export const CHUNKER_VERSION = 1;

interface Section {
  heading: string;
  blocks: string[];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_OR_TABLE = /^\s*([-*+]\s|\d+[.)]\s|\|)/;

/** Splits Markdown into blocks: paragraphs, and whole lists/tables (including indented continuation lines). */
export function splitBlocks(markdown: string): Array<{ text: string; heading?: string }> {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: Array<{ text: string; heading?: string }> = [];
  let buf: string[] = [];
  let inList = false;

  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) out.push({ text });
    buf = [];
    inList = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = HEADING.exec(line);
    if (h) {
      flush();
      out.push({ text: '', heading: h[2].trim() });
      continue;
    }
    const isItem = LIST_OR_TABLE.test(line);
    const isContinuation = inList && /^\s+\S/.test(line);
    if (!line.trim()) {
      // A blank line inside a list only ends it if the next non-blank line is not another item.
      if (inList) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && (LIST_OR_TABLE.test(lines[j]) || /^\s+\S/.test(lines[j]))) {
          buf.push(line);
          continue;
        }
      }
      flush();
      continue;
    }
    if (isItem || isContinuation) {
      if (!inList && buf.length) {
        // A paragraph that introduces a list ("Steps:") stays with it.
        const intro = buf.join('\n').trim();
        if (!intro.endsWith(':')) flush();
      }
      inList = true;
      buf.push(line);
      continue;
    }
    if (inList) flush();
    buf.push(line);
  }
  flush();
  return out;
}

export function chunkMarkdown(title: string, markdown: string, maxTokens = 400): RagChunkDraft[] {
  const sections: Section[] = [{ heading: title, blocks: [] }];
  for (const b of splitBlocks(markdown)) {
    if (b.heading !== undefined) sections.push({ heading: b.heading, blocks: [] });
    else sections[sections.length - 1].blocks.push(b.text);
  }

  const chunks: RagChunkDraft[] = [];
  for (const s of sections) {
    if (!s.blocks.length) continue;
    let current: string[] = [];
    let tokens = 0;
    const emit = () => {
      if (!current.length) return;
      const content = current.join('\n\n');
      chunks.push({ ordinal: chunks.length, heading: s.heading, content, tokenCount: approxTokens(content) });
      current = [];
      tokens = 0;
    };
    for (const block of s.blocks) {
      const t = approxTokens(block);
      if (current.length && tokens + t > maxTokens) emit();
      current.push(block);
      tokens += t;
    }
    emit();
  }
  return chunks;
}
