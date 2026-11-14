/**
 * Provider-agnostic LLM calls with an ordered fallback chain (specs/04-ai-backend.md §3).
 * Callers always get either validated data or `null` — never an exception — so every
 * endpoint can drop to its deterministic offline result.
 */

import OpenAI, { APIError } from 'openai';
import type { ZodType } from 'zod';
import type { AiFeature, AiProviderId } from '../../src/types/aiApi';
import { extractJson } from './json';
import { currentPrivacy } from './privacy';
import { type ProviderConfig, resolveProviderChain } from './providers';

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface LlmOptions {
  feature: AiFeature;
  keyOverride?: string;
  vision?: boolean;
  temperature?: number;
  maxTokens?: number;
  env?: Record<string, string | undefined>;
}

export interface LlmResult<T> {
  data: T;
  provider: AiProviderId;
  model: string;
  latencyMs: number;
}

const clients = new Map<string, OpenAI>();

function clientFor(cfg: ProviderConfig): OpenAI {
  const cacheKey = `${cfg.baseUrl}|${cfg.apiKey ?? ''}|${cfg.timeoutMs}`;
  let client = clients.get(cacheKey);
  if (!client) {
    client = new OpenAI({
      apiKey: cfg.apiKey || 'not-needed',
      baseURL: cfg.baseUrl,
      timeout: cfg.timeoutMs,
      maxRetries: 0, // the provider chain is our retry strategy
      defaultHeaders: cfg.id === 'openrouter' ? { 'X-Title': 'ARGUS Crew Bio-Twin' } : undefined,
    });
    clients.set(cacheKey, client);
  }
  return client;
}

export function providerChainFor(options: LlmOptions): Array<{ cfg: ProviderConfig; model: string }> {
  if (currentPrivacy().offlineOnly) return []; // astronaut withdrew AI consent (spec 05 §6)
  const chain = resolveProviderChain(options.env ?? process.env, {
    feature: options.feature,
    keyOverride: options.keyOverride,
  });
  return chain
    .map((cfg) => ({ cfg, model: options.vision ? cfg.visionModel ?? '' : cfg.model }))
    .filter((entry) => entry.model);
}

function extraParams(cfg: ProviderConfig): Record<string, unknown> {
  return cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort } : {};
}

function describeError(err: unknown): string {
  if (err instanceof APIError) return `HTTP ${err.status ?? '?'}: ${err.message}`.slice(0, 240);
  if (err instanceof Error) return err.message.slice(0, 240);
  return String(err).slice(0, 240);
}

function warn(feature: AiFeature, cfg: ProviderConfig, model: string, reason: string) {
  console.warn(`[ARGUS AI] ${feature}: ${cfg.id} (${model}) failed — ${reason}`);
}

/**
 * Requests a JSON object and validates it with `schema`. Per provider: JSON mode first
 * (dropped automatically if the provider rejects it), one corrective retry on invalid
 * output, then the next provider in the chain. Returns `null` if every provider fails.
 */
export async function completeJson<T>(
  schema: ZodType<T>,
  messages: ChatMessage[],
  options: LlmOptions
): Promise<LlmResult<T> | null> {
  for (const { cfg, model } of providerChainFor(options)) {
    const client = clientFor(cfg);
    let useJsonMode = true;
    let convo = messages;
    const started = Date.now();

    for (let attempt = 0; attempt < 3; attempt++) {
      let text = '';
      try {
        const res = await client.chat.completions.create({
          model,
          messages: convo,
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxTokens ?? 4096,
          ...(useJsonMode ? { response_format: { type: 'json_object' as const } } : {}),
          ...extraParams(cfg),
        });
        text = res.choices[0]?.message?.content ?? '';
        const parsed = schema.safeParse(extractJson(text));
        if (parsed.success) {
          return { data: parsed.data, provider: cfg.id, model, latencyMs: Date.now() - started };
        }
        const issues = parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        warn(options.feature, cfg, model, `schema mismatch (${issues})`);
        convo = [
          ...messages,
          { role: 'assistant', content: text.slice(0, 6000) },
          {
            role: 'user',
            content: `That JSON did not match the required schema (${issues}). Reply again with ONLY the corrected JSON object.`,
          },
        ];
      } catch (err) {
        if (err instanceof APIError && err.status === 400 && useJsonMode) {
          useJsonMode = false; // provider/model doesn't support response_format
          continue;
        }
        if (err instanceof SyntaxError) {
          warn(options.feature, cfg, model, 'output was not JSON');
          convo = [
            ...messages,
            { role: 'assistant', content: text.slice(0, 6000) },
            { role: 'user', content: 'Reply with ONLY a single valid JSON object — no prose, no markdown.' },
          ];
          continue;
        }
        warn(options.feature, cfg, model, describeError(err));
        break; // network / auth / timeout → next provider
      }
    }
  }
  return null;
}

