import { serve } from '@hono/node-server';
import { describeProvider, resolveProviderChain } from './ai/providers';
import { createApp } from './app';
import { getDbHandle } from './db/client';
import { loadEnv } from './env';
import { startAnalyticsTimer } from './jobs/analytics';
import { bootstrapIfEmpty, startSimulatedTopUp } from './jobs/bootstrap';

loadEnv();

const port = Number(process.env.PORT || process.env.ARGUS_SERVER_PORT) || 8787;
const hostname = process.env.ARGUS_SERVER_HOST ?? (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const chain = resolveProviderChain(process.env).map(describeProvider);

const dbHandle = getDbHandle();
if (dbHandle) {
  try {
    // Apply committed migrations on start so every environment's schema matches (spec 05 §2).
    await dbHandle.migrate();
    startAnalyticsTimer(dbHandle.db);
    console.log(`[ARGUS server] database: ${dbHandle.kind}`);
    if (process.env.ARGUS_BOOTSTRAP_ON_START === '1') {
      // Runs after the server is listening, so App Service's start-up probe is not blocked.
      void bootstrapIfEmpty(dbHandle.db)
        .then(() => startSimulatedTopUp(dbHandle.db))
        .catch((err) => console.error('[ARGUS bootstrap] failed', err));
    }
  } catch (err) {
    // Keep serving the HUD (offline mode in the browser) instead of crash-looping; API calls will report errors.
    console.error('[ARGUS server] database unavailable at start-up:', (err as Error).message);
  }
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
