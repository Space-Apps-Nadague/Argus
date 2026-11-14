import { serve } from '@hono/node-server';
import { describeProvider, resolveProviderChain } from './ai/providers';
import { createApp } from './app';
import { getDbHandle } from './db/client';
import { loadEnv } from './env';
import { startAnalyticsTimer } from './jobs/analytics';

loadEnv();

const port = Number(process.env.PORT || process.env.ARGUS_SERVER_PORT) || 8787;
const hostname = process.env.ARGUS_SERVER_HOST ?? (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const chain = resolveProviderChain(process.env).map(describeProvider);

const dbHandle = getDbHandle();
if (dbHandle) {
  // Apply committed migrations on start so every teammate's schema matches (spec 05 §2).
  await dbHandle.migrate();
  startAnalyticsTimer(dbHandle.db);
  console.log(`[ARGUS server] database: ${dbHandle.kind}`);
} else {
  console.log('[ARGUS server] No DATABASE_URL — stateless mode (HUD runs the offline demo).');
}

serve({ fetch: createApp().fetch, port, hostname }, (info) => {
  console.log(`[ARGUS server] listening on http://${info.address}:${info.port}`);
  if (chain.length) {
    console.log(
      `[ARGUS server] AI provider chain: ${chain.map((p) => `${p.id}(${p.model})`).join(' → ')} → offline cache`
    );
  } else {
    console.log('[ARGUS server] No AI provider configured — every endpoint serves offline verified results.');
    console.log('[ARGUS server] Set AI_LOCAL_MODEL (Ollama) or a free key in .env — see .env.example.');
  }
});
