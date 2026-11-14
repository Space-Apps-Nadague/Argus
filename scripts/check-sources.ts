/**
 * ARGUS — Source attribution check (AGENTS.md §7)
 *
 * Fails when code, specs or data cite an `SRC-xxx` ID that is missing from SOURCES.md.
 * Warns about sources whose "Used in" cell is empty.
 *
 *   npm run check:sources
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export interface SourceEntry {
  id: string;
  usedIn: string;
}

export interface SourceCheckResult {
  sources: SourceEntry[];
  /** ID → files that cite it but it is not registered. */
  missing: Record<string, string[]>;
  /** Registered sources with an empty "Used in" cell. */
  unused: string[];
  /** Duplicate IDs in SOURCES.md. */
  duplicates: string[];
}

const SCAN_DIRS = ['src', 'server', 'shared', 'scripts', 'specs', 'analysis', 'data/reference', 'docs'];
const SCAN_EXT = /\.(ts|tsx|js|mjs|py|ipynb|md|csv|sql|json|sh)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.venv', '__pycache__', 'raw', '.ipynb_checkpoints']);
const ID_RE = /\bSRC-\d{3}\b/g;
const RANGE_RE = /\bSRC-(\d{3})\.\.(\d{3})\b/g;

export function parseSources(markdown: string): { sources: SourceEntry[]; duplicates: string[] } {
  const sources: SourceEntry[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const line of markdown.split('\n')) {
    const m = /^\|\s*(SRC-\d{3})\s*\|/.exec(line);
    if (!m) continue;
    const cells = line.split('|').map((c) => c.trim());
    // ['', id, source, type, access, usedIn, '']
    const usedIn = cells[cells.length - 2] ?? '';
    if (seen.has(m[1])) duplicates.push(m[1]);
    seen.add(m[1]);
    sources.push({ id: m[1], usedIn });
  }
  return { sources, duplicates };
}

/** IDs cited in a file's text, expanding ranges such as `SRC-042..045`. */
export function citedIds(text: string): string[] {
  const ids = new Set<string>(text.match(ID_RE) ?? []);
  for (const m of text.matchAll(RANGE_RE)) {
    const from = Number(m[1]);
    const to = Number(m[2]);
    for (let n = from; n <= to && to - from < 50; n++) ids.add(`SRC-${String(n).padStart(3, '0')}`);
  }
  return [...ids];
}

function walk(dir: string, out: string[]) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (SCAN_EXT.test(name)) out.push(full);
  }
}

export function checkSources(root = process.cwd()): SourceCheckResult {
  const { sources, duplicates } = parseSources(readFileSync(resolve(root, 'SOURCES.md'), 'utf8'));
  const known = new Set(sources.map((s) => s.id));
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(resolve(root, d), files);
  for (const f of ['AGENTS.md', 'README.md']) files.push(resolve(root, f));

  const missing: Record<string, string[]> = {};
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const id of citedIds(text)) {
      if (!known.has(id)) (missing[id] ??= []).push(relative(root, file));
    }
  }
  const unused = sources.filter((s) => !s.usedIn || s.usedIn === '—' || s.usedIn === '-').map((s) => s.id);
  return { sources, missing, unused, duplicates };
}

const isCli = process.argv[1] && resolve(process.argv[1]).endsWith('check-sources.ts');
if (isCli) {
  const r = checkSources();
  const missingIds = Object.keys(r.missing);
  console.log(`[check:sources] ${r.sources.length} sources registered in SOURCES.md`);
  for (const id of r.unused) console.warn(`  warn: ${id} has an empty "Used in" cell`);
  for (const id of r.duplicates) console.error(`  error: ${id} is listed twice in SOURCES.md`);
  for (const id of missingIds) console.error(`  error: ${id} is cited in ${r.missing[id].join(', ')} but not in SOURCES.md`);
  if (missingIds.length || r.duplicates.length) process.exit(1);
  console.log('[check:sources] ok');
}
