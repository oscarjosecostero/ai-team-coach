import { addDays } from './dates.js';

/**
 * Words that point at pain or injury rather than ordinary training fatigue. "Heavy legs",
 * "tired" or "sore after yesterday" are normal; "sharp pain in the knee" is not.
 */
const INJURY_TERMS = [
  'pain',
  'painful',
  'hurts',
  'hurting',
  'injury',
  'injured',
  'sharp',
  'strain',
  'strained',
  'sprain',
  'sprained',
  'swollen',
  'swelling',
  'tendinitis',
  'tendonitis',
  'shin splints',
  'stress fracture',
  'limping',
  'limp',
  'numbness',
];

const TERM_RE = new RegExp(`\\b(${INJURY_TERMS.map((t) => t.replace(/\s+/g, '\\s+')).join('|')})\\b`, 'i');

/** Soreness is self-reported 1-5; 5 is "can barely train", which we treat as a possible injury. */
export const INJURY_SORENESS_THRESHOLD = 5;
export const INJURY_LOOKBACK_DAYS = 7;

export type InjuryEvidence = {
  checkins: { date: string; soreness: number | null; note: string | null }[];
  activityNotes: { date: string; note: string }[];
};

export type InjurySignal = { flag: boolean; reasons: string[] };

export function mentionsInjury(text: string): boolean {
  return TERM_RE.test(text);
}

/**
 * Backend-side injury detection over the last week of check-ins and activity notes. When it fires,
 * proposals are limited to reduce/rest and must carry a referral to a professional. The model can
 * also raise the flag itself; it can never lower it.
 */
export function detectInjurySignal(evidence: InjuryEvidence, today: string): InjurySignal {
  const from = addDays(today, -(INJURY_LOOKBACK_DAYS - 1));
  const inWindow = (d: string) => d >= from && d <= today;
  const reasons: string[] = [];

  for (const c of evidence.checkins.filter((c) => inWindow(c.date))) {
    if (c.soreness !== null && c.soreness >= INJURY_SORENESS_THRESHOLD) reasons.push(`soreness ${c.soreness}/5 on ${c.date}`);
    if (c.note && mentionsInjury(c.note)) reasons.push(`check-in note on ${c.date} mentions pain or injury`);
  }
  for (const n of evidence.activityNotes.filter((n) => inWindow(n.date))) {
    if (mentionsInjury(n.note)) reasons.push(`activity note on ${n.date} mentions pain or injury`);
  }
  return { flag: reasons.length > 0, reasons };
}

/** Fixed wording appended by the backend to every proposal made under an injury signal. */
export const PROFESSIONAL_REFERRAL =
  'Because there are signs of pain or injury, please check with a physiotherapist or sports doctor before training hard again.';
