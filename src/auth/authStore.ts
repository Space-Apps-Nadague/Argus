/**
 * ARGUS — Local user accounts (specs/01-data-schema.md §9, specs/02-ui-dashboard.md §6)
 *
 * Accounts live in the browser so each astronaut gets their own view on a shared device.
 * Passwords are PBKDF2-SHA256 hashed with a per-user salt. This is NOT server-side security:
 * anyone with access to the browser's storage can edit it. To move accounts to the backend
 * later, swap the `AccountStorage` implementation and keep this module's API.
 */

import type { UserAccount, UserRole } from '../types/argus';

export const USERS_STORAGE_KEY = 'argus_users_v1';
export const SESSION_STORAGE_KEY = 'argus_session_v1';
export const MIN_PASSWORD_LENGTH = 6;
const PBKDF2_ITERATIONS = 100_000;

export interface AccountStorage {
  load(): UserAccount[];
  save(users: UserAccount[]): void;
}

export const browserAccountStorage: AccountStorage = {
  load() {
    try {
      const raw = localStorage.getItem(USERS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
  save(users) {
    try {
      localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
    } catch {
      // storage unavailable (private mode): accounts last for this page only
    }
  },
};

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

const toHex = (buf: ArrayBuffer | Uint8Array) =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return toHex(bits);
}

/** Constant-time string comparison for equal-length hex digests. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string): string | null {
  const u = username.trim();
  if (u.length < 3 || u.length > 32) return 'Username must be 3–32 characters.';
  if (!/^[a-zA-Z0-9._-]+$/.test(u)) return 'Use letters, numbers, dots, dashes or underscores.';
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}

export function findUser(users: UserAccount[], username: string): UserAccount | undefined {
  const key = normalizeUsername(username);
  return users.find((u) => normalizeUsername(u.username) === key);
}

export interface NewAccount {
  username: string;
  password: string;
  role: UserRole;
  crewId?: string;
}

export async function createAccount(users: UserAccount[], input: NewAccount): Promise<UserAccount[]> {
  const uErr = validateUsername(input.username);
  if (uErr) throw new AuthError(uErr);
  const pErr = validatePassword(input.password);
  if (pErr) throw new AuthError(pErr);
  if (findUser(users, input.username)) throw new AuthError('That username is already taken.');
  if (input.role === 'crew' && !input.crewId) throw new AuthError('Pick the crew member this account belongs to.');

  const salt = randomHex(16);
  const account: UserAccount = {
    id: `u-${randomHex(6)}`,
    username: input.username.trim(),
    role: input.role,
    crewId: input.role === 'crew' ? input.crewId : input.crewId || undefined,
    passwordHash: await hashPassword(input.password, salt),
    salt,
    createdAtIso: new Date().toISOString(),
  };
  return [...users, account];
}

export async function verifyLogin(
  users: UserAccount[],
  username: string,
  password: string
): Promise<UserAccount> {
  const user = findUser(users, username);
  // Hash even when the user is missing so timing doesn't reveal which usernames exist.
  const hash = await hashPassword(password, user?.salt ?? 'no-such-user');
  if (!user || !safeEqual(hash, user.passwordHash)) {
    throw new AuthError('Wrong username or password.');
  }
  return user;
}

export async function resetPassword(users: UserAccount[], userId: string, password: string): Promise<UserAccount[]> {
  const pErr = validatePassword(password);
  if (pErr) throw new AuthError(pErr);
  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt);
  if (!users.some((u) => u.id === userId)) throw new AuthError('Account not found.');
  return users.map((u) => (u.id === userId ? { ...u, salt, passwordHash } : u));
}

export function deleteAccount(users: UserAccount[], userId: string, actingUserId: string): UserAccount[] {
  if (userId === actingUserId) throw new AuthError("You can't delete your own account.");
  const target = users.find((u) => u.id === userId);
  if (!target) throw new AuthError('Account not found.');
  if (target.role === 'admin' && users.filter((u) => u.role === 'admin').length <= 1) {
    throw new AuthError('Keep at least one admin account.');
  }
  return users.filter((u) => u.id !== userId);
}

/** Removes crew accounts linked to a deleted crew member. */
export function deleteAccountsForCrew(users: UserAccount[], crewId: string): UserAccount[] {
  return users.filter((u) => !(u.role === 'crew' && u.crewId === crewId));
}

/** Public view of an account (no hash or salt) for UI lists. */
export function publicAccount(u: UserAccount): Omit<UserAccount, 'passwordHash' | 'salt'> {
  const { passwordHash: _h, salt: _s, ...rest } = u;
  return rest;
}
