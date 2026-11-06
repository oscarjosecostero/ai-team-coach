import type { SessionUser } from '@coach/contracts';
import type { Db } from '../db/client.js';
import { unauthorized } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import { usersRepo, type UserRow } from '../repositories/users.js';

export const toSessionUser = (u: UserRow): SessionUser => ({ id: u.id, teamId: u.teamId, role: u.role, name: u.name, email: u.email });

// Verified against a throwaway hash when the email is unknown, so timing does not reveal which accounts exist.
const DUMMY_HASH = 'scrypt$00000000000000000000000000000000$' + '00'.repeat(64);

export async function login(db: Db, email: string, password: string): Promise<SessionUser> {
  const user = await usersRepo.findByEmail(db, email);
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid email or password');
  return toSessionUser(user);
}

/** One-click demo access. Only mounted when DEMO_LOGIN_ENABLED is true. */
export async function demoLogin(db: Db, email: string): Promise<SessionUser> {
  const user = await usersRepo.findByEmail(db, email);
  if (!user) throw unauthorized('Unknown demo account');
  return toSessionUser(user);
}

/** Re-reads the user on every request so role/team changes and deletions take effect immediately. */
export async function resolveSession(db: Db, userId: string): Promise<SessionUser | null> {
  const user = await usersRepo.findById(db, userId);
  return user ? toSessionUser(user) : null;
}

export async function listDemoAccounts(db: Db) {
  return (await usersRepo.listAll(db)).map((u) => ({ name: u.name, email: u.email, role: u.role }));
}
