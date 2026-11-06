import type { Sport, WorkoutType } from '../../db/schema.js';
import { addDays, daysBetween, eachDay } from '../../domain/dates.js';
import type { ParsedActivity } from '../activity-source.js';

/**
 * Deterministic synthetic team. Everything is generated relative to `today`, so the story
 * ("three hard sessions in a row + rising resting HR" for Carlos) is always true on the demo day.
 * This file only produces raw inputs: load, zones-derived intensity and weekly metrics are
 * computed later by the backend domain functions, exactly like real data.
 */

type Zones = [number, number, number, number, number];
type Slot = { sport: Sport; type: WorkoutType; title: string; minutes: number };
type WeekTemplate = (Slot | null)[]; // Monday..Sunday

export type SeedProfile = {
  goal: string;
  raceName: string;
  raceDate: string;
  raceType: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  availableDays: number[]; // 1 = Monday .. 7 = Sunday
  maxHr: number;
  lthr: number;
  restingHrBaseline: number;
};

export type SeedCheckin = { date: string; restingHr: number; sleepHours: number; fatigue: number; soreness: number; note?: string };
export type SeedPlanned = { date: string; sport: Sport; workoutType: WorkoutType; title: string; description: string; durationMin: number };

export type SeedAthlete = {
  name: string;
  email: string;
  profile: SeedProfile;
  activities: ParsedActivity[];
  checkins: SeedCheckin[];
  plan: SeedPlanned[];
};

export type SeedScenario = {
  team: { name: string; coachReviewEnabled: boolean };
  coach: { name: string; email: string };
  athletes: SeedAthlete[];
};

const ZONE_SHARE: Record<WorkoutType, Zones | null> = {
  easy: [0.15, 0.7, 0.12, 0.03, 0],
  long: [0.1, 0.72, 0.14, 0.04, 0],
  recovery: [0.55, 0.45, 0, 0, 0],
  tempo: [0.12, 0.3, 0.4, 0.15, 0.03],
  intervals: [0.1, 0.25, 0.15, 0.3, 0.2],
  brick: [0.1, 0.5, 0.3, 0.1, 0],
  strength: null,
  rest: null,
};

/** Seconds per km by sport and workout type (before the athlete's pace factor). */
const PACE_S_PER_KM: Record<string, Partial<Record<WorkoutType, number>> & { default: number }> = {
  run: { easy: 360, long: 370, recovery: 400, tempo: 305, intervals: 290, brick: 340, default: 360 },
  bike: { default: 130 }, // ~27.7 km/h
  swim: { default: 1250 }, // ~2:05/100 m
};

const ACTIVITY_NOTES = [
  'Felt smooth, negative split on the second half.',
  'Heavy legs from the first kilometer.',
  'Windy day, kept effort steady rather than pace.',
  'Great session, hit every interval on target.',
  'Slight tightness in the left calf at the start, gone after 10 minutes.',
  'Open water was cold but the swim felt strong.',
  'Struggled with motivation but finished the full session.',
];

const CHECKIN_NOTES = ['Slept well, feeling fresh.', 'Busy day at work, tired.', 'Good energy this morning.', 'A bit sore after yesterday.'];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


const weekdayIndex = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0

const S = (sport: Sport, type: WorkoutType, title: string, minutes: number): Slot => ({ sport, type, title, minutes });

type AthleteDef = {
  name: string;
  email: string;
  profile: SeedProfile;
  template: WeekTemplate;
  /** Training volume multiplier by weeks ago (index 0 = this week). */
  scale: number[];
  adherence: number;
  paceFactor: number;
  baseRhr: number;
};

