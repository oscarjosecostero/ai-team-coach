import { z } from 'zod';
import type { LlmTool } from '../llm-client.js';
import { toInputSchema } from '../schemas/tool-inputs.js';
import { createProposal } from './create-proposal.js';
import { getCalendar, getHistory, getWeekSummary, searchNotes } from './read-tools.js';
import { ToolInputError, type ToolContext, type ToolDefinition } from './types.js';

/**
 * The fixed allowlist: four read tools and exactly one write tool. The order is fixed too, so the
 * tool block of the prompt is byte-identical on every request and stays in the prompt cache.
 */
export const TOOLS: readonly ToolDefinition[] = [getWeekSummary, getHistory, getCalendar, searchNotes, createProposal] as ToolDefinition[];
export const TOOL_NAMES = TOOLS.map((t) => t.name);

const byName = new Map(TOOLS.map((t) => [t.name, t]));

let cachedDefinitions: LlmTool[] | null = null;
export function toolDefinitions(): LlmTool[] {
  cachedDefinitions ??= TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: toInputSchema(t.input) }));
  return cachedDefinitions;
}

export type ToolCallResult = { content: string; isError: boolean };

const MAX_RESULT_CHARS = 20_000;

/** Runs one model-requested tool call. Never throws: every failure becomes a tool error for the model. */
export async function dispatchTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolCallResult> {
  const tool = byName.get(name);
  if (!tool) {
    const near = TOOL_NAMES.find((n) => n.toLowerCase() === name.toLowerCase());
    return error(near ? `Unknown tool "${name}". Did you mean "${near}"?` : `Unknown tool "${name}". Available tools: ${TOOL_NAMES.join(', ')}.`);
  }

  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return error('Invalid input for ' + name, { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })) });
  }

  try {
    const output = await tool.run(ctx, parsed.data);
    const content = JSON.stringify(output);
    return { content: content.length > MAX_RESULT_CHARS ? content.slice(0, MAX_RESULT_CHARS) + '…(truncated)' : content, isError: false };
  } catch (err) {
    if (err instanceof ToolInputError) return error(err.message, err.details);
    if (err instanceof z.ZodError) return error('Invalid input for ' + name);
    throw err; // infrastructure failures (DB down, bug) fail the run instead of being hidden from logs
  }
}

function error(message: string, details?: Record<string, unknown>): ToolCallResult {
  return { content: JSON.stringify({ error: message, ...details }), isError: true };
}
