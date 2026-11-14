/**
 * Loads curated reference CSVs (data/reference/*.csv) into ref_* tables with provenance
 * (specs/05-data-platform.md §7). Every row carries a source_id; each load is an ingest_runs row.
 *   npm run data:nasa (scripts/ingest/nasa.ts) and the hosted bootstrap (server/jobs/bootstrap.ts)
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { ingestRuns, refRadiationDoseRates, refThresholds } from '../db/schema';

/** Minimal RFC-4180 CSV parser (quoted fields, commas inside quotes). */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((c) => c !== '')) rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

async function startRun(db: Db, sourceId: string | null, script: string, checksum: string) {
  const [run] = await db.insert(ingestRuns).values({ kind: 'nasa_dataset', sourceId, script, checksum }).returning({ id: ingestRuns.id });
  return run.id;
}
async function finishRun(db: Db, id: string, rowCount: number) {
  await db.update(ingestRuns).set({ rowCount, status: 'succeeded', finishedAt: new Date() }).where(eq(ingestRuns.id, id));
}

export async function loadReferenceCsvs(db: Db, root = process.cwd()): Promise<Record<string, number>> {
  const out: Record<string, number> = {};

  const radPath = resolve(root, 'data/reference/radiation_dose_rates.csv');
  const radText = readFileSync(radPath, 'utf8');
  const rad = parseCsv(radText);
  const radRun = await startRun(db, null, 'scripts/ingest/reference.ts radiation_dose_rates.csv', sha256(radText));
  for (const r of rad) {
    const values = {
      id: r.id,
      environment: r.environment,
      doseRateMsvPerDay: Number(r.dose_rate_msv_per_day),
      quantity: r.quantity,
      instrument: r.instrument || null,
      periodLabel: r.period_label || null,
      sourceId: r.source_id,
      sourceLocator: r.source_locator || null,
      ingestRunId: radRun,
    };
    await db.insert(refRadiationDoseRates).values(values).onConflictDoUpdate({ target: refRadiationDoseRates.id, set: values });
  }
  await finishRun(db, radRun, rad.length);
  out.ref_radiation_dose_rates = rad.length;

  const thrText = readFileSync(resolve(root, 'data/reference/thresholds.csv'), 'utf8');
  const thr = parseCsv(thrText);
  const thrRun = await startRun(db, null, 'scripts/ingest/reference.ts thresholds.csv', sha256(thrText));
  for (const r of thr) {
    const values = {
      id: r.id,
      quantity: r.quantity,
      limitValue: Number(r.limit_value),
      unit: r.unit,
      context: r.context,
      sourceId: r.source_id,
      sourceLocator: r.source_locator || null,
      ingestRunId: thrRun,
    };
    await db.insert(refThresholds).values(values).onConflictDoUpdate({ target: refThresholds.id, set: values });
  }
  await finishRun(db, thrRun, thr.length);
  out.ref_thresholds = thr.length;
  return out;
}
