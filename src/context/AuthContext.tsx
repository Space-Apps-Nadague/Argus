/**
 * ARGUS — Auth context (specs/02-ui-dashboard.md §6, specs/05-data-platform.md §6)
 *
 * Two modes, chosen at start-up from `GET /api/auth/me`:
 * - `server`: the ARGUS server has a database. Accounts, sessions (HttpOnly cookie) and roles live on the
 *   server; the browser stores nothing about them.
 * - `local`: no database or server unreachable (offline demo). Falls back to browser-stored accounts
 *   (`src/auth/authStore.ts`) so the HUD still works on a single device.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { UserAccount, UserRole } from '../types/argus';
import {
  type AccountStorage,
  AuthError,
  browserAccountStorage,
  createAccount,
  deleteAccount,
  deleteAccountsForCrew,
  type LocalUserAccount,
  MIN_PASSWORD_LENGTH as LOCAL_MIN_PASSWORD_LENGTH,
  type NewAccount,
  publicAccount,
  resetPassword,
  SESSION_STORAGE_KEY,
  verifyLogin,
} from '../auth/authStore';
import { adminApi, authApi, DataApiError, fetchMe } from '../services/dataApi';

export type AuthMode = 'loading' | 'server' | 'local';

interface AuthContextValue {
  mode: AuthMode;
  users: UserAccount[];
  currentUser: UserAccount | null;
  needsSetup: boolean;
  minPasswordLength: number;
  /** Account management (Users tab). */
  isAdmin: boolean;
  /** Sees every crew member (crew strip, all data). */
  seesAllCrew: boolean;
  /** The only astronaut this user may see (astronauts, and server admins linked to a profile). */
  lockedCrewId?: string;
  /** Add / archive crew members (Crew tab, Add crew). */
  canManageRoster: boolean;
  /** Health tabs. On the server, a plain admin manages accounts only and sees no medical data. */
  canViewHealth: boolean;
  setupAdmin: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  addAccount: (input: NewAccount) => Promise<void>;
  changePassword: (userId: string, password: string) => Promise<void>;
  removeAccount: (userId: string) => Promise<void>;
  removeAccountsForCrew: (crewId: string) => void;
  refreshUsers: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function loadSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveSession(userId: string | null) {
  try {
    if (userId) sessionStorage.setItem(SESSION_STORAGE_KEY, userId);
    else sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // session lasts for this page only
  }
}

