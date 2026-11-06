import type { ModelProfile } from './llm-client.js';

export type AgentKind = 'post_activity' | 'weekly' | 'chat';

export type AgentProfile = ModelProfile & {
  /** Model round-trips per run. Covers self-correction after a rejected tool call. */
  maxTurns: number;
  /** Code-enforced cap on proposals created in one run. */
  maxProposals: number;
};

/**
 * Two tiers (see docs/PLAN.md): Haiku for the frequent, cheap post-activity check; Sonnet for the
 * weekly review and chat. Effort follows Anthropic's starting points: `medium` for multi-step
 * tool use, `low` for chat. Sampling parameters (temperature) are not accepted by these models.
 */
export const AGENT_PROFILES: Record<AgentKind, AgentProfile> = {
  post_activity: { model: 'claude-haiku-5-5', effort: 'medium', maxTokens: 16_000, refusalFallback: false, maxTurns: 8, maxProposals: 1 },
  weekly: { model: 'claude-sonnet-5-5', effort: 'medium', maxTokens: 16_000, refusalFallback: true, maxTurns: 10, maxProposals: 2 },
  chat: { model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 16_000, refusalFallback: true, maxTurns: 6, maxProposals: 1 },
};

/** Stored in audit_log.actor_id for everything the agent does. */
export const AGENT_ACTOR_ID = 'coach-agent-v1';
