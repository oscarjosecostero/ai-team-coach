import type { Db } from '../db/client.js';
import { auditLog } from '../db/schema.js';

export type NewAuditEntry = typeof auditLog.$inferInsert;

/** Append-only (a DB trigger rejects UPDATE/DELETE). */
export const auditRepo = {
  async append(db: Db, entry: NewAuditEntry): Promise<void> {
    await db.insert(auditLog).values(entry);
  },
};