const ATHLETES = (today: string): AthleteDef[] => [
  {
    name: 'Carlos Ruiz',
    email: 'carlos@teamcoach.demo',
    profile: { goal: 'Finish the Valencia Olympic triathlon under 2:45', raceName: 'Valencia Triathlon', raceDate: addDays(today, 37), raceType: 'olympic triathlon', level: 'intermediate', availableDays: [1, 2, 3, 4, 5, 6, 7], maxHr: 188, lthr: 168, restingHrBaseline: 52 },
    template: [null, S('run', 'tempo', 'Tempo run', 50), S('swim', 'easy', 'Easy swim', 45), S('run', 'intervals', 'Track intervals', 60), S('strength', 'strength', 'Strength circuit', 40), S('bike', 'long', 'Long ride', 150), S('run', 'long', 'Long run', 90)],
    scale: [1.15, 1.1, 1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.75],
    adherence: 0.92,
    paceFactor: 1,
    baseRhr: 52,
  },
  {
    name: 'Ana García',
    email: 'ana@teamcoach.demo',
    profile: { goal: 'Qualify for the 70.3 world championship', raceName: 'Ironman 70.3 Mallorca', raceDate: addDays(today, 72), raceType: 'half ironman', level: 'advanced', availableDays: [1, 2, 3, 4, 5, 6, 7], maxHr: 182, lthr: 165, restingHrBaseline: 46 },
    template: [S('swim', 'easy', 'Technique swim', 50), S('run', 'intervals', 'VO2 intervals', 60), S('bike', 'easy', 'Endurance ride', 90), S('swim', 'tempo', 'Threshold swim', 55), null, S('bike', 'long', 'Long ride', 180), S('run', 'long', 'Long run', 100)],
    scale: [1, 1, 1, 1, 0.95, 0.95, 0.9, 0.9, 0.85],
    adherence: 0.95,
    paceFactor: 0.9,
    baseRhr: 46,
  },
  {
    name: 'Marcos López',
    email: 'marcos@teamcoach.demo',
    profile: { goal: 'Complete a first sprint triathlon', raceName: 'Madrid Sprint Triathlon', raceDate: addDays(today, 51), raceType: 'sprint triathlon', level: 'beginner', availableDays: [2, 4, 6, 7], maxHr: 190, lthr: 172, restingHrBaseline: 60 },
    template: [null, S('run', 'easy', 'Easy run', 35), null, S('swim', 'easy', 'Easy swim', 30), null, S('bike', 'easy', 'Easy ride', 75), S('run', 'long', 'Long run', 50)],
    // Load jumped sharply in the last two weeks: a classic overreaching profile.
    scale: [1.8, 1.5, 1.0, 0.7, 0.6, 0.6, 0.6, 0.5, 0.5],
    adherence: 0.8,
    paceFactor: 1.15,
    baseRhr: 60,
  },
  {
    name: 'Lucía Fernández',
    email: 'lucia@teamcoach.demo',
    profile: { goal: 'Improve open-water swim split and finish strong', raceName: 'Barcelona Olympic Triathlon', raceDate: addDays(today, 58), raceType: 'olympic triathlon', level: 'intermediate', availableDays: [1, 2, 3, 5, 6, 7], maxHr: 186, lthr: 167, restingHrBaseline: 55 },
    template: [S('swim', 'easy', 'Endurance swim', 55), S('run', 'easy', 'Easy run', 45), S('swim', 'intervals', 'Swim intervals', 50), null, S('bike', 'easy', 'Spin', 60), S('swim', 'long', 'Long swim', 70), S('run', 'long', 'Long run', 75)],
    scale: [1, 1, 1, 1, 1, 0.95, 0.95, 0.9, 0.9],
    adherence: 0.85,
    paceFactor: 1.05,
    baseRhr: 55,
  },
  {
    name: 'Diego Martín',
    email: 'diego@teamcoach.demo',
    profile: { goal: 'Peak for a December duathlon', raceName: 'Sevilla Duathlon', raceDate: addDays(today, 24), raceType: 'duathlon', level: 'advanced', availableDays: [1, 2, 3, 4, 6, 7], maxHr: 184, lthr: 166, restingHrBaseline: 48 },
    template: [S('run', 'easy', 'Easy run', 50), S('bike', 'intervals', 'Bike intervals', 70), S('run', 'recovery', 'Recovery jog', 35), S('run', 'tempo', 'Tempo run', 55), null, S('bike', 'long', 'Long ride', 140), S('run', 'long', 'Long run', 85)],
    // Peak block then taper.
    scale: [0.6, 0.8, 1.1, 1.2, 1.2, 1.1, 1.0, 1.0, 0.9],
    adherence: 0.93,
    paceFactor: 0.88,
    baseRhr: 48,
  },
];

function buildActivity(def: AthleteDef, athleteKey: string, date: string, slot: Slot, minutes: number, rand: () => number, shares: Zones | null): ParsedActivity {
  const durationS = minutes * 60;
  const startHour = slot.sport === 'swim' ? 6 : slot.type === 'long' ? 8 : 7;
  const startedAt = new Date(`${date}T${String(startHour).padStart(2, '0')}:${String(Math.floor(rand() * 45)).padStart(2, '0')}:00Z`);
  const base: ParsedActivity = { source: 'seed', sourceId: `seed:${athleteKey}:${date}:${slot.sport}`, sport: slot.sport, startedAt, durationS, movingTimeS: Math.round(durationS * 0.97) };

  if (slot.sport !== 'strength' && slot.sport !== 'other') {
    const paces = PACE_S_PER_KM[slot.sport]!;
    const pace = (paces[slot.type] ?? paces.default) * def.paceFactor * (0.97 + rand() * 0.06);
    base.distanceM = Math.round((base.movingTimeS! / pace) * 1000);
    base.elevationGainM = slot.sport === 'swim' ? 0 : Math.round((minutes / 60) * (slot.sport === 'run' ? 25 : 60) * (0.6 + rand() * 0.8));
  }
  if (shares) {
    const secs = shares.map((s) => Math.round(s * durationS)) as Zones;
    base.timeInZonesS = secs;
    const mid = [0.8, 0.87, 0.915, 0.965, 1.02].map((f) => f * def.profile.lthr);
    base.avgHr = Math.round(secs.reduce((a, s, i) => a + s * mid[i]!, 0) / secs.reduce((a, s) => a + s, 0));
    base.maxHr = Math.min(def.profile.maxHr, Math.round(mid[secs.findLastIndex((s) => s > 0)]! + 6));
  } else {
    base.rpe = 6;
  }
  if (rand() < 0.1) base.notes = ACTIVITY_NOTES[Math.floor(rand() * ACTIVITY_NOTES.length)];
  return base;
}

