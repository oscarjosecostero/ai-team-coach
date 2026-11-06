import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, plannedWorkouts, proposals, teams } from '../../src/db/schema.js';
import { truncateAllData } from '../../src/repositories/maintenance.js';
import { plannedWorkoutsRepo } from '../../src/repositories/planned-workouts.js';
import { proposalsRepo } from '../../src/repositories/proposals.js';
import { seedDemoTeam, type SeedResult } from '../../src/services/seed.js';
import { createTestApp, loginCookie, PASSWORD, TODAY } from '../helpers/app.js';

const { app, database, db } = createTestApp();
let seeded: SeedResult;
let carlos: SeedResult['athletes'][number];
let marcos: SeedResult['athletes'][number];
let carlosCookie: string;
let marcosCookie: string;
let coachCookie: string;

beforeAll(async () => {
  await truncateAllData(db);
  seeded = await seedDemoTeam(db, { today: TODAY, password: PASSWORD });
  carlos = seeded.athletes.find((a) => a.name.startsWith('Carlos'))!;
  marcos = seeded.athletes.find((a) => a.name.startsWith('Marcos'))!;
  carlosCookie = await loginCookie(app, carlos.email);
  marcosCookie = await loginCookie(app, marcos.email);
  coachCookie = await loginCookie(app, seeded.coach.email);
});
afterAll(async () => {
  await app.close();
  await database.sql.end();
});

const get = (url: string, cookie?: string) => app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
const post = (url: string, cookie: string | undefined, payload?: unknown) =>
  app.inject({ method: 'POST', url, headers: cookie ? { cookie } : {}, payload: payload as object | undefined });

/** A future, not-yet-proposed workout of the athlete. */
async function futureWorkout(userId: string, skip = 0) {
  const rows = (await plannedWorkoutsRepo.listRange(db, userId, '2026-11-07', '2026-11-30')).filter((w) => w.workoutType !== 'rest');
  return rows[skip]!;
}

async function makeProposal(userId: string, workoutId: string, version: number, over: Partial<typeof proposals.$inferInsert> = {}) {
  return proposalsRepo.insert(db, {
    userId,
    plannedWorkoutId: workoutId,
    plannedWorkoutVersion: version,
    changeType: 'reduce',
    proposedChange: { durationMin: 40 },
    reason: 'Three hard days in a row',
    evidence: [],
    status: 'pending',
    ...over,
  });
}

const auditFor = (entityType: string, entityId: string) =>
  db.select().from(auditLog).where(eq(auditLog.entityId, entityId)).then((r) => r.filter((x) => x.entityType === entityType));

describe('auth', () => {
  it('logs in with the right password and sets an httpOnly cookie', async () => {
    const res = await post('/auth/login', undefined, { email: carlos.email, password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ id: carlos.id, role: 'athlete' });
    const c = res.cookies.find((x) => x.name === 'session')!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
  });

  it('rejects a wrong password and an unknown email with the same 401', async () => {
    const a = await post('/auth/login', undefined, { email: carlos.email, password: 'nope' });
    const b = await post('/auth/login', undefined, { email: 'ghost@example.com', password: 'nope' });
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
  });

  it('requires a session for protected routes and rejects a tampered token', async () => {
    expect((await get('/dashboard')).statusCode).toBe(401);
    expect((await get('/dashboard', 'session=not.a.jwt')).statusCode).toBe(401);
    expect((await get('/auth/me', carlosCookie)).json().user.id).toBe(carlos.id);
  });

  it('demo login signs in without a password', async () => {
    const res = await post('/auth/demo-login', undefined, { email: coach().email });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe('coach');
    const accounts = (await get('/auth/demo-accounts')).json().accounts;
    expect(accounts).toHaveLength(6);
    expect(accounts[0]).not.toHaveProperty('passwordHash');
  });

  it('logout clears the cookie', async () => {
    const res = await post('/auth/logout', carlosCookie);
    expect(res.statusCode).toBe(204);
    expect(res.cookies.find((x) => x.name === 'session')?.value).toBe('');
  });
});
const coach = () => seeded.coach;

