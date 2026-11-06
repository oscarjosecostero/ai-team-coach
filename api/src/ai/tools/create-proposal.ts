import { validateChangeShape } from '../../domain/proposal-change.js';
import { resolveCitations } from '../facts.js';
import { createProposalInput } from '../schemas/tool-inputs.js';
import { defineTool, ToolInputError } from './types.js';

/**
 * The agent's only write. It never edits the plan: it asks the backend to insert a proposal,
 * which a human then accepts or rejects. Every check that matters for safety (ownership, future
 * date, one open proposal per workout, ±10% weekly load, injury => reduce/rest) runs again in
 * services/agent-proposals.ts inside the insert transaction; the checks here only exist to give
 * the model a precise error it can correct.
 */
export const createProposal = defineTool({
  name: 'create_proposal',
  description:
    'Proposes ONE change to ONE upcoming planned workout, for the athlete (and coach) to accept or reject. It does not change the plan. Use it only when the data clearly supports a change; cite the facts behind it by ID. If the backend rejects the proposal (for example because the weekly planned load would move more than ±10%), read the error, adjust the change and try again, or explain why no change is proposed.',
  input: createProposalInput,
  writes: true,
  async run(ctx, input) {
    if (ctx.proposalIds.length >= ctx.maxProposals) {
      throw new ToolInputError(`This run may create at most ${ctx.maxProposals} proposal(s); one already exists. Summarize instead.`);
    }
    if (!ctx.ledger.hasSeenWorkout(input.workoutId)) {
      throw new ToolInputError('Unknown workoutId: use a workoutId returned by get_calendar in this conversation (call get_calendar first).');
    }
    const shapeError = validateChangeShape(input.changeType, input.change);
    if (shapeError) throw new ToolInputError(`Invalid change for "${input.changeType}": ${shapeError}.`);

    const { found, unknown } = ctx.ledger.resolve(input.evidenceFactIds);
    if (unknown.length) {
      throw new ToolInputError('Unknown fact IDs. Cite only IDs that appear in tool results of this conversation.', { unknownFactIds: unknown });
    }

    // Some models also cite inline in the reason ("ACWR [[wk:…:acwr]]"). Known IDs join the evidence,
    // so the UI can render them with backend values; unknown ones are dropped from the text.
    const inline = resolveCitations(input.reason, ctx.ledger);
    const citedFacts = [...found, ...inline.citations.filter((f) => !found.some((e) => e.id === f.id))];

    const result = await ctx.data.createProposal({
      athleteId: ctx.athleteId,
      agentRunId: ctx.runId,
      workoutId: input.workoutId,
      changeType: input.changeType,
      change: input.change,
      reason: inline.text,
      citedFacts,
      confidence: input.confidence,
      modelInjuryConcern: input.injuryConcern,
    });

    if (!result.ok) {
      throw new ToolInputError(result.message, {
        code: result.code,
        ...(result.violations ? { violations: result.violations } : {}),
        ...(result.weeks ? { plannedLoadImpact: result.weeks } : {}),
        ...(result.injury?.flag ? { injurySignal: result.injury.reasons, allowedChangeTypes: ['reduce', 'rest'] } : {}),
      });
    }

    ctx.proposalIds.push(result.proposal.id);
    return {
      created: true,
      proposalId: result.proposal.id,
      status: result.proposal.status,
      plannedLoadImpact: result.proposal.weeks,
      note:
        result.proposal.status === 'awaiting_coach'
          ? 'The coach reviews this proposal before the athlete sees it.'
          : 'The athlete will see this proposal and can accept or reject it.',
    };
  },
});
