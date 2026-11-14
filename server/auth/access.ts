/**
 * ARGUS — Access rules (specs/05-data-platform.md §6). Every health-data route goes through these.
 */
import type { SessionUser } from './types';

/** Vitals, analytics, check-ins and chat of one astronaut. */
export function canReadAstronaut(user: SessionUser | null, astronautId: string): boolean {
  if (!user) return false;
  if (user.role === 'flight_surgeon') return true;
  return user.astronautId === astronautId;
}

/** Legal name and medical notes. Same rule as health data: self or flight surgeon. */
export const canReadPrivate = canReadAstronaut;

/** Add, edit and archive astronaut profiles. */
export function canManageRoster(user: SessionUser | null): boolean {
  return user?.role === 'admin' || user?.role === 'flight_surgeon';
}

export function canManageUsers(user: SessionUser | null): boolean {
  return user?.role === 'admin';
}
