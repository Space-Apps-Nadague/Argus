/**
 * Knowledge-base corpus (specs/05-data-platform.md §3.6): in-repo verified content plus Markdown files in
 * `server/rag/corpus/`. Every document carries the `SRC-xxx` it comes from (AGENTS.md §7).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMERGENCY_DISCLAIMER, EMERGENCY_PROTOCOLS } from './emergencyProtocols';
import { METRIC_BY_ID } from '../db/catalog';
import { COUNTERMEASURE_LIBRARY } from '../models/countermeasureLibrary';
import type { RagDocKind, RagDocumentInput } from './types';

export const CORPUS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'corpus');
const DOC_KINDS: RagDocKind[] = ['emergency_checklist', 'countermeasure', 'clinical_reference', 'medication'];
const ZONES = ['neuro', 'cardio', 'musculo', 'immune', 'behavioral'];

const zoneOfMetric = (metricId: string): string[] => {
  const z = METRIC_BY_ID.get(metricId)?.zone;
  return z ? [z] : [];
};

// Protocols tied to a single metric take that metric's zone from the catalog; the rest apply to every zone.
const EMERGENCY_ZONE_METRIC: Record<string, string> = { co2: 'cabin_co2', radiation: 'rad_dose' };

/** Emergency checklists (Source: SRC-004) and the countermeasure library, as documents. */
export function repoDocuments(): RagDocumentInput[] {
  const docs: RagDocumentInput[] = [];
  for (const p of EMERGENCY_PROTOCOLS) {
    const steps = p.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    docs.push({
      id: `emergency/${p.id}`,
      sourceId: 'SRC-004',
      title: `Emergency: ${p.title}`,
      kind: 'emergency_checklist',
      origin: 'server/rag/emergencyProtocols.ts',
      url: null,
      zoneIds: EMERGENCY_ZONE_METRIC[p.id] ? zoneOfMetric(EMERGENCY_ZONE_METRIC[p.id]) : [],
      body: `When: ${p.trigger}\n\nSteps:\n${steps}\n\n${EMERGENCY_DISCLAIMER}`,
    });
  }
  for (const [metricId, c] of Object.entries(COUNTERMEASURE_LIBRARY)) {
    const label = METRIC_BY_ID.get(metricId)?.label ?? metricId;
    docs.push({
      id: `countermeasure/${metricId}`,
      sourceId: null, // no SRC-xxx registered for the library yet (spec 05 §3.6)
      title: `Countermeasure: ${c.title}`,
      kind: 'countermeasure',
      origin: 'server/models/countermeasureLibrary.ts',
      url: null,
      zoneIds: zoneOfMetric(metricId),
      body:
        `For: ${label} (${c.category.replace(/_/g, ' ')})\n\n` +
        `What to do: ${c.plainInstruction}\n\nWhy: ${c.rationale}\n\nTime: about ${c.durationMinutes} minutes.`,
    });
  }
  return docs;
}

/** Minimal front matter: `key: value` lines between `---` fences. Lists as `[a, b]` or `a, b`. */
export function parseFrontMatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(m[0].length) };
}

const listOf = (v: string | undefined): string[] =>
  (v ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export interface CorpusLoad {
  documents: RagDocumentInput[];
  errors: string[];
}

/** Reads `*.md` (except README.md) from `dir`. Files without a known `source_id` are rejected. */
export function corpusFileDocuments(knownSourceIds: Set<string>, dir = CORPUS_DIR): CorpusLoad {
  const documents: RagDocumentInput[] = [];
  const errors: string[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md');
  } catch {
    return { documents, errors };
  }
  for (const file of files.sort()) {
    const { meta, body } = parseFrontMatter(readFileSync(join(dir, file), 'utf8'));
    const id = meta.id || `corpus/${file.replace(/\.md$/, '')}`;
    const kind = (meta.kind || 'clinical_reference') as RagDocKind;
    const zones = listOf(meta.zones);
    if (!meta.title) errors.push(`${file}: missing "title"`);
    else if (!meta.source_id || !knownSourceIds.has(meta.source_id))
      errors.push(`${file}: "source_id" must be an ID listed in SOURCES.md (got "${meta.source_id ?? ''}")`);
    else if (!DOC_KINDS.includes(kind)) errors.push(`${file}: unknown kind "${kind}"`);
    else if (zones.some((z) => !ZONES.includes(z))) errors.push(`${file}: unknown zone in "${meta.zones}"`);
    else if (!body.trim()) errors.push(`${file}: empty body`);
    else
      documents.push({
        id,
        sourceId: meta.source_id,
        title: meta.title,
        kind,
        origin: `server/rag/corpus/${file}`,
        url: meta.url || null,
        zoneIds: zones,
        body,
      });
  }
  return { documents, errors };
}

/** IDs registered in SOURCES.md. */
export function sourceIdsFromFile(root = process.cwd()): Set<string> {
  try {
    const text = readFileSync(resolve(root, 'SOURCES.md'), 'utf8');
    return new Set([...text.matchAll(/^\|\s*(SRC-\d{3})\s*\|/gm)].map((m) => m[1]));
  } catch {
    return new Set();
  }
}

export function loadCorpus(knownSourceIds: Set<string> = sourceIdsFromFile(), dir = CORPUS_DIR): CorpusLoad {
  const files = corpusFileDocuments(knownSourceIds, dir);
  const seen = new Set<string>();
  const documents: RagDocumentInput[] = [];
  const errors = [...files.errors];
  for (const d of [...repoDocuments(), ...files.documents]) {
    if (seen.has(d.id)) errors.push(`duplicate document id "${d.id}" (${d.origin})`);
    else {
      seen.add(d.id);
      documents.push(d);
    }
  }
  return { documents, errors };
}
