import { describe, expect, it } from 'vitest';
import { checkSources, citedIds, parseSources } from '../check-sources';

describe('source attribution (AGENTS.md §7)', () => {
  it('parses IDs and the Used in cell', () => {
    const md = '| ID | Source | Type | Access | Used in |\n|---|---|---|---|---|\n| SRC-001 | [X](u) | web | open | `a.ts` |\n| SRC-002 | [Y](u) | web | open |  |';
    const { sources } = parseSources(md);
    expect(sources).toEqual([
      { id: 'SRC-001', usedIn: '`a.ts`' },
      { id: 'SRC-002', usedIn: '' },
    ]);
  });

  it('expands ID ranges', () => {
    expect(citedIds('see [SRC-042..044] and SRC-007').sort()).toEqual(['SRC-007', 'SRC-042', 'SRC-043', 'SRC-044']);
  });

  it('every ID cited in the repo is registered in SOURCES.md', () => {
    const r = checkSources();
    expect(r.duplicates).toEqual([]);
    expect(r.missing).toEqual({});
  });
});
