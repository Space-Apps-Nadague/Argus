import { Hono } from 'hono';
import type { AiProviderStatus } from '../../src/types/aiApi';
import { probeProvider } from '../ai/llm';
import { describeProvider, resolveProviderChain, resolveRoutes } from '../ai/providers';
import { keyFromHeader } from './util';

export const healthRoutes = new Hono();

healthRoutes.get('/health', async (c) => {
  const chain = resolveProviderChain(process.env, { keyOverride: keyFromHeader(c) });
  const infos = chain.map(describeProvider);

  if (c.req.query('probe') === '1') {
    const reachable = await Promise.all(chain.map(probeProvider));
    infos.forEach((info, i) => {
      info.reachable = reachable[i];
    });
  }

  const visionChain = resolveProviderChain(process.env, { feature: 'vision', keyOverride: keyFromHeader(c) });
  const status: AiProviderStatus = {
    aiAvailable: infos.length > 0 && infos.some((i) => i.reachable !== false),
    visionAvailable: visionChain.some((p) => Boolean(p.visionModel)),
    chain: infos,
    routes: resolveRoutes(process.env),
  };
  return c.json(status);
});
