"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "./api";
import type { AgentRun, AnalysisResult, ChatMessage, Dashboard, DemoAccount, PlannedWorkout, Proposal, ProposalStatus, RankingRow, SessionUser } from "./types";

export const keys = {
  me: ["me"] as const,
  dashboard: (athleteId: string) => ["dashboard", athleteId] as const,
  calendar: (athleteId: string, from: string, to: string) => ["calendar", athleteId, from, to] as const,
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

export const useProposals = (athleteId: string | undefined, statuses: ProposalStatus[], enabled = true) =>
  useQuery({
    enabled,
    queryKey: keys.proposals(athleteId, statuses.join(",")),
    queryFn: () => api.get<{ proposals: Proposal[] }>(`/proposals${qs({ athleteId, status: statuses.join(",") })}`).then((r) => r.proposals),
  });

export const useRuns = (athleteId: string | undefined) =>
  useQuery({ queryKey: keys.runs(athleteId ?? ""), queryFn: () => api.get<{ runs: AgentRun[] }>(`/analysis/runs${qs({ athleteId, limit: 5 })}`).then((r) => r.runs), enabled: Boolean(athleteId) });

export const useChat = (enabled = true) => useQuery({ queryKey: keys.chat, enabled, queryFn: () => api.get<{ messages: ChatMessage[] }>("/chat").then((r) => r.messages) });

export const useRanking = (enabled = true) => useQuery({ queryKey: keys.ranking, enabled, queryFn: () => api.get<{ ranking: RankingRow[] }>("/team/ranking").then((r) => r.ranking) });

/** After anything that can change the plan or the metrics, refetch every view that shows them. */
export function useInvalidateAthleteData() {
  const qc = useQueryClient();
  return () =>
    Promise.all(["dashboard", "calendar", "proposals", "runs", "ranking"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
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

export function useRunAnalysis() {
  const invalidate = useInvalidateAthleteData();
  return useMutation({
    mutationFn: (v: { athleteId: string; kind: "weekly" | "post_activity" }) => api.post<{ analysis: AnalysisResult }>("/analysis/run", v).then((r) => r.analysis),
    onSettled: invalidate,
  });
}
