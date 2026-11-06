import type { z } from 'zod';
import type { FactLedger } from '../facts.js';
import type { AgentKind } from '../models.js';
import type { CoachDataPort } from '../ports.js';

/** Per-run state shared by all tool calls of one agent run. */
export type ToolContext = {
  data: CoachDataPort;
  athleteId: string;
  runId: string;
  kind: AgentKind;
  today: string;
  ledger: FactLedger;
  maxProposals: number;
  /** Proposals created so far in this run. */
  proposalIds: string[];
};

export type ToolOutput = Record<string, unknown>;

/** Thrown inside a tool to send a correctable error back to the model as `is_error: true`. */
export class ToolInputError extends Error {
  constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export type ToolDefinition<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  input: S;
  /** true for the only tool that writes (and it can only insert a proposal). */
  writes: boolean;
  run(ctx: ToolContext, input: z.infer<S>): Promise<ToolOutput>;
};

export const defineTool = <S extends z.ZodType>(t: ToolDefinition<S>): ToolDefinition<S> => t;
