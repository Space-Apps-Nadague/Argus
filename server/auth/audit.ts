import type { Context } from 'hono';
import type { Db } from '../db/client';
import { auditLog } from '../db/schema';
import type { AppEnv } from './types';

export function clientIp(c: Context): string | undefined {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || undefined;
}

/** Append-only audit trail (spec 05 §3.1). Never throws: auditing must not break the request. */
export async function audit(
  c: Context<AppEnv>,
  entry: { action: string; targetType?: string; targetId?: string; detail?: unknown; actorUserId?: string | null },
  db: Db | null = c.get('db')
): Promise<void> {
  if (!db) return;
  try {
    await db.insert(auditLog).values({
      actorUserId: entry.actorUserId ?? c.get('user')?.id ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      detail: entry.detail ?? null,
      ip: clientIp(c),
    });
  } catch (err) {
    console.error('[ARGUS audit] failed to write', entry.action, err);
  }
}
