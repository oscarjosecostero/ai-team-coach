"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "./api";
import type { Activity, AgentRun, AgentRunDetail, ChatMessage, Dashboard, DemoAccount, PlannedWorkout, Proposal, ProposalStatus, RankingRow, SessionUser } from "./types";

export const keys = {
  me: ["me"] as const,
  dashboard: (athleteId: string) => ["dashboard", athleteId] as const,
  calendar: (athleteId: string, from: string, to: string) => ["calendar", athleteId, from, to] as const,
  activities: (athleteId: string, range: string) => ["activities", athleteId, range] as const,
  proposals: (athleteId: string | undefined, status: string) => ["proposals", athleteId ?? "all", status] as const,
  runs: (athleteId: string) => ["runs", athleteId] as const,
  chat: ["chat"] as const,
  ranking: ["ranking"] as const,
};

export const useDemoAccounts = () => useQuery({ queryKey: ["demo-accounts"], queryFn: () => api.get<{ accounts: DemoAccount[] }>("/auth/demo-accounts").then((r) => r.accounts), retry: false });

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => api.get<{ user: SessionUser }>("/auth/me").then((r) => r.user), retry: false, staleTime: 5 * 60_000 });

export const useDashboard = (athleteId: string | undefined) =>
  useQuery({ queryKey: keys.dashboard(athleteId ?? ""), queryFn: () => api.get<Dashboard>(`/dashboard${qs({ athleteId })}`), enabled: Boolean(athleteId) });

export const useCalendar = (athleteId: string | undefined, from: string, to: string) =>
  useQuery({
    queryKey: keys.calendar(athleteId ?? "", from, to),
    queryFn: () => api.get<{ workouts: PlannedWorkout[]; weeks: { weekStart: string; plannedLoad: number }[] }>(`/calendar${qs({ athleteId, from, to })}`),
    enabled: Boolean(athleteId),
  });

/** Stored activities: the most recent `limit`, or those between `from` and `to` (UTC days, inclusive). */
export const useActivities = (athleteId: string | undefined, q: { limit?: number; from?: string; to?: string }) =>
  useQuery({
    queryKey: keys.activities(athleteId ?? "", q.from && q.to ? `${q.from}..${q.to}` : `last:${q.limit ?? 20}`),
    queryFn: () => api.get<{ activities: Activity[] }>(`/activities${qs({ athleteId, ...q })}`).then((r) => r.activities),
    enabled: Boolean(athleteId) && (!q.from || Boolean(q.to)),
  });

export const useProposals = (athleteId: string | undefined, statuses: ProposalStatus[], enabled = true) =>
  useQuery({
    enabled,
    queryKey: keys.proposals(athleteId, statuses.join(",")),
    queryFn: () => api.get<{ proposals: Proposal[] }>(`/proposals${qs({ athleteId, status: statuses.join(",") })}`).then((r) => r.proposals),
  });

/** A run started less than ten minutes ago that is still running (older ones were interrupted). */
export const isInProgress = (r: AgentRun) => r.status === "running" && Date.now() - new Date(r.startedAt).getTime() < 10 * 60_000;

export const useRuns = (athleteId: string | undefined) =>
  useQuery({
    queryKey: keys.runs(athleteId ?? ""),
    queryFn: () => api.get<{ runs: AgentRun[] }>(`/analysis/runs${qs({ athleteId, limit: 5 })}`).then((r) => r.runs),
    enabled: Boolean(athleteId),
    // Keep the card fresh while an analysis (manual, or started by an upload) is still running.
    refetchInterval: (q) => (q.state.data?.some(isInProgress) ? 3000 : false),
  });

export const useChat = (enabled = true) => useQuery({ queryKey: keys.chat, enabled, queryFn: () => api.get<{ messages: ChatMessage[] }>("/chat").then((r) => r.messages) });

export const useRanking = (enabled = true) => useQuery({ queryKey: keys.ranking, enabled, queryFn: () => api.get<{ ranking: RankingRow[] }>("/team/ranking").then((r) => r.ranking) });

/** After anything that can change the plan or the metrics, refetch every view that shows them. */
export function useInvalidateAthleteData() {
  const qc = useQueryClient();
  return () =>
    Promise.all(["dashboard", "calendar", "activities", "proposals", "runs", "ranking"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useDecideProposal() {
  const invalidate = useInvalidateAthleteData();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: "accept" | "reject"; note?: string }) =>
      api.post<{ proposal: Proposal }>(`/proposals/${id}/${decision}`, note ? { note } : {}),
    onSuccess: invalidate,
  });
}

export function useCoachReview() {
  const invalidate = useInvalidateAthleteData();
  return useMutation({
    mutationFn: ({ id, action, note, durationMin }: { id: string; action: "approve" | "reject"; note?: string; durationMin?: number }) =>
      api.post<{ proposal: Proposal }>(`/proposals/${id}/coach-review`, {
        action,
        ...(note ? { note } : {}),
        ...(action === "approve" && durationMin !== undefined ? { edit: { durationMin } } : {}),
      }),
    onSuccess: invalidate,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts an analysis and waits for it. The API answers 202 with the run at once (a weekly review can
 * outlast any proxy timeout), so the mutation polls `GET /analysis/runs/:id` until the run finishes.
 * Callbacks live on the hook, not on `mutate()`, so they still fire if the user navigates away.
 */
export function useRunAnalysis(opts: { onDone?: (run: AgentRunDetail) => void; onError?: (err: unknown) => void } = {}) {
  const invalidate = useInvalidateAthleteData();
  return useMutation({
    mutationFn: async (v: { athleteId: string; kind: "weekly" | "post_activity" }) => {
      const { run } = await api.post<{ run: AgentRun }>("/analysis/run", v);
      await invalidate(); // the runs list now shows it as running
      for (let waited = 0; waited < 12 * 60_000; waited += 2000) {
        await sleep(2000);
        const { run: current } = await api.get<{ run: AgentRunDetail }>(`/analysis/runs/${run.id}`);
        if (current.status !== "running") return current;
      }
      throw new Error("The analysis is taking longer than expected. Check back in a few minutes.");
    },
    onSuccess: opts.onDone,
    onError: opts.onError,
    onSettled: invalidate,
  });
}