/** Server errors surface in the same `AuthError` the forms already display. */
async function asAuthError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DataApiError) throw new AuthError(err.message);
    throw err;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode; storage?: AccountStorage; forceMode?: 'server' | 'local' }> = ({
  children,
  storage = browserAccountStorage,
  forceMode,
}) => {
  const [mode, setMode] = useState<AuthMode>(forceMode === 'local' ? 'local' : 'loading');

  // ── local (offline demo) state ──
  const [localUsers, setLocalUsers] = useState<LocalUserAccount[]>(() => storage.load());
  const [sessionUserId, setSessionUserId] = useState<string | null>(() => loadSession());
  useEffect(() => {
    if (mode === 'local') storage.save(localUsers);
  }, [localUsers, storage, mode]);
  useEffect(() => {
    if (mode === 'local') saveSession(sessionUserId);
  }, [sessionUserId, mode]);

  // ── server state ──
  const [serverUser, setServerUser] = useState<UserAccount | null>(null);
  const [serverUsers, setServerUsers] = useState<UserAccount[]>([]);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [serverMinPw, setServerMinPw] = useState(10);

  useEffect(() => {
    if (forceMode === 'local') return;
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        if (!me) {
          setMode('local');
          return;
        }
        setServerUser(me.user);
        setSetupNeeded(me.setupNeeded);
        setServerMinPw(me.minPasswordLength);
        setMode('server');
      })
      .catch(() => !cancelled && setMode('local'));
    return () => {
      cancelled = true;
    };
  }, [forceMode]);

  const refreshUsers = useCallback(async () => {
    if (mode !== 'server' || serverUser?.role !== 'admin') return;
    const { users } = await adminApi.listUsers();
    setServerUsers(users);
  }, [mode, serverUser]);

  useEffect(() => {
    void refreshUsers().catch(() => {});
  }, [refreshUsers]);

  const localCurrent = useMemo(() => localUsers.find((u) => u.id === sessionUserId) ?? null, [localUsers, sessionUserId]);
  const currentUser: UserAccount | null = mode === 'server' ? serverUser : localCurrent ? publicAccount(localCurrent) : null;
  const users: UserAccount[] = mode === 'server' ? serverUsers : localUsers.map(publicAccount);

  const setupAdmin = useCallback(
    async (username: string, password: string) => {
      if (mode === 'server') {
        const { user } = await asAuthError(() => authApi.setup(username, password));
        setServerUser(user);
        setSetupNeeded(false);
        return;
      }
      const next = await createAccount(localUsers, { username, password, role: 'admin' });
      setLocalUsers(next);
      setSessionUserId(next[next.length - 1].id);
    },
    [mode, localUsers]
  );

  const login = useCallback(
    async (username: string, password: string) => {
      if (mode === 'server') {
        const { user } = await asAuthError(() => authApi.login(username, password));
        setServerUser(user);
        return;
      }
      const user = await verifyLogin(localUsers, username, password);
      setSessionUserId(user.id);
    },
    [mode, localUsers]
  );

  const logout = useCallback(() => {
    if (mode === 'server') {
      void authApi.logout().catch(() => {});
      setServerUser(null);
      setServerUsers([]);
      return;
    }
    setSessionUserId(null);
  }, [mode]);

  const addAccount = useCallback(
    async (input: NewAccount) => {
      if (mode === 'server') {
        await asAuthError(() => adminApi.createUser(input));
        await refreshUsers();
        return;
      }
      setLocalUsers(await createAccount(localUsers, input));
    },
    [mode, localUsers, refreshUsers]
  );

  const changePassword = useCallback(
    async (userId: string, password: string) => {
      if (mode === 'server') {
        await asAuthError(() => adminApi.updateUser(userId, { password }));
        return;
      }
      setLocalUsers(await resetPassword(localUsers, userId, password));
    },
    [mode, localUsers]
  );

  const removeAccount = useCallback(
    async (userId: string) => {
      if (mode === 'server') {
        await asAuthError(() => adminApi.deleteUser(userId));
        await refreshUsers();
        return;
      }
      if (!currentUser) return;
      setLocalUsers(deleteAccount(localUsers, userId, currentUser.id));
    },
    [mode, localUsers, currentUser, refreshUsers]
  );

  const removeAccountsForCrew = useCallback(
    (crewId: string) => {
      // On the server, archiving a crew member keeps their accounts and history (spec 05 §3.2).
      if (mode === 'local') setLocalUsers((prev) => deleteAccountsForCrew(prev, crewId));
    },
    [mode]
  );

  const role: UserRole | undefined = currentUser?.role;
  const isAdmin = role === 'admin';
  const value: AuthContextValue = {
    mode,
    users,
    currentUser,
    needsSetup: mode === 'server' ? setupNeeded : localUsers.length === 0,
    minPasswordLength: mode === 'server' ? serverMinPw : LOCAL_MIN_PASSWORD_LENGTH,
    isAdmin,
    seesAllCrew: role === 'flight_surgeon' || (isAdmin && mode === 'local'),
    lockedCrewId:
      role === 'astronaut' || (mode === 'server' && isAdmin && currentUser?.crewId) ? currentUser?.crewId : undefined,
    canManageRoster: isAdmin || role === 'flight_surgeon',
    canViewHealth: !(mode === 'server' && isAdmin && !currentUser?.crewId),
    setupAdmin,
    login,
    logout,
    addAccount,
    changePassword,
    removeAccount,
    removeAccountsForCrew,
    refreshUsers,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
