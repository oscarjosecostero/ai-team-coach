import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chatMessages } from '../db/schema.js';

export type ChatMessageRow = typeof chatMessages.$inferSelect;

export const chatMessagesRepo = {
  async insert(db: Db, v: typeof chatMessages.$inferInsert): Promise<ChatMessageRow> {
    const [row] = await db.insert(chatMessages).values(v).returning();
    return row!;
  },

  /** The most recent `limit` messages, oldest first. */
  async listRecent(db: Db, userId: string, limit: number): Promise<ChatMessageRow[]> {
    const rows = await db.select().from(chatMessages).where(eq(chatMessages.userId, userId)).orderBy(desc(chatMessages.createdAt), desc(chatMessages.id)).limit(limit);
    return rows.reverse();
  },

  async listAll(db: Db, userId: string): Promise<ChatMessageRow[]> {
    return db.select().from(chatMessages).where(eq(chatMessages.userId, userId)).orderBy(asc(chatMessages.createdAt));
  },
};
