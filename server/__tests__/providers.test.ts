import { describe, expect, it } from 'vitest';
import { describeProvider, detectProviderFromKey, resolveProviderChain } from '../ai/providers';
import { providerChainFor } from '../ai/llm';

describe('detectProviderFromKey', () => {
  it('detects providers by key prefix', () => {
    expect(detectProviderFromKey('sk-or-v1-abc')).toBe('openrouter');
    expect(detectProviderFromKey('AIzaSyXYZ')).toBe('gemini');
    expect(detectProviderFromKey('gsk_123')).toBe('groq');
    expect(detectProviderFromKey('something-else')).toBe('custom');
  });
});

describe('resolveProviderChain', () => {
  it('is empty when nothing is configured', () => {
    expect(resolveProviderChain({})).toEqual([]);
  });

  it('builds a local-first chain with cloud fallback', () => {
    const chain = resolveProviderChain({
      AI_PROVIDERS: 'local,openrouter',
      AI_LOCAL_MODEL: 'qwen3:8b',
      OPENROUTER_API_KEY: 'sk-or-test',
    });
    expect(chain.map((c) => c.id)).toEqual(['local', 'openrouter']);
    expect(chain[0]).toMatchObject({ baseUrl: 'http://localhost:11434/v1', model: 'qwen3:8b', isLocal: true });
    expect(chain[1]).toMatchObject({ model: 'openrouter/free', visionModel: 'openrouter/free' });
  });

  it('auto mode lists configured cloud providers then local', () => {
    const chain = resolveProviderChain({
      GEMINI_API_KEY: 'AIza-test',
      AI_LOCAL_MODEL: 'qwen3:8b',
    });
    expect(chain.map((c) => c.id)).toEqual(['gemini', 'local']);
  });

  it('skips providers that are missing a key or required model', () => {
    const chain = resolveProviderChain({ AI_PROVIDERS: 'groq,openrouter,local', GROQ_API_KEY: 'gsk_x' });
    expect(chain).toEqual([]); // groq needs GROQ_MODEL, openrouter needs a key, local needs a model
  });

  it('routes a generic AI_API_KEY to its provider by prefix', () => {
    const chain = resolveProviderChain({ AI_API_KEY: 'sk-or-generic', AI_MODEL: 'meta/some-model:free' });
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({ id: 'openrouter', model: 'meta/some-model:free', apiKey: 'sk-or-generic' });
  });

  it('supports a custom OpenAI-compatible endpoint (e.g. a hosted agent gateway)', () => {
    const chain = resolveProviderChain({
      AI_PROVIDERS: 'custom',
      AI_API_KEY: 'gw-123',
      AI_BASE_URL: 'https://agents.example.test/v1',
      AI_MODEL: 'argus-agent',
    });
    expect(chain[0]).toMatchObject({ id: 'custom', baseUrl: 'https://agents.example.test/v1', model: 'argus-agent' });
  });

  it('honours per-feature routes', () => {
    const env = {
      AI_PROVIDERS: 'openrouter,local',
      AI_ROUTE_CHAT: 'local',
      AI_LOCAL_MODEL: 'qwen3:8b',
      OPENROUTER_API_KEY: 'sk-or-x',
    };
    expect(resolveProviderChain(env, { feature: 'chat' }).map((c) => c.id)).toEqual(['local']);
    expect(resolveProviderChain(env, { feature: 'diagnostics' }).map((c) => c.id)).toEqual(['openrouter', 'local']);
  });

  it('puts a HUD-supplied key first for that request', () => {
    const chain = resolveProviderChain(
      { AI_PROVIDERS: 'local', AI_LOCAL_MODEL: 'qwen3:8b' },
      { keyOverride: 'AIza-from-hud' }
    );
    expect(chain.map((c) => c.id)).toEqual(['gemini', 'local']);
  });

  it('never exposes keys in the public description', () => {
    const [cfg] = resolveProviderChain({ OPENROUTER_API_KEY: 'sk-or-secret' });
    const info = describeProvider(cfg);
    expect(JSON.stringify(info)).not.toContain('sk-or-secret');
    expect(info.hasKey).toBe(true);
  });

  it('appends gemini-3.5-flash-lite as fallback after gemini-3.8-flash', () => {
    const entries = providerChainFor({
      feature: 'chat',
      env: { GEMINI_API_KEY: 'AIza-test' },
    });
    expect(entries.map((e) => `${e.cfg.id}:${e.model}`)).toEqual([
      'gemini:gemini-3.8-flash',
      'gemini:gemini-3.5-flash-lite',
    ]);
  });
});
