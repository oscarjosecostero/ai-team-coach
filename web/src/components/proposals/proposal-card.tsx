"use client";

import { ArrowRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { SessionProfile } from "@/components/charts/session-profile";
import { CitedText } from "@/components/cited-text";
import { SportIcon } from "@/components/sport";
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
  const after = p.proposed;
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
          <Side label="Applied to your plan" w={w} load={impact ? Number(impact.value) : null} />
        )}
        {w && after && p.status !== "accepted" && (
          <div className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]" data-testid="proposal-diff">
            <Side label="Now" w={w} load={before ? Number(before.value) : null} />
            <ArrowRight className="m-auto size-5 rotate-90 text-primary sm:rotate-0" aria-hidden />
            <Side
              label={`Proposed${after.date !== w.date ? ` · ${fmtDate(after.date)}` : ""}`}
              w={after}
              load={impact ? Number(impact.value) : null}
              highlight
            />
          </div>
        )}
        <CitedText text={p.reason} citations={p.evidence} className="text-sm leading-relaxed" />
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

/** One side of the change: the session, its intensity profile (backend-computed) and the week's planned load. */
function Side({ label, w, load, highlight }: { label: string; w: NonNullable<Proposal["proposed"]>; load: number | null; highlight?: boolean }) {
  return (
    <div className={highlight ? "brand-edge space-y-3 rounded-xl px-3 py-3" : "space-y-3 rounded-xl border px-3 py-3"}>
      <div className="flex items-center gap-2.5">
        <SportIcon sport={w.sport} rest={w.workoutType === "rest"} />
        <div className="min-w-0">
          <div className="eyebrow">{label}</div>
          <div className="truncate text-sm font-bold">{w.title}</div>
          <div className="text-sm text-muted-foreground">{describe(w)}</div>
        </div>
      </div>
      <SessionProfile blocks={w.shape} height={64} />
      {load !== null && <div className="text-xs text-muted-foreground tabular-nums">Week planned load {fmtNum(load)} TRIMP</div>}
    </div>
  );
}
