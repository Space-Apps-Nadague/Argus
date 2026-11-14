import { serve } from '@hono/node-server';
import { describeProvider, resolveProviderChain } from './ai/providers';
import { createApp } from './app';
import { loadEnv } from './env';

loadEnv();

const port = Number(process.env.ARGUS_SERVER_PORT) || 8787;
const chain = resolveProviderChain(process.env).map(describeProvider);

serve({ fetch: createApp().fetch, port, hostname: process.env.ARGUS_SERVER_HOST ?? '127.0.0.1' }, (info) => {
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