describe('data access', () => {
  it('an athlete reads their own dashboard, calendar and activities', async () => {
    const dash = await get('/dashboard', carlosCookie);
    expect(dash.statusCode).toBe(200);
    expect(dash.json().athlete.id).toBe(carlos.id);
    expect(dash.json().currentWeek.maxConsecutiveHardDays).toBe(3);
    expect(dash.json().upcomingWorkouts.length).toBeGreaterThan(0);
    expect((await get('/calendar?from=2026-11-01&to=2026-11-20', carlosCookie)).json().workouts.length).toBeGreaterThan(0);
    expect((await get('/activities?limit=3', carlosCookie)).json().activities).toHaveLength(3);
  });

  it("an athlete cannot read another athlete's data", async () => {
    for (const url of [`/dashboard?athleteId=${marcos.id}`, `/activities?athleteId=${marcos.id}`, `/calendar?athleteId=${marcos.id}&from=2026-11-01&to=2026-11-20`]) {
      const res = await get(url, carlosCookie);
      expect(res.statusCode, url).toBe(403);
    }
  });

  it('a coach can read any athlete of the team', async () => {
    for (const a of [carlos, marcos]) {
      const res = await get(`/dashboard?athleteId=${a.id}`, coachCookie);
      expect(res.statusCode).toBe(200);
      expect(res.json().athlete.id).toBe(a.id);
    }
  });

  it("a coach from another team gets 404 on this team's athletes", async () => {
    const [other] = await db.insert(teams).values({ name: 'Other team' }).returning();
    const { athletesRepo } = await import('../../src/repositories/athletes.js');
    const { hashPassword } = await import('../../src/lib/password.js');
    await athletesRepo.createUser(db, { teamId: other!.id, role: 'coach', name: 'Outsider', email: 'outsider@example.com', passwordHash: await hashPassword(PASSWORD) });
    const cookie = await loginCookie(app, 'outsider@example.com');
    expect((await get(`/dashboard?athleteId=${carlos.id}`, cookie)).statusCode).toBe(404);
  });

  it('validates query parameters', async () => {
    expect((await get('/calendar?from=yesterday&to=2026-11-20', carlosCookie)).statusCode).toBe(400);
    expect((await get('/dashboard?athleteId=not-a-uuid', carlosCookie)).statusCode).toBe(400);
  });
});

describe('check-ins', () => {
  it('stores a check-in, upserts per day and refreshes weekly metrics', async () => {
    const before = (await get('/dashboard', marcosCookie)).json().currentWeek;
    const res = await post('/checkins', marcosCookie, { restingHr: 70, fatigue: 4, note: 'Left knee feels tight' });
    expect(res.statusCode).toBe(201);
    const again = await post('/checkins', marcosCookie, { restingHr: 71, fatigue: 4 });
    expect(again.json().checkin.id).toBe(res.json().checkin.id);
    const after = (await get('/dashboard', marcosCookie)).json();
    expect(after.latestCheckin.restingHr).toBe(71);
    expect(after.currentWeek.avgRestingHr).not.toBe(before.avgRestingHr);
  });

  it('rejects out-of-range values, future dates, and coaches', async () => {
    expect((await post('/checkins', marcosCookie, { fatigue: 9 })).statusCode).toBe(400);
    expect((await post('/checkins', marcosCookie, { date: '2026-12-01' })).statusCode).toBe(400);
    expect((await post('/checkins', coachCookie, { fatigue: 3 })).statusCode).toBe(403);
  });
});