/** Strips `<think>…</think>` spans from a token stream, even when tags are split across chunks. */
export class ThinkFilter {
  private buffer = '';
  private inThink = false;

  push(chunk: string): string {
    this.buffer += chunk;
    let out = '';
    for (;;) {
      if (this.inThink) {
        const end = this.buffer.indexOf('</think>');
        if (end === -1) {
          this.buffer = this.buffer.slice(-8);
          return out;
        }
        this.buffer = this.buffer.slice(end + '</think>'.length);
        this.inThink = false;
        continue;
      }
      const start = this.buffer.indexOf('<think>');
      if (start === -1) {
        // Hold back a possible partial "<think" at the end of the buffer.
        const lt = this.buffer.lastIndexOf('<');
        const holdFrom = lt !== -1 && '<think>'.startsWith(this.buffer.slice(lt)) ? lt : this.buffer.length;
        out += this.buffer.slice(0, holdFrom);
        this.buffer = this.buffer.slice(holdFrom);
        return out;
      }
      out += this.buffer.slice(0, start);
      this.buffer = this.buffer.slice(start + '<think>'.length);
      this.inThink = true;
    }
  }

  flush(): string {
    const rest = this.inThink ? '' : this.buffer;
    this.buffer = '';
    return rest;
  }
}

export type StreamChunk =
  | { type: 'start'; provider: AiProviderId; model: string }
  | { type: 'text'; text: string }
  | { type: 'error'; message: string };

/**
 * Streams a chat reply. Falls through the chain until a provider produces its first token;
 * a failure after that ends the stream with an `error` chunk. Yields nothing if no provider answers.
 */
export async function* streamChat(
  messages: ChatMessage[],
  options: LlmOptions
): AsyncGenerator<StreamChunk> {
  for (const { cfg, model } of providerChainFor(options)) {
    let started = false;
    const filter = new ThinkFilter();
    try {
      const stream = await clientFor(cfg).chat.completions.create({
        model,
        messages,
        stream: true,
        temperature: options.temperature ?? 0.6,
        max_tokens: options.maxTokens ?? 2048,
        ...extraParams(cfg),
      });
      for await (const chunk of stream) {
        const raw = chunk.choices[0]?.delta?.content;
        if (!raw) continue;
        const text = filter.push(raw);
        if (!text) continue;
        if (!started) {
          started = true;
          yield { type: 'start', provider: cfg.id, model };
        }
        yield { type: 'text', text };
      }
      const tail = filter.flush();
      if (tail) {
        if (!started) {
          started = true;
          yield { type: 'start', provider: cfg.id, model };
        }
        yield { type: 'text', text: tail };
      }
      if (started) return;
      warn(options.feature, cfg, model, 'empty response');
    } catch (err) {
      if (started) {
        yield { type: 'error', message: `Stream interrupted (${cfg.id}).` };
        return;
      }
      warn(options.feature, cfg, model, describeError(err));
    }
  }
}

/** Quick reachability probe for `/api/health?probe=1` (lists models with a short timeout). */
export async function probeProvider(cfg: ProviderConfig): Promise<boolean> {
  try {
    const client = new OpenAI({
      apiKey: cfg.apiKey || 'not-needed',
      baseURL: cfg.baseUrl,
      timeout: 4000,
      maxRetries: 0,
    });
    await client.models.list();
    return true;
  } catch {
    return false;
  }
}
