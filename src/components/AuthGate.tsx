/**
 * ARGUS — Sign-in gate (specs/02-ui-dashboard.md §6)
 * First run: create the admin account. Afterwards: username + password sign-in.
 */

import React, { useState } from 'react';
import { Activity, LogIn, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthError } from '../auth/authStore';

const Field: React.FC<{
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}> = ({ id, label, type = 'text', value, onChange, autoComplete }) => (
  <label htmlFor={id} className="block">
    <span className="mb-1 block text-xs text-hud-muted">{label}</span>
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      required
      className="hud-input"
    />
  </label>
);

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, needsSetup, setupAdmin, login, minPasswordLength, mode } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (currentUser) return <>{children}</>;
  if (mode === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-hud-bg text-xs text-hud-muted" role="status">
        Connecting to ARGUS…
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (needsSetup && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      if (needsSetup) await setupAdmin(username, password);
      else await login(username, password);
      setPassword('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-hud-bg px-4 text-hud-text hud-grid-bg">
      <form onSubmit={submit} className="hud-card w-full max-w-sm space-y-4 p-6" aria-labelledby="auth-title">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-hud-accent/40 bg-hud-accent/10">
            <Activity className="h-5 w-5 text-hud-accent" aria-hidden="true" />
          </span>
          <div>
            <h1 id="auth-title" className="font-display text-lg font-bold tracking-[0.2em]">
              ARGUS
            </h1>
            <p className="text-xs text-hud-muted">{needsSetup ? 'Create the admin account' : 'Sign in'}</p>
          </div>
        </div>

        {needsSetup && (
          <p className="flex gap-2 rounded-lg border border-hud-accent/30 bg-hud-accent/5 p-2.5 text-xs text-hud-muted">
            <ShieldCheck className="h-4 w-4 shrink-0 text-hud-accent" aria-hidden="true" />
            First run on this device. The admin can see every astronaut and create their accounts.
          </p>
        )}

        <Field id="auth-user" label="Username" value={username} onChange={setUsername} autoComplete="username" />
        <Field
          id="auth-pass"
          label={needsSetup ? `Password (min ${minPasswordLength} characters)` : 'Password'}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={needsSetup ? 'new-password' : 'current-password'}
        />
        {needsSetup && (
          <Field
            id="auth-confirm"
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
        )}

        {error && (
          <p role="alert" className="text-xs text-status-red">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="hud-btn-primary w-full">
          <LogIn className="h-4 w-4" aria-hidden="true" />
          {busy ? 'Checking…' : needsSetup ? 'Create admin & sign in' : 'Sign in'}
        </button>

        <p className="text-[11px] leading-relaxed text-hud-muted">
          {mode === 'server'
            ? 'Signed in on the ARGUS server. Astronauts see only their own data.'
            : 'Offline demo: accounts are stored in this browser only. This is not server-side security.'}
        </p>
      </form>
    </div>
  );
};