describe('proposals: accept', () => {
  it('updates the calendar, bumps the version and writes audit entries', async () => {
    const w = await futureWorkout(carlos.id);
    const p = await makeProposal(carlos.id, w.id, w.version, { changeType: 'reduce', proposedChange: { durationMin: 40 } });

    const res = await post(`/proposals/${p.id}/accept`, carlosCookie, { note: 'Makes sense' });
    expect(res.statusCode).toBe(200);
    expect(res.json().proposal).toMatchObject({ status: 'accepted', decidedBy: carlos.id });

    const after = (await plannedWorkoutsRepo.getById(db, w.id))!;
    expect(after.durationMin).toBe(40);
    expect(after.version).toBe(w.version + 1);
    expect(after.origin).toBe('proposal');
    expect(after.plannedLoad).toBeLessThan(w.plannedLoad);

    const calendar = (await get(`/calendar?from=${w.date}&to=${w.date}`, carlosCookie)).json().workouts;
    expect(calendar.find((x: { id: string }) => x.id === w.id).durationMin).toBe(40);

    const accepted = await auditFor('proposal', p.id);
    expect(accepted.map((a) => a.action)).toEqual(['proposal.accepted']);
    expect(accepted[0]).toMatchObject({ actorType: 'athlete', actorId: carlos.id });
    const plan = await auditFor('planned_workout', w.id);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ action: 'plan.updated' });
    expect((plan[0]!.before as { durationMin: number }).durationMin).toBe(w.durationMin);
    expect((plan[0]!.after as { durationMin: number }).durationMin).toBe(40);
  });

  it('applies replace, move and rest changes', async () => {
    const w1 = await futureWorkout(carlos.id, 1);
    const p1 = await makeProposal(carlos.id, w1.id, w1.version, {
      changeType: 'replace',
      proposedChange: { workoutType: 'easy', title: 'Easy 40 min run', sport: 'run', durationMin: 40 },
    });
    expect((await post(`/proposals/${p1.id}/accept`, carlosCookie)).statusCode).toBe(200);
    expect(await plannedWorkoutsRepo.getById(db, w1.id)).toMatchObject({ workoutType: 'easy', title: 'Easy 40 min run', durationMin: 40 });

    const w2 = await futureWorkout(carlos.id, 2);
    const p2 = await makeProposal(carlos.id, w2.id, w2.version, { changeType: 'move', proposedChange: { date: '2026-11-29' } });
    expect((await post(`/proposals/${p2.id}/accept`, carlosCookie)).statusCode).toBe(200);
    expect((await plannedWorkoutsRepo.getById(db, w2.id))!.date).toBe('2026-11-29');

    const w3 = await futureWorkout(carlos.id, 3);
    const p3 = await makeProposal(carlos.id, w3.id, w3.version, { changeType: 'rest', proposedChange: {} });
    expect((await post(`/proposals/${p3.id}/accept`, carlosCookie)).statusCode).toBe(200);
    expect(await plannedWorkoutsRepo.getById(db, w3.id)).toMatchObject({ workoutType: 'rest', durationMin: 0, plannedLoad: 0 });
  });

  it('rejects a stale proposal (workout changed since) and leaves the plan untouched', async () => {
    const w = await futureWorkout(carlos.id, 4);
    const p = await makeProposal(carlos.id, w.id, w.version);
    await plannedWorkoutsRepo.updateIfVersion(db, w.id, w.version, { durationMin: 75 }); // someone edits the plan

    const res = await post(`/proposals/${p.id}/accept`, carlosCookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('stale_proposal');
    expect((await plannedWorkoutsRepo.getById(db, w.id))!.durationMin).toBe(75);
    expect((await proposalsRepo.getById(db, p.id))!.status).toBe('pending');
    expect(await auditFor('proposal', p.id)).toHaveLength(0);
  });

  it('cannot accept a workout that is no longer in the future', async () => {
    const [past] = await db.insert(plannedWorkouts).values({
      userId: carlos.id, date: TODAY, sport: 'run', workoutType: 'easy', title: 'Today', durationMin: 60, origin: 'manual',
    }).returning();
    const p = await makeProposal(carlos.id, past!.id, past!.version);
    const res = await post(`/proposals/${p.id}/accept`, carlosCookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('workout_in_past');
  });

  it('is applied once: a second accept (or reject) conflicts', async () => {
    const w = await futureWorkout(carlos.id, 5);
    const p = await makeProposal(carlos.id, w.id, w.version);
    expect((await post(`/proposals/${p.id}/accept`, carlosCookie)).statusCode).toBe(200);
    expect((await post(`/proposals/${p.id}/accept`, carlosCookie)).json().error.code).toBe('already_decided');
    expect((await post(`/proposals/${p.id}/reject`, carlosCookie)).statusCode).toBe(409);
    expect((await plannedWorkoutsRepo.getById(db, w.id))!.version).toBe(w.version + 1);
  });

  it('two concurrent accepts apply the change exactly once', async () => {
    const w = await futureWorkout(carlos.id, 6);
    const p = await makeProposal(carlos.id, w.id, w.version);
    const [a, b] = await Promise.all([post(`/proposals/${p.id}/accept`, carlosCookie), post(`/proposals/${p.id}/accept`, carlosCookie)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect((await plannedWorkoutsRepo.getById(db, w.id))!.version).toBe(w.version + 1);
    expect(await auditFor('planned_workout', w.id)).toHaveLength(1);
  });

  it("only the owner can decide: other athletes and the coach get 404", async () => {
    const w = await futureWorkout(carlos.id, 7);
    const p = await makeProposal(carlos.id, w.id, w.version);
    for (const cookie of [marcosCookie, coachCookie]) {
      expect((await post(`/proposals/${p.id}/accept`, cookie)).statusCode).toBe(404);
      expect((await post(`/proposals/${p.id}/reject`, cookie)).statusCode).toBe(404);
    }
    expect((await plannedWorkoutsRepo.getById(db, w.id))!.version).toBe(w.version);
  });
});

describe('proposals: reject', () => {
  it('leaves the plan unchanged and audits the decision', async () => {
    const w = await futureWorkout(marcos.id);
    const p = await makeProposal(marcos.id, w.id, w.version);
    const res = await post(`/proposals/${p.id}/reject`, marcosCookie, { note: 'I feel fine' });
    expect(res.statusCode).toBe(200);
    expect(res.json().proposal.status).toBe('rejected');

    const after = (await plannedWorkoutsRepo.getById(db, w.id))!;
    expect(after).toMatchObject({ durationMin: w.durationMin, version: w.version, title: w.title });
    expect(await auditFor('planned_workout', w.id)).toHaveLength(0);
    const entries = await auditFor('proposal', p.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'proposal.rejected', actorType: 'athlete', actorId: marcos.id });
  });
});

describe('proposals: visibility', () => {
  it('lists own proposals filtered by status; coach sees the whole team; athletes only their own', async () => {
    const w = await futureWorkout(marcos.id, 1);
    const p = await makeProposal(marcos.id, w.id, w.version);
    const mine = (await get('/proposals?status=pending', marcosCookie)).json().proposals;
    expect(mine.map((x: { id: string }) => x.id)).toContain(p.id);
    expect(mine.every((x: { userId: string }) => x.userId === marcos.id)).toBe(true);

    const team = (await get('/proposals?status=pending', coachCookie)).json().proposals;
    expect(new Set(team.map((x: { userId: string }) => x.userId)).size).toBeGreaterThanOrEqual(1);
    expect(team.map((x: { id: string }) => x.id)).toContain(p.id);

    expect((await get(`/proposals?athleteId=${marcos.id}`, carlosCookie)).statusCode).toBe(403);
    expect((await get(`/proposals/${p.id}`, carlosCookie)).statusCode).toBe(404);
    expect((await get(`/proposals/${p.id}`, coachCookie)).statusCode).toBe(200);
  });
});

describe('proposals: coach review', () => {
  async function awaitingProposal(skip: number) {
    const w = await futureWorkout(marcos.id, 2 + skip);
    return { w, p: await makeProposal(marcos.id, w.id, w.version, { status: 'awaiting_coach' }) };
  }

  it('hides awaiting_coach proposals from the athlete', async () => {
    const { p } = await awaitingProposal(0);
    expect((await get(`/proposals/${p.id}`, marcosCookie)).statusCode).toBe(404);
    expect((await get('/proposals', marcosCookie)).json().proposals.map((x: { id: string }) => x.id)).not.toContain(p.id);
    expect((await post(`/proposals/${p.id}/accept`, marcosCookie)).statusCode).toBe(404);
  });

  it('coach approves with an edit, releasing it to the athlete, and audits it', async () => {
    const { w, p } = await awaitingProposal(1);
    const res = await post(`/proposals/${p.id}/coach-review`, coachCookie, { action: 'approve', note: 'Shorter please', edit: { durationMin: 30 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().proposal).toMatchObject({ status: 'pending', coachNote: 'Shorter please', proposedChange: { durationMin: 30 } });
    expect((await auditFor('proposal', p.id)).map((a) => a.action)).toEqual(['proposal.coach_edited']);

    expect((await post(`/proposals/${p.id}/accept`, marcosCookie)).statusCode).toBe(200);
    expect((await plannedWorkoutsRepo.getById(db, w.id))!.durationMin).toBe(30);
  });

  it('coach can reject before the athlete ever sees it', async () => {
    const { p } = await awaitingProposal(2);
    const res = await post(`/proposals/${p.id}/coach-review`, coachCookie, { action: 'reject', note: 'Not needed' });
    expect(res.json().proposal.status).toBe('rejected');
    expect((await auditFor('proposal', p.id)).map((a) => a.action)).toEqual(['proposal.coach_rejected']);
  });

  it('athletes cannot use coach-review, and a proposal can only be reviewed while awaiting', async () => {
    const { p } = await awaitingProposal(3);
    expect((await post(`/proposals/${p.id}/coach-review`, marcosCookie, { action: 'approve' })).statusCode).toBe(403);
    expect((await post(`/proposals/${p.id}/coach-review`, coachCookie, { action: 'approve' })).statusCode).toBe(200);
    expect((await post(`/proposals/${p.id}/coach-review`, coachCookie, { action: 'approve' })).statusCode).toBe(409);
  });

  it('rejects an edit that makes the change malformed', async () => {
    const { p } = await awaitingProposal(4);
    const res = await post(`/proposals/${p.id}/coach-review`, coachCookie, { action: 'approve', edit: { durationMin: 9999 } });
    expect(res.statusCode).toBe(400);
    expect((await proposalsRepo.getById(db, p.id))!.status).toBe('awaiting_coach');
  });
});

describe('uploads', () => {
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><trk><type>running</type><trkseg>
    <trkpt lat="40.0" lon="-3.0"><ele>600</ele><time>2026-11-06T07:00:00Z</time></trkpt>
    <trkpt lat="40.01" lon="-3.0"><ele>605</ele><time>2026-11-06T07:05:00Z</time></trkpt>
    <trkpt lat="40.02" lon="-3.0"><ele>610</ele><time>2026-11-06T07:10:00Z</time></trkpt></trkseg></trk></gpx>`;

  function multipartBody(filename: string, content: string) {
    const boundary = '----testboundary';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--${boundary}--\r\n`;
    return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
  }

  it('ingests a GPX file, is idempotent, and updates weekly metrics', async () => {
    const { body, headers } = multipartBody('morning-run.gpx', gpx);
    const first = await app.inject({ method: 'POST', url: '/uploads/activity', headers: { ...headers, cookie: marcosCookie }, payload: body });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ created: 1, duplicates: 0 });
    const again = await app.inject({ method: 'POST', url: '/uploads/activity', headers: { ...headers, cookie: marcosCookie }, payload: body });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ created: 0, duplicates: 1 });
    expect((await get('/dashboard', marcosCookie)).json().latestActivity.source).toBe('file');
  });

  it('answers 422 for an unparseable file and 401 without a session', async () => {
    const bad = multipartBody('broken.gpx', 'not xml at all');
    expect((await app.inject({ method: 'POST', url: '/uploads/activity', headers: { ...bad.headers, cookie: marcosCookie }, payload: bad.body })).statusCode).toBe(422);
    const wrongExt = multipartBody('notes.txt', 'hello');
    expect((await app.inject({ method: 'POST', url: '/uploads/activity', headers: { ...wrongExt.headers, cookie: marcosCookie }, payload: wrongExt.body })).statusCode).toBe(422);
    expect((await app.inject({ method: 'POST', url: '/uploads/activity', headers: bad.headers, payload: bad.body })).statusCode).toBe(401);
  });
});

describe('team', () => {
  it('ranks the team by current-week volume with aggregates only', async () => {
    const res = await get('/team/ranking', carlosCookie);
    expect(res.statusCode).toBe(200);
    const ranking = res.json().ranking;
    expect(ranking).toHaveLength(5);
    expect(ranking.map((r: { rank: number }) => r.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(ranking[0].totalDurationS).toBeGreaterThanOrEqual(ranking[4].totalDurationS);
    expect(Object.keys(ranking[0]).sort()).toEqual(['acwr', 'athleteId', 'hardSessions', 'name', 'rank', 'totalDurationS', 'totalLoad', 'weekStart']);
    expect((await get('/team/ranking')).statusCode).toBe(401);
  });
});

describe('audit log is append-only', () => {
  it('the database refuses to rewrite history', async () => {
    await expect(db.update(auditLog).set({ action: 'tampered' })).rejects.toThrow();
  });
});
