import type { Db } from '../db/client.js';
import type { Actor } from '../lib/actor.js';
import { forbidden, notFound } from '../lib/errors.js';
import { usersRepo, type UserRow } from '../repositories/users.js';

/**
 * Central authorization rule for per-athlete data:
 * an athlete may read/write only their own; a coach may access any athlete of their team.
 * Every service that takes a target user id goes through here.
 */
export async function authorizeAthleteAccess(db: Db, actor: Actor, targetUserId: string): Promise<UserRow> {
  const target = await usersRepo.findById(db, targetUserId);
  if (!target || target.role !== 'athlete') throw notFound('Athlete');
  if (actor.id === target.id) return target;
  if (actor.role === 'coach' && actor.teamId === target.teamId) return target;
  // Same response as "not found" would leak existence across teams; 403 is fine inside a team, 404 outside.
  if (actor.teamId !== target.teamId) throw notFound('Athlete');
  throw forbidden();
}

export function requireCoach(actor: Actor): void {
  if (actor.role !== 'coach') throw forbidden('Coach role required');
}

export function requireAthlete(actor: Actor): void {
  if (actor.role !== 'athlete') throw forbidden('Athlete role required');
}
