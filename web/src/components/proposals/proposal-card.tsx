"use client";

import { ArrowRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate, fmtMinutes, fmtNum, SPORT_LABEL, TYPE_LABEL } from "@/lib/format";
import type { Proposal } from "@/lib/types";
import { EvidenceList } from "./evidence-list";

const CHANGE_LABEL = { reduce: "Shorter session", replace: "Different session", move: "Move to another day", rest: "Rest day" } as const;
const STATUS_LABEL = { awaiting_coach: "Waiting for coach", pending: "Waiting for you", accepted: "Accepted", rejected: "Rejected", expired: "Expired" } as const;

function describe(w: { workoutType: string; sport: string; durationMin: number; title: string; targetZone?: number | null }) {
  if (w.workoutType === "rest") return "Rest";
  return `${SPORT_LABEL[w.sport] ?? w.sport} · ${TYPE_LABEL[w.workoutType] ?? w.workoutType} · ${fmtMinutes(w.durationMin)}${w.targetZone ? ` · Z${w.targetZone}` : ""}`;
}

/**
 * One proposal: the change (now -> proposed), the coach's reason, and the evidence as stored by the
 * backend. `actions` renders the decision controls for whoever may decide (athlete or coach).
 */
export function ProposalCard({ p, actions, showAthlete }: { p: Proposal; actions?: (note: string) => ReactNode; showAthlete?: boolean }) {
  const [note, setNote] = useState("");
  const w = p.workout;
  const after = w
    ? {
        ...w,
        ...(p.changeType === "rest" ? { workoutType: "rest", durationMin: 0, title: p.proposedChange.title ?? "Rest day" } : {}),
        ...Object.fromEntries(Object.entries(p.proposedChange).filter(([, v]) => v !== undefined)),
      }
    : null;
  const impact = p.evidence.find((f) => f.id.endsWith(":planned_load_after"));
  const before = p.evidence.find((f) => f.id.endsWith(":planned_load_before"));
  const decided = p.status !== "pending" && p.status !== "awaiting_coach";

  return (
    <Card data-testid="proposal-card" data-proposal-id={p.id}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={decided ? "secondary" : "default"}>{STATUS_LABEL[p.status]}</Badge>
          <Badge variant="outline">{CHANGE_LABEL[p.changeType]}</Badge>
          {p.confidence !== null && <span className="text-xs text-muted-foreground">confidence {Math.round(p.confidence * 100)}%</span>}
          {showAthlete && <span className="text-xs text-muted-foreground">· {p.athleteName}</span>}
        </div>
        <CardTitle className="pt-1">{w ? `${fmtDate(w.date)} · ${w.title}` : "Workout no longer exists"}</CardTitle>
        <CardDescription>Proposed {new Date(p.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {w && after && p.status === "accepted" && (
          // After acceptance the workout already IS the proposed version; the before/after loads stay in the evidence.
          <div className="rounded-lg border px-3 py-2">
            <div className="text-xs text-muted-foreground">Applied to your plan</div>
            <div className="text-sm font-medium">{w.title}</div>
            <div className="text-sm text-muted-foreground">{describe(w)}</div>
          </div>
        )}
        {w && after && p.status !== "accepted" && (
          <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
            <div className="rounded-lg border px-3 py-2">
              <div className="text-xs text-muted-foreground">Now</div>
              <div className="text-sm font-medium">{w.title}</div>
              <div className="text-sm text-muted-foreground">{describe(w)}</div>
              {before && <div className="text-xs text-muted-foreground tabular-nums">week planned load {fmtNum(Number(before.value))} TRIMP</div>}
            </div>
            <ArrowRight className="mx-auto size-4 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden />
            <div className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
              <div className="text-xs text-muted-foreground">Proposed{p.proposedChange.date && p.proposedChange.date !== w.date ? ` · ${fmtDate(p.proposedChange.date)}` : ""}</div>
              <div className="text-sm font-medium">{String(after.title)}</div>
              <div className="text-sm text-muted-foreground">{describe(after as typeof w)}</div>
              {impact && <div className="text-xs text-muted-foreground tabular-nums">week planned load {fmtNum(Number(impact.value))} TRIMP</div>}
            </div>
          </div>
        )}
        <p className="text-sm leading-relaxed">{p.reason}</p>
        {p.coachNote && <p className="rounded-lg bg-muted px-3 py-2 text-sm"><span className="font-medium">Coach note:</span> {p.coachNote}</p>}
        <EvidenceList evidence={p.evidence} />
        {actions && !decided && (
          <Textarea rows={2} maxLength={1000} placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note for this decision" />
        )}
      </CardContent>
      {actions && !decided && <CardFooter className="flex flex-wrap gap-2 border-t py-3">{actions(note)}</CardFooter>}
    </Card>
  );
}
