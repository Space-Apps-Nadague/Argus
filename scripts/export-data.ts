/**
 * npm run data:export — writes CSVs for the Python notebooks (analysis/) from DATABASE_URL, so notebooks
 * work with every engine (PGlite included). Output: data/exports/ (gitignored, regenerate any time).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, queryRows, sql } from '../server/db/client';
import { loadEnv } from '../server/env';

loadEnv();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const h = openDb(url);
const out = resolve('data/exports');
mkdirSync(out, { recursive: true });

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString() : v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

const exports: Record<string, string> = {
  daily_metrics: `select astronaut_id, metric_id, day::text as day, value, n, method, origin from daily_metrics order by 1,2,3`,
  baselines: `select astronaut_id, metric_id, kind, hour, n, mean, sd, median, mad, p05, p95 from baselines order by 1,2,3,4`,
  anomalies: `select astronaut_id, metric_id, detector, severity, score, ts_start, ts_end from anomalies order by 1, ts_start`,
  minute_heart_rate: `select astronaut_id, ts, value from observations where metric_id = 'heart_rate' and quality = 'ok' and ts > now() - interval '14 days' order by 1, 2`,
  ref_radiation_dose_rates: `select * from ref_radiation_dose_rates`,
  ref_thresholds: `select * from ref_thresholds`,
  ref_osdr_lab_values: `select study_id, subject, timepoint, days_from_launch, phase, analyte, value, unit, ref_min, ref_max, source_id from ref_osdr_lab_values order by subject, days_from_launch, analyte`,
};
for (const [name, query] of Object.entries(exports)) {
  const rows = await queryRows<Record<string, unknown>>(h.db, sql.raw(query));
  writeFileSync(resolve(out, `${name}.csv`), toCsv(rows));
  console.log(`[data:export] ${name}.csv  ${rows.length} rows`);
}
await h.close();
