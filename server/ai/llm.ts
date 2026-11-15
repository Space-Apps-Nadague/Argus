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
import type { CommTier } from '../../shared/commProfile';
import { type ProviderConfig, resolveProviderChain } from './providers';

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface LlmOptions {
  feature: AiFeature;
  keyOverride?: string;
  vision?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Comm tier; `autonomous` restricts the chain to the on-ship model. */
  tier?: CommTier;
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

export const GEMINI_QUOTA_FALLBACK_MODEL = 'gemini-3.5-flash-lite';

export function providerChainFor(options: LlmOptions): Array<{ cfg: ProviderConfig; model: string }> {
  if (currentPrivacy().offlineOnly) return []; // astronaut withdrew AI consent (spec 05 §6)
  const chain = resolveProviderChain(options.env ?? process.env, {
    feature: options.feature,
    keyOverride: options.keyOverride,
    tier: options.tier,
  });
  const out: Array<{ cfg: ProviderConfig; model: string }> = [];
  for (const cfg of chain) {
    const model = options.vision ? cfg.visionModel ?? '' : cfg.model;
    if (!model) continue;
    out.push({ cfg, model });
    if (cfg.id === 'gemini' && model !== GEMINI_QUOTA_FALLBACK_MODEL) {
      out.push({ cfg, model: GEMINI_QUOTA_FALLBACK_MODEL });
    }
  }
  return out;
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
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'error'; message: string };

export type ChatTool = OpenAI.Chat.Completions.ChatCompletionFunctionTool;

export interface StreamOptions extends LlmOptions {
  /** Function tools the model may call. Dropped automatically for models that reject them. */
  tools?: ChatTool[];
  /**
   * Runs a tool and returns its result for the model. When set, a turn that ends in tool
   * calls is continued (up to `maxToolRounds`) so the model can speak about the result.
   */
  executeTool?: (name: string, args: Record<string, unknown>) => Promise<unknown> | unknown;
  maxToolRounds?: number;
}

interface PendingToolCall {
  id: string;
  name: string;
  args: string;
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Streams a chat reply. Falls through the chain until a provider produces its first token
 * or tool call; a failure after that ends the stream with an `error` chunk. Yields nothing
 * if no provider answers.
 */
export async function* streamChat(
  messages: ChatMessage[],
  options: StreamOptions
): AsyncGenerator<StreamChunk> {
  for (const { cfg, model } of providerChainFor(options)) {
    let started = false;
    let useTools = Boolean(options.tools?.length);
    let convo = messages;
    const maxRounds = options.executeTool ? (options.maxToolRounds ?? 2) : 0;

    try {
      for (let round = 0; ; round++) {
        const filter = new ThinkFilter();
        const pending = new Map<number, PendingToolCall>();
        let roundText = '';
        let stream;
        try {
          stream = await clientFor(cfg).chat.completions.create({
            model,
            messages: convo,
            stream: true,
            temperature: options.temperature ?? 0.6,
            max_tokens: options.maxTokens ?? 2048,
            ...(useTools ? { tools: options.tools, tool_choice: 'auto' as const } : {}),
            ...extraParams(cfg),
          });
        } catch (err) {
          if (err instanceof APIError && err.status === 400 && useTools && !started) {
            useTools = false; // model/provider has no tool support: fast path still fires actions
            round--;
            continue;
          }
          throw err;
        }

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;
          for (const call of delta.tool_calls ?? []) {
            const slot = pending.get(call.index) ?? { id: '', name: '', args: '' };
            if (call.id) slot.id = call.id;
            if (call.function?.name) slot.name += call.function.name;
            if (call.function?.arguments) slot.args += call.function.arguments;
            pending.set(call.index, slot);
          }
          if (!delta.content) continue;
          const text = filter.push(delta.content);
          if (!text) continue;
          if (!started) {
            started = true;
            yield { type: 'start', provider: cfg.id, model };
          }
          roundText += text;
          yield { type: 'text', text };
        }
        const tail = filter.flush();
        if (tail) {
          if (!started) {
            started = true;
            yield { type: 'start', provider: cfg.id, model };
          }
          roundText += tail;
          yield { type: 'text', text: tail };
        }

        const calls = [...pending.values()].filter((call) => call.name);
        if (!calls.length) break;
        if (!started) {
          started = true;
          yield { type: 'start', provider: cfg.id, model };
        }
        const results: ChatMessage[] = [];
        for (const [i, call] of calls.entries()) {
          const id = call.id || `call_${round}_${i}`;
          call.id = id;
          const args = parseToolArgs(call.args);
          yield { type: 'tool_call', id, name: call.name, args };
          if (options.executeTool) {
            let result: unknown;
            try {
              result = await options.executeTool(call.name, args);
            } catch (err) {
              result = { ok: false, error: describeError(err) };
            }
            results.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(result ?? { ok: true }).slice(0, 4000) });
          }
        }
        if (round >= maxRounds || !options.executeTool) break;
        convo = [
          ...convo,
          {
            role: 'assistant',
            content: roundText || null,
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function' as const,
              function: { name: call.name, arguments: call.args || '{}' },
            })),
          },
          ...results,
        ];
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
