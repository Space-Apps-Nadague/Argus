import type { Context } from 'hono';
import type { ZodType } from 'zod';
import type { AiResultMeta } from '../../src/types/aiApi';
import type { LlmResult } from '../ai/llm';

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Validates a JSON body; returns a 400 response with zod issues on failure. */
export async function parseBody<T>(c: Context, schema: ZodType<T>): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: 'Body must be valid JSON' }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json(
        {
          error: 'Invalid request',
          issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        400
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Per-request key typed into the HUD (never logged, never stored). */
export function keyFromHeader(c: Context): string | undefined {
  const key = c.req.header('x-ai-key')?.trim();
  return key ? key : undefined;
}

export function liveMeta<T>(r: LlmResult<T>): AiResultMeta {
  return { source: 'live_ai', provider: r.provider, model: r.model, latencyMs: r.latencyMs };
}

export const OFFLINE_META: AiResultMeta = { source: 'offline_verified_cache' };

/** Keeps only metric ids that actually exist in the threshold table. */
export function knownMetricIds(ids: string[], known: Iterable<string>): string[] {
  const set = new Set(known);
  return [...new Set(ids.map((i) => i.trim()).filter((i) => set.has(i)))];
}
