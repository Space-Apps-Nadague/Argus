/**
 * ARGUS — Users tab, admin only (specs/02-ui-dashboard.md §6)
 * Create crew/admin accounts, reset passwords, delete accounts.
 */

import React, { useState } from 'react';
import { KeyRound, ShieldCheck, Trash2, UserPlus, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useMission } from '../context/MissionContext';
import { AuthError } from '../auth/authStore';
import type { UserRole } from '../types/argus';
import { Card } from './ui/Card';

export const UsersTab: React.FC = () => {
  const { users, currentUser, addAccount, changePassword, removeAccount, minPasswordLength, mode } = useAuth();
  const { crewRoster } = useMission();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('astronaut');
  const [crewId, setCrewId] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState('');

  const linkedCrew = new Set(users.filter((u) => u.crewId).map((u) => u.crewId));
  const crewName = (id?: string) => crewRoster.find((c) => c.id === id);

  const run = async (fn: () => Promise<void> | void, success: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: success });
      return true;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof AuthError ? err.message : 'Something went wrong.' });
      return false;
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(
      () => addAccount({ username, password, role, crewId: role === 'astronaut' ? crewId : undefined }),
      `Account "${username.trim()}" created.`
    );
    if (ok) {
      setUsername('');
      setPassword('');
      setCrewId('');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card title={`Accounts (${users.length})`} icon={<UserRound className="h-4 w-4" />} bodyClassName="px-2 pb-2">
        <ul className="divide-y divide-hud-line">
          {users.map((u) => {
            const crew = crewName(u.crewId);
            return (
              <li key={u.id} className="px-2 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  {u.role === 'admin' ? (
                    <ShieldCheck className="h-5 w-5 text-hud-accent" aria-hidden="true" />
                  ) : (
                    <UserRound className="h-5 w-5 text-hud-muted" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-hud-text">
                      {u.username}
                      {u.id === currentUser?.id && <span className="ml-2 text-[11px] font-normal text-hud-muted">(you)</span>}
                    </div>
                    <div className="text-xs text-hud-muted">
                      {u.role === 'admin'
                        ? mode === 'server'
                          ? 'Admin · manages accounts and roster'
                          : 'Admin · sees all crew'
                        : u.role === 'flight_surgeon'
                          ? 'Flight surgeon · sees all crew'
                          : crew
                            ? `Astronaut · ${crew.callsign}${crew.name !== crew.callsign ? ` (${crew.name})` : ''}`
                            : 'Astronaut · crew member archived'}
                      {u.disabled && ' · disabled'}
                    </div>
                  </div>
                  <button type="button" className="hud-btn" onClick={() => setResetFor(resetFor === u.id ? null : u.id)}>
                    <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                    Reset password
                  </button>
                  {u.id !== currentUser?.id && (
                    <button
                      type="button"
                      className="hud-btn hover:border-red-500/60 hover:text-red-200"
                      onClick={() => {
                        if (window.confirm(`Delete account "${u.username}"? This cannot be undone.`)) {
                          void run(() => removeAccount(u.id), `Account "${u.username}" deleted.`);
                        }
                      }}
                      aria-label={`Delete account ${u.username}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {resetFor === u.id && (
                  <form
                    className="mt-2 flex flex-wrap items-end gap-2 pl-8"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await run(() => changePassword(u.id, resetPw), `Password for "${u.username}" updated.`)) {
                        setResetFor(null);
                        setResetPw('');
                      }
                    }}
                  >
                    <label className="min-w-[200px] flex-1">
                      <span className="mb-1 block text-xs text-hud-muted">New password</span>
                      <input type="password" className="hud-input" value={resetPw} onChange={(e) => setResetPw(e.target.value)} autoComplete="new-password" />
                    </label>
                    <button type="submit" className="hud-btn">Save</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="New account" icon={<UserPlus className="h-4 w-4" />}>
        <form className="space-y-3" onSubmit={create}>
          <div className="flex rounded-lg border border-hud-line p-0.5" role="group" aria-label="Account type">
            <button type="button" className="hud-seg flex-1" aria-pressed={role === 'astronaut'} onClick={() => setRole('astronaut')}>
              Astronaut
            </button>
            {mode === 'server' && (
              <button type="button" className="hud-seg flex-1" aria-pressed={role === 'flight_surgeon'} onClick={() => setRole('flight_surgeon')}>
                Flight surgeon
              </button>
            )}
            <button type="button" className="hud-seg flex-1" aria-pressed={role === 'admin'} onClick={() => setRole('admin')}>
              Admin
            </button>
          </div>
          {role === 'astronaut' && (
            <label className="block">
              <span className="mb-1 block text-xs text-hud-muted">Astronaut</span>
              <select className="hud-input font-sans" value={crewId} onChange={(e) => setCrewId(e.target.value)} required>
                <option value="">Choose a crew member…</option>
                {crewRoster.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.callsign} · {c.name}
                    {linkedCrew.has(c.id) ? ' (has an account)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs text-hud-muted">Username</span>
            <input className="hud-input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-hud-muted">Password (min {minPasswordLength} characters)</span>
            <input type="password" className="hud-input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          </label>
          <button type="submit" className="hud-btn-primary w-full">
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Create account
          </button>
          {message && (
            <p role={message.ok ? 'status' : 'alert'} className={`text-xs ${message.ok ? 'text-status-green' : 'text-status-red'}`}>
              {message.text}
            </p>
          )}
          <p className="text-[11px] text-hud-muted">
            {mode === 'server'
              ? 'Astronauts see only their own data; flight surgeons see all crew; admins manage accounts. Passwords are stored hashed (argon2id) on the ARGUS server. Share them in person.'
              : 'Offline demo: astronauts only see their own data. Passwords are stored hashed in this browser. Share them in person.'}
          </p>
        </form>
      </Card>
    </div>
  );
};
