/**
 * AI chat link (specs/05-data-platform.md §3.5): what was said to the AI, about which astronaut,
 * and the data the AI saw. Nothing more (no embeddings or analytics yet).
 */

import { asc, desc, eq } from 'drizzle-orm';
import type { CrewChatMessage } from '../../src/types/aiApi';
import type { Db } from './client';
import { conversations, messages, triageEvents } from './schema';

export async function latestConversationId(db: Db, astronautId: string): Promise<string | null> {
  const row = (
    await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.astronautId, astronautId))
      .orderBy(desc(conversations.startedAt))
      .limit(1)
  )[0];
  return row?.id ?? null;
}

export async function startConversation(db: Db, astronautId: string, userId: string | null): Promise<string> {
  const [row] = await db.insert(conversations).values({ astronautId, startedBy: userId }).returning({ id: conversations.id });
  return row.id;
}

export async function getOrStartConversation(db: Db, astronautId: string, userId: string | null): Promise<string> {
  return (await latestConversationId(db, astronautId)) ?? startConversation(db, astronautId, userId);
}

export async function latestTriageEventId(db: Db, astronautId: string): Promise<string | null> {
  const row = (
    await db
      .select({ id: triageEvents.id })
      .from(triageEvents)
      .where(eq(triageEvents.astronautId, astronautId))
      .orderBy(desc(triageEvents.ts))
      .limit(1)
  )[0];
  return row?.id ?? null;
}

export async function logMessage(db: Db, values: typeof messages.$inferInsert): Promise<void> {
  await db.insert(messages).values(values);
}

export async function conversationMessages(db: Db, conversationId: string, limit = 200): Promise<CrewChatMessage[]> {
  const rows = await db
    .select({ role: messages.role, content: messages.content, ts: messages.ts })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.ts))
    .limit(limit);
  return rows.map((r) => ({ role: r.role, content: r.content, timestampIso: r.ts.toISOString() }));
}