function buildAthlete(def: AthleteDef, index: number, today: string): SeedAthlete {
  const key = def.email.split('@')[0]!;
  const rand = mulberry32(1000 + index);
  const isCarlos = index === 0;
  const start = addDays(today, -56);
  const activities: ParsedActivity[] = [];

  for (const date of eachDay(start, today)) {
    const daysAgo = daysBetween(date, today);
    const scale = def.scale[Math.min(Math.floor(daysAgo / 7), def.scale.length - 1)]!;
    const slot = def.template[weekdayIndex(date)];

    // Scripted story for Carlos: three hard sessions in a row ending yesterday, then an easy-ish 10 km today.
    if (isCarlos && daysAgo >= 1 && daysAgo <= 3) {
      const hard: Slot = daysAgo === 3 ? S('run', 'intervals', 'Track intervals', 60) : daysAgo === 2 ? S('bike', 'intervals', 'Bike VO2 session', 70) : S('run', 'intervals', 'Hill repeats', 55);
      activities.push(buildActivity(def, key, date, hard, hard.minutes, rand, ZONE_SHARE.intervals));
      continue;
    }
    if (isCarlos && daysAgo === 0) {
      const run = S('run', 'tempo', 'Morning 10 km', 55);
      const a = buildActivity(def, key, date, run, run.minutes, rand, ZONE_SHARE.tempo);
      a.distanceM = 10_000;
      a.notes = 'Legs felt heavy but pushed through the 10 km.';
      activities.push(a);
      continue;
    }

    if (!slot || slot.type === 'rest' || rand() > def.adherence) continue;
    const minutes = Math.max(20, Math.round((slot.minutes * scale * (0.9 + rand() * 0.2)) / 5) * 5);
    activities.push(buildActivity(def, key, date, slot, minutes, rand, ZONE_SHARE[slot.type]));
  }

  const checkins: SeedCheckin[] = [];
  for (const date of eachDay(start, today)) {
    const daysAgo = daysBetween(date, today);
    const recent = daysAgo <= 6;
    if (!(isCarlos && recent) && rand() < 0.15) continue; // occasionally forgets to check in
    let restingHr = def.baseRhr + Math.round(rand() * 2 - 1);
    let sleepHours = Math.round((7 + rand() * 1.2 - 0.4) * 10) / 10;
    let fatigue = 2 + Math.round(rand());
    let soreness = 1 + Math.round(rand());
    let note: string | undefined = rand() < 0.07 ? CHECKIN_NOTES[Math.floor(rand() * CHECKIN_NOTES.length)] : undefined;

    if (isCarlos && recent) {
      // Resting HR climbs ~1 bpm per day; sleep and recovery degrade.
      restingHr = def.baseRhr + Math.round((6 - daysAgo) * 1.0) + Math.round(rand());
      sleepHours = Math.round((6.9 - (6 - daysAgo) * 0.25) * 10) / 10;
      fatigue = Math.min(5, 2 + Math.ceil((6 - daysAgo) / 2));
      soreness = Math.min(5, 1 + Math.ceil((6 - daysAgo) / 2));
      if (daysAgo === 1) note = 'Legs heavy after three hard days in a row, slept badly.';
    }
    if (index === 2 && daysAgo <= 9) restingHr = def.baseRhr + 2 + Math.round(rand() * 2); // Marcos: mild elevation
    checkins.push({ date, restingHr, sleepHours, fatigue, soreness, note });
  }

  // Two weeks of plan starting tomorrow, from the weekly template.
  const plan: SeedPlanned[] = [];
  for (const date of eachDay(addDays(today, 1), addDays(today, 14))) {
    const slot = def.template[weekdayIndex(date)];
    if (!slot) {
      plan.push({ date, sport: 'other', workoutType: 'rest', title: 'Rest day', description: 'Full rest or light mobility.', durationMin: 0 });
      continue;
    }
    plan.push({ date, sport: slot.sport, workoutType: slot.type, title: slot.title, description: `${slot.title} — ${slot.minutes} min planned.`, durationMin: slot.minutes });
  }

  return { name: def.name, email: def.email, profile: def.profile, activities, checkins, plan };
}

export function buildScenario(today: string): SeedScenario {
  return {
    team: { name: 'Madrid Tri Club', coachReviewEnabled: false },
    coach: { name: 'Elena Torres', email: 'elena@teamcoach.demo' },
    athletes: ATHLETES(today).map((def, i) => buildAthlete(def, i, today)),
  };
}
