/**
 * ARGUS — Password hashing (specs/05-data-platform.md §6)
 * Source: SRC-060 (OWASP Password Storage Cheat Sheet: argon2id m=19 MiB, t=2, p=1)
 */

import { hash, verify } from '@node-rs/argon2';

export const MIN_PASSWORD_LENGTH = 10;

const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function validatePassword(password: string): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 256) return 'Password is too long.';
  return null;
}

export function validateUsername(username: string): string | null {
  const u = (username ?? '').trim();
  if (u.length < 3 || u.length > 32) return 'Username must be 3–32 characters.';
  if (!/^[a-zA-Z0-9._-]+$/.test(u)) return 'Use letters, numbers, dots, dashes or underscores.';
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Hash of a random string, verified against when the username does not exist (equal timing). */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(`dummy-${Math.random()}`);
  return dummyHash;
}
