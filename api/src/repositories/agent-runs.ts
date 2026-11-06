import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agentRuns } from '../db/schema.js';

export type AgentRunRow = typeof agentRuns.$inferSelect;
export type AgentRunKind = AgentRunRow['kind'];

export const agentRunsRepo = {
  async start(db: Db, v: { userId: string; kind: AgentRunKind; trigger: string; model: string }): Promise<AgentRunRow> {
    const [row] = await db.insert(agentRuns).values({ ...v, status: 'running' }).returning();
    return row!;
  },

  async finish(
    db: Db,
    id: string,
    v: { status: 'succeeded' | 'failed'; toolTrace: unknown; inputTokens: number; outputTokens: number; cacheReadTokens: number; error?: string | null; finishedAt: Date },
  ): Promise<AgentRunRow> {
    const [row] = await db.update(agentRuns).set(v).where(eq(agentRuns.id, id)).returning();
    return row!;
  },

  async getById(db: Db, id: string): Promise<AgentRunRow | null> {
    const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, id));
    return row ?? null;
  },

  async listByIds(db: Db, ids: string[]): Promise<AgentRunRow[]> {
    if (ids.length === 0) return [];
    return db.select().from(agentRuns).where(inArray(agentRuns.id, ids));
  },

  async listForUser(db: Db, userId: string, limit: number): Promise<AgentRunRow[]> {
    return db.select().from(agentRuns).where(eq(agentRuns.userId, userId)).orderBy(desc(agentRuns.startedAt)).limit(limit);
  },

  /** Used to debounce automatic post-activity analysis to one successful run per athlete per day. */
  async hasSucceededSince(db: Db, userId: string, kind: AgentRunKind, since: Date): Promise<boolean> {
    const [row] = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.userId, userId), eq(agentRuns.kind, kind), eq(agentRuns.status, 'succeeded'), gte(agentRuns.startedAt, since)))
      .limit(1);
    return Boolean(row);
  },
};
