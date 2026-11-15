/**
 * ARGUS AI provider registry & fallback-chain resolution (specs/04-ai-backend.md §3).
 *
 * Every provider speaks the OpenAI-compatible Chat Completions API, so switching between a
 * local model, a free cloud tier, or a hosted agent gateway is configuration, not code.
 */

import type { CommTier } from '../../shared/commProfile';
import type { AiFeature, AiProviderId, AiProviderInfo } from '../../src/types/aiApi';

export interface ProviderConfig {
  id: AiProviderId;
  label: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  visionModel?: string;
  isLocal: boolean;
  timeoutMs: number;
  /** Optional `reasoning_effort` passed through (e.g. `none` to make local thinking models fast). */
  reasoningEffort?: string;
}

type Env = Record<string, string | undefined>;

interface ProviderDefaults {
  label: string;
  baseUrl: string;
  model: string;
  visionModel?: string;
  keyEnv?: string;
  prefix?: string;
}

export const PROVIDER_DEFAULTS: Record<Exclude<AiProviderId, 'custom'>, ProviderDefaults> = {
  local: {
    label: 'Local model (Ollama / LM Studio)',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
  },
  gemini: {
    label: 'Google Gemini (free tier)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-3.8-flash',
    visionModel: 'gemini-3.8-flash',
    keyEnv: 'GEMINI_API_KEY',
    prefix: 'AIza',
  },
  groq: {
    label: 'Groq (free tier)',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: '',
    keyEnv: 'GROQ_API_KEY',
    prefix: 'gsk_',
  },
};

const ENV_PREFIX: Record<AiProviderId, string> = {
  local: 'AI_LOCAL',
  gemini: 'GEMINI',
  groq: 'GROQ',
  custom: 'AI',
};

const CLOUD_ORDER: AiProviderId[] = ['custom', 'gemini', 'groq'];
const KNOWN_IDS: AiProviderId[] = ['local', 'gemini', 'groq', 'custom'];

const trimmed = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/** Detects the provider a key belongs to from its prefix (`AIza`, `gsk_`). */
export function detectProviderFromKey(key: string): AiProviderId {
  const k = key.trim();
  for (const id of ['gemini', 'groq'] as const) {
    const prefix = PROVIDER_DEFAULTS[id].prefix;
    if (prefix && k.startsWith(prefix)) return id;
  }
  return 'custom';
}

function timeoutFor(id: AiProviderId, env: Env): number {
  const specific = id === 'local' ? Number(env.AI_LOCAL_TIMEOUT_MS) : NaN;
  if (Number.isFinite(specific) && specific > 0) return specific;
  const general = Number(env.AI_TIMEOUT_MS);
  if (Number.isFinite(general) && general > 0) return general;
  return id === 'local' ? 180_000 : 60_000;
}

/** Builds one provider's config, or `null` if it isn't configured (missing key / model). */
export function buildProvider(
  id: AiProviderId,
  env: Env,
  keyOverride?: string
): ProviderConfig | null {
  const p = ENV_PREFIX[id];

  if (id === 'custom') {
    const genericKey = keyOverride ?? trimmed(env.AI_API_KEY);
    const baseUrl = trimmed(env.AI_BASE_URL);
    // A generic key with a known prefix is routed to that provider instead.
    if (!baseUrl && genericKey && detectProviderFromKey(genericKey) !== 'custom') {
      return buildProvider(detectProviderFromKey(genericKey), env, genericKey);
    }
    const model = trimmed(env.AI_MODEL);
    if (!baseUrl || !model) return null;
    return {
      id,
      label: 'Custom OpenAI-compatible endpoint',
      baseUrl,
      apiKey: genericKey,
      model,
      visionModel: trimmed(env.AI_VISION_MODEL),
      isLocal: /localhost|127\.0\.0\.1|\[::1\]/.test(baseUrl),
      timeoutMs: timeoutFor(id, env),
      reasoningEffort: trimmed(env.AI_REASONING_EFFORT),
    };
  }

  const d = PROVIDER_DEFAULTS[id];
  const genericKey = trimmed(env.AI_API_KEY);
  const specificKey = d.keyEnv ? trimmed(env[d.keyEnv]) : undefined;
  const genericMatches = Boolean(genericKey && d.prefix && genericKey.startsWith(d.prefix));
  const apiKey = keyOverride ?? specificKey ?? (genericMatches ? genericKey : undefined);

  if (id !== 'local' && !apiKey) return null;

  // `AI_MODEL` belongs to the generic `AI_API_KEY`; only apply it when that key is the one in use.
  const usingGenericKey = !specificKey && apiKey === genericKey;
  const model =
    trimmed(env[`${p}_MODEL`]) ??
    (id !== 'local' && usingGenericKey ? trimmed(env.AI_MODEL) : undefined) ??
    d.model;
  if (!model) return null;

  return {
    id,
    label: d.label,
    baseUrl: trimmed(env[`${p}_BASE_URL`]) ?? d.baseUrl,
    apiKey: id === 'local' ? 'ollama' : apiKey,
    model,
    visionModel: trimmed(env[`${p}_VISION_MODEL`]) ?? d.visionModel,
    isLocal: id === 'local',
    timeoutMs: timeoutFor(id, env),
    reasoningEffort: trimmed(env[`${p}_REASONING_EFFORT`]),
  };
}

