/**
 * ARGUS — Auth context (specs/02-ui-dashboard.md §6)
 * Wraps `src/auth/authStore.ts` with React state, the session, and admin actions.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { UserAccount } from '../types/argus';
import {
  type AccountStorage,
  browserAccountStorage,
  createAccount,
  deleteAccount,
  deleteAccountsForCrew,
  type NewAccount,
  resetPassword,
  SESSION_STORAGE_KEY,
  verifyLogin,
} from '../auth/authStore';

interface AuthContextValue {
  users: UserAccount[];
  currentUser: UserAccount | null;
  needsSetup: boolean;
  isAdmin: boolean;
  setupAdmin: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  addAccount: (input: NewAccount) => Promise<void>;
  changePassword: (userId: string, password: string) => Promise<void>;
  removeAccount: (userId: string) => void;
  removeAccountsForCrew: (crewId: string) => void;
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

export const AuthProvider: React.FC<{ children: React.ReactNode; storage?: AccountStorage }> = ({
  children,
  storage = browserAccountStorage,
}) => {
  const [users, setUsers] = useState<UserAccount[]>(() => storage.load());
  const [sessionUserId, setSessionUserId] = useState<string | null>(() => loadSession());

  useEffect(() => storage.save(users), [users, storage]);
  useEffect(() => saveSession(sessionUserId), [sessionUserId]);

  const currentUser = useMemo(
    () => users.find((u) => u.id === sessionUserId) ?? null,
    [users, sessionUserId]
  );

  const setupAdmin = useCallback(
    async (username: string, password: string) => {
      const next = await createAccount(users, { username, password, role: 'admin' });
      setUsers(next);
      setSessionUserId(next[next.length - 1].id);
    },
    [users]
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const user = await verifyLogin(users, username, password);
      setSessionUserId(user.id);
    },
    [users]
  );

  const logout = useCallback(() => setSessionUserId(null), []);

  const addAccount = useCallback(
    async (input: NewAccount) => setUsers(await createAccount(users, input)),
    [users]
  );

  const changePassword = useCallback(
    async (userId: string, password: string) => setUsers(await resetPassword(users, userId, password)),
    [users]
  );

  const removeAccount = useCallback(
    (userId: string) => {
      if (!currentUser) return;
      setUsers(deleteAccount(users, userId, currentUser.id));
    },
    [users, currentUser]
  );

  const removeAccountsForCrew = useCallback(
    (crewId: string) => setUsers((prev) => deleteAccountsForCrew(prev, crewId)),
    []
  );

  const value: AuthContextValue = {
    users,
    currentUser,
    needsSetup: users.length === 0,
    isAdmin: currentUser?.role === 'admin',
    setupAdmin,
    login,
    logout,
    addAccount,
    changePassword,
    removeAccount,
    removeAccountsForCrew,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
