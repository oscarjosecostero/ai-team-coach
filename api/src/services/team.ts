import type { Db } from '../db/client.js';
import { toIsoDate, weekStartOf } from '../domain/dates.js';
import type { Actor, Clock } from '../lib/actor.js';
import { weeklyMetricsRepo } from '../repositories/weekly-metrics.js';
import { usersRepo } from '../repositories/users.js';

export type RankingRow = {
  rank: number;
  athleteId: string;
  name: string;
  weekStart: string;
  totalDurationS: number;
  totalLoad: number;
  hardSessions: number;
  acwr: number | null;
};

/**
 * Team view: current-week training volume per athlete, most first. Deliberately limited to
 * aggregates (no notes, check-ins or activity detail), which is all a teammate may see.
 */
export async function teamRanking(deps: { db: Db; now: Clock }, actor: Actor): Promise<RankingRow[]> {
  const weekStart = weekStartOf(toIsoDate(deps.now()));
  const members = (await usersRepo.listByTeam(deps.db, actor.teamId)).filter((u) => u.role === 'athlete');
  const rows = await Promise.all(
    members.map(async (u) => {
      const [m] = await weeklyMetricsRepo.list(deps.db, u.id, weekStart);
      return {
        athleteId: u.id,
        name: u.name,
        weekStart,
        totalDurationS: m?.totalDurationS ?? 0,
        totalLoad: m?.totalLoad ?? 0,
        hardSessions: m?.hardSessions ?? 0,
        acwr: m?.acwr ?? null,
      };
    }),
  );
  rows.sort((a, b) => b.totalDurationS - a.totalDurationS || a.name.localeCompare(b.name));
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}