function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function expand(ids: string[], env: Env): ProviderConfig[] {
  const out: ProviderConfig[] = [];
  const seen = new Set<string>();
  const push = (cfg: ProviderConfig | null) => {
    if (!cfg) return;
    const key = `${cfg.id}|${cfg.baseUrl}|${cfg.model}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cfg);
  };

  for (const id of ids) {
    if (id === 'auto') {
      for (const cloud of CLOUD_ORDER) push(buildProvider(cloud, env));
      push(buildProvider('local', env));
    } else if ((KNOWN_IDS as string[]).includes(id)) {
      push(buildProvider(id as AiProviderId, env));
    }
  }
  return out;
}

/**
 * Resolves the ordered provider chain for a feature.
 * `tier: 'autonomous'` forces the on-ship (local) provider only.
 * Otherwise precedence: `X-AI-Key` override (tried first) → `AI_ROUTE_<FEATURE>` → `AI_PROVIDERS` → `auto`.
 */
export function resolveProviderChain(
  env: Env,
  options: { feature?: AiFeature; keyOverride?: string; tier?: CommTier } = {}
): ProviderConfig[] {
  const route = options.feature
    ? parseList(env[`AI_ROUTE_${options.feature.toUpperCase()}`])
    : [];
  const configured = parseList(env.AI_PROVIDERS);
  const ids = route.length ? route : configured.length ? configured : ['auto'];
  const chain = expand(ids, env);

  // Deep space / blackout (specs/04-ai-backend.md §4.2): the on-ship model answers first.
  // Strict mode keeps everything on the ship; otherwise Earth models stand in when no
  // on-ship model is installed or reachable (the demo usually runs without one).
  if (options.tier === 'autonomous') {
    const local = buildProvider('local', env);
    if (onShipStrict(env)) return local ? [local] : [];
    const withOverride = (() => {
      const key = trimmed(options.keyOverride);
      const cfg = key ? buildProvider(detectProviderFromKey(key), env, key) : null;
      return cfg ? [cfg, ...chain.filter((c) => !(c.id === cfg.id && c.apiKey === cfg.apiKey))] : chain;
    })();
    return local ? [local, ...withOverride.filter((c) => c.id !== 'local')] : withOverride;
  }

  const override = trimmed(options.keyOverride);
  if (override) {
    const id = detectProviderFromKey(override);
    const cfg = buildProvider(id, env, override);
    if (cfg) {
      return [cfg, ...chain.filter((c) => !(c.id === cfg.id && c.apiKey === cfg.apiKey))];
    }
  }
  return chain;
}

/** `ARGUS_ONSHIP_STRICT=1`: the on-ship tier never uses Earth models or speech. */
export function onShipStrict(env: Env = process.env): boolean {
  return env.ARGUS_ONSHIP_STRICT?.trim() === '1';
}

/** Features that have their own `AI_ROUTE_<FEATURE>` chain. */
export function resolveRoutes(env: Env): Partial<Record<AiFeature, AiProviderId[]>> {
  const features: AiFeature[] = ['guidance', 'vision', 'diagnostics', 'recommendations', 'wellbeing', 'chat'];
  const routes: Partial<Record<AiFeature, AiProviderId[]>> = {};
  for (const f of features) {
    if (parseList(env[`AI_ROUTE_${f.toUpperCase()}`]).length) {
      routes[f] = resolveProviderChain(env, { feature: f }).map((c) => c.id);
    }
  }
  return routes;
}

/** Public, key-free description of a provider (safe to send to the browser). */
export function describeProvider(cfg: ProviderConfig): AiProviderInfo {
  return {
    id: cfg.id,
    label: cfg.label,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    visionModel: cfg.visionModel,
    hasKey: Boolean(cfg.apiKey) && !cfg.isLocal,
    isLocal: cfg.isLocal,
  };
}
