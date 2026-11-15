/** npm run rag:search -- "smoke in the module" [--zone neuro] — tries the retriever the AI uses. */
import { getDb, getDbHandle } from '../server/db/client';
import { loadEnv } from '../server/env';
import { searchKnowledge } from '../server/rag/retriever';

loadEnv();
const args = process.argv.slice(2);
const zi = args.indexOf('--zone');
const zoneId = zi >= 0 ? args.splice(zi, 2)[1] : undefined;
const query = args.join(' ');
if (!query) {
  console.error('Usage: npm run rag:search -- "<question>" [--zone neuro|cardio|musculo|immune|behavioral]');
  process.exit(1);
}
const r = await searchKnowledge({ query, zoneId, db: getDb() });
console.log(`${r.retrieval} · ${r.embeddingModel} · ${r.latencyMs} ms`);
for (const h of r.hits) {
  console.log(`\n#${h.rank} ${h.title} — ${h.heading} [${h.sourceId ?? h.origin}] score ${h.score} (kw ${h.keywordRank ?? '-'}, vec ${h.vectorRank ?? '-'})`);
  console.log(h.content.split('\n').map((l) => `   ${l}`).join('\n'));
}
await getDbHandle()?.close();
