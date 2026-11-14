/**
 * ARGUS — Prompt privacy (specs/05-data-platform.md §6)
 * Legal name, exact age and medical notes go into prompts only when every provider that could
 * receive them is the local model. With `ai_consent = false`, no model is called at all.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { resolveProviderChain, resolveRoutes } from './providers';

export interface PromptPrivacy {
  /** Include identifying details (name, exact age, medical notes). */
  identity: boolean;
  /** Skip every provider: deterministic offline results only. */
  offlineOnly: boolean;
}

const store = new AsyncLocalStorage<PromptPrivacy>();

type Env = Record<string, string | undefined>;

export function chainIsLocalOnly(env: Env = process.env, keyOverride?: string): boolean {
  const chain = resolveProviderChain(env, { keyOverride });
  const routes = Object.values(resolveRoutes(env)).flat();
  return chain.every((p) => p.id === 'local') && routes.every((id) => id === 'local');
}

export function runWithPrivacy<T>(privacy: PromptPrivacy, fn: () => T): T {
  return store.run(privacy, fn);
}

export function currentPrivacy(): PromptPrivacy {
  return store.getStore() ?? { identity: chainIsLocalOnly(), offlineOnly: false };
}

/** "41" → "40s": coarse age for cloud prompts. */
export function ageBand(age: number): string {
  return `${Math.floor(age / 10) * 10}s`;
}
