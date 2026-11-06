import { changeTypeSchema, proposedChangeSchema } from '@coach/contracts';
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');

/**
 * Zod schemas for every tool input. They generate the JSON schema sent to the model and validate
 * what comes back: model output is untrusted, so an invalid call is returned to the model as a
 * tool error (it usually fixes it on the next turn) and never reaches the database.
 */
export const getWeekSummaryInput = z.strictObject({
  weekStart: isoDate.optional().describe('Monday of the week to summarize (YYYY-MM-DD). Defaults to the current week.'),
});

export const getHistoryInput = z.strictObject({
  weeks: z.number().int().min(2).max(12).default(8).describe('How many weeks back, including the current one (2-12).'),
});

export const getCalendarInput = z.strictObject({
  from: isoDate.optional().describe('First day (YYYY-MM-DD). Defaults to tomorrow.'),
  to: isoDate.optional().describe('Last day (YYYY-MM-DD). Defaults to 14 days from today. Max 28 days after `from`.'),
});

export const searchNotesInput = z.strictObject({
  query: z.string().min(2).max(200).describe('What to look for in the athlete\'s own notes, e.g. "calf pain" or "slept badly".'),
  limit: z.number().int().min(1).max(8).default(5),
});

export const createProposalInput = z.strictObject({
  workoutId: z.string().uuid().describe('`workoutId` of an upcoming workout returned by get_calendar in this conversation.'),
  changeType: changeTypeSchema.describe('reduce = shorter/easier same session; replace = different session; move = new date; rest = turn into a rest day.'),
  change: proposedChangeSchema
    .strict()
    .describe(
      'Fields of the workout after the change. reduce: durationMin (and optionally description). move: date. replace: workoutType, title, durationMin (optionally sport, targetZone, description). rest: nothing required.',
    ),
  reason: z.string().min(20).max(600).describe('One or two sentences for the athlete: what you saw in the data and why this change helps. No numbers that are not in the cited facts.'),
  evidenceFactIds: z.array(z.string()).min(1).max(8).describe('IDs of the facts (from tool results) that support the change. Only cite IDs you received.'),
  confidence: z.number().min(0).max(1).describe('How sure you are the change is right, 0-1.'),
  injuryConcern: z.boolean().default(false).describe('true if anything suggests pain or injury (not just normal fatigue).'),
});

export type CreateProposalInput = z.infer<typeof createProposalInput>;

/** Model-facing JSON schema: drops `$schema`, the safe-integer bounds and UUID regexes Zod adds. */
export function toInputSchema(schema: z.ZodType): { type: 'object'; [k: string]: unknown } {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete json.$schema;
  return stripSafeIntBounds(json) as { type: 'object'; [k: string]: unknown };
}

function stripSafeIntBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSafeIntBounds);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  const isUuid = (node as Record<string, unknown>).format === 'uuid';
  for (const [k, v] of Object.entries(node)) {
    if (isUuid && k === 'pattern') continue; // `format: uuid` says it; the regex only costs tokens
    if ((k === 'minimum' && v === Number.MIN_SAFE_INTEGER) || (k === 'maximum' && v === Number.MAX_SAFE_INTEGER)) continue;
    out[k] = stripSafeIntBounds(v);
  }
  return out;
}
