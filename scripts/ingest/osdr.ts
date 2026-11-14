/**
 * NASA OSDR loader (specs/05-data-platform.md §7)
 * Source: SRC-046 (OSDR Biological Data API, no key), SRC-047 (Inspiration4 datasets OSD-569…575)
 *
 * 1. Study metadata for the Inspiration4 datasets → ref_osdr_studies
 * 2. OSD-569 Complete Blood Count (4 crew × 7 timepoints) → data/raw/SRC-047/ (checksummed) → ref_osdr_lab_values
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../../server/db/client';
import { ingestRuns, refOsdrLabValues, refOsdrStudies } from '../../server/db/schema';
import { parseCsv, sha256 } from './reference';

const API = 'https://visualization.osdr.nasa.gov/biodata/api/v2';
export const I4_STUDIES = ['OSD-569', 'OSD-570', 'OSD-571', 'OSD-572', 'OSD-573', 'OSD-574', 'OSD-575'];
const CBC_STUDY = 'OSD-569';
const CBC_FILE = 'LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv';
const MISSION_DAYS = 3; // Inspiration4 flew 2021-09-16 → 2021-09-18

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

const join = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(String))].join('; ') : v == null ? null : String(v));

/** "L-92" → −92, "R+1" → mission length + 1 (days from launch). */
export function daysFromLaunch(timepoint: string): number {
  const m = /^([LR])([+-])(\d+)$/.exec(timepoint);
  if (!m) return NaN;
  const n = Number(m[3]) * (m[2] === '-' ? -1 : 1);
  return m[1] === 'L' ? n : MISSION_DAYS + n;
}

/** CBC column "absolute_lymphocytes_value_cells_per_microliter" → analyte + unit (+ range columns). */
export function cbcRowsToLong(rows: Array<Record<string, string>>) {
  const out: Array<{ subject: string; timepoint: string; analyte: string; value: number; unit: string; refMin: number | null; refMax: number | null }> = [];
  for (const r of rows) {
    const m = /^(C\d+)_whole-blood_([LR][+-]\d+)_cbc$/.exec(r['Sample Name'] ?? '');
    if (!m) continue;
    for (const col of Object.keys(r)) {
      const v = /^(.*)_value_(.*)$/.exec(col);
      if (!v || r[col] === '') continue;
      const value = Number(r[col]);
      if (!Number.isFinite(value)) continue;
      const [, analyte, unit] = v;
      const min = r[`${analyte}_range_min_${unit}`];
      const max = r[`${analyte}_range_max_${unit}`];
      out.push({ subject: m[1], timepoint: m[2], analyte, value, unit, refMin: min ? Number(min) : null, refMax: max ? Number(max) : null });
    }
  }
  return out;
}

export async function loadOsdr(db: Db, root = process.cwd(), log: (m: string) => void = () => {}): Promise<Record<string, number>> {
  // 1. Study metadata
  const [metaRun] = await db.insert(ingestRuns).values({ kind: 'nasa_dataset', sourceId: 'SRC-046', script: 'scripts/ingest/osdr.ts studies' }).returning({ id: ingestRuns.id });
  let studies = 0;
  for (const id of I4_STUDIES) {
    try {
      const data = await getJson<Record<string, { metadata: Record<string, unknown> }>>(`${API}/dataset/${id}/`);
      const md = data[id]?.metadata ?? {};
      const mission = md.mission as { name?: string } | undefined;
      const values = {
        id,
        title: String(md['study title'] ?? id),
        mission: mission?.name ?? null,
        organism: join(md.organism),
        assayTypes: join(md['study assay measurement type']),
        description: md['study description'] ? String(md['study description']).slice(0, 4000) : null,
        url: `https://osdr.nasa.gov/bio/repo/data/studies/${id}`,
        sourceId: 'SRC-047',
        ingestRunId: metaRun.id,
      };
      await db.insert(refOsdrStudies).values(values).onConflictDoUpdate({ target: refOsdrStudies.id, set: values });
      studies++;
    } catch (err) {
      log(`  skip ${id}: ${(err as Error).message}`);
    }
  }
  await db.update(ingestRuns).set({ rowCount: studies, status: 'succeeded', finishedAt: new Date() }).where(eq(ingestRuns.id, metaRun.id));

  // 2. Inspiration4 CBC
  const files = await getJson<Record<string, { files: Record<string, { URL: string }> }>>(`${API}/dataset/${CBC_STUDY}/files/`);
  const fileUrl = files[CBC_STUDY]?.files?.[CBC_FILE]?.URL;
  if (!fileUrl) throw new Error(`${CBC_FILE} not listed for ${CBC_STUDY}`);
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`CBC download → HTTP ${res.status}`);
  const text = await res.text();
  const rawDir = resolve(root, 'data/raw/SRC-047');
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(resolve(rawDir, CBC_FILE), text);
  const checksum = sha256(text);
  const [cbcRun] = await db
    .insert(ingestRuns)
    .values({ kind: 'nasa_dataset', sourceId: 'SRC-047', script: 'scripts/ingest/osdr.ts cbc', checksum, detail: { url: fileUrl, file: CBC_FILE } })
    .returning({ id: ingestRuns.id });
  const long = cbcRowsToLong(parseCsv(text));
  for (let i = 0; i < long.length; i += 500) {
    const chunk = long.slice(i, i + 500).map((r) => ({
      studyId: CBC_STUDY,
      ...r,
      daysFromLaunch: daysFromLaunch(r.timepoint),
      phase: r.timepoint.startsWith('L') ? 'preflight' : 'postflight',
      sourceId: 'SRC-047',
      ingestRunId: cbcRun.id,
    }));
    await db
      .insert(refOsdrLabValues)
      .values(chunk)
      .onConflictDoUpdate({
        target: [refOsdrLabValues.studyId, refOsdrLabValues.subject, refOsdrLabValues.timepoint, refOsdrLabValues.analyte],
        set: { ingestRunId: cbcRun.id },
      });
  }
  await db.update(ingestRuns).set({ rowCount: long.length, status: 'succeeded', finishedAt: new Date() }).where(eq(ingestRuns.id, cbcRun.id));
  return { ref_osdr_studies: studies, ref_osdr_lab_values: long.length };
}
