"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ProposalCard } from "@/components/proposals/proposal-card";
import { useSession } from "@/components/shell/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { fmtDuration, fmtNum, fmtWeek } from "@/lib/format";
import { useCoachReview, useProposals, useRanking } from "@/lib/queries";
import type { Proposal } from "@/lib/types";

export function TeamView() {
  const { user, setAthleteId } = useSession();
  const router = useRouter();
  const ranking = useRanking(Boolean(user));
  const isCoach = user?.role === "coach";
  const max = Math.max(1, ...(ranking.data ?? []).map((r) => r.totalDurationS));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
        <p className="text-sm text-muted-foreground">
          {ranking.data?.[0] ? `Training volume, week of ${fmtWeek(ranking.data[0].weekStart)}. ` : ""}
          Teammates see aggregates only: no notes, check-ins or activity details.
        </p>
      </div>
      {isCoach && <ReviewQueue />}
      <Card>
        <CardHeader>
          <CardTitle>This week’s ranking</CardTitle>
          <CardDescription>By training time. ACWR above 1.5 is flagged.</CardDescription>
        </CardHeader>
        <CardContent>
          {ranking.isPending || !user ? (
            <Skeleton className="h-40" />
          ) : (
            <table className="w-full text-sm" data-testid="ranking">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 py-2 font-normal">#</th>
                  <th className="py-2 font-normal">Athlete</th>
                  <th className="py-2 font-normal">Training time</th>
                  <th className="py-2 text-right font-normal">Load</th>
                  <th className="py-2 text-right font-normal">Hard</th>
                  <th className="py-2 text-right font-normal">ACWR</th>
                  {isCoach && <th className="py-2" />}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {ranking.data?.map((r) => (
                  <tr key={r.athleteId} className="border-t">
                    <td className="py-2 text-muted-foreground">{r.rank}</td>
                    <td className="py-2 font-medium">
                      {r.name}
                      {r.athleteId === user?.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 rounded-full" style={{ background: "var(--viz-track)" }} aria-hidden>
                          <div className="h-2 rounded-full" style={{ width: `${(r.totalDurationS / max) * 100}%`, background: "var(--viz-series-1)" }} />
                        </div>
                        {fmtDuration(r.totalDurationS)}
                      </div>
                    </td>
                    <td className="py-2 text-right">{fmtNum(r.totalLoad)}</td>
                    <td className="py-2 text-right">{r.hardSessions}</td>
                    <td className="py-2 text-right">
                      {r.acwr !== null && r.acwr > 1.5 ? <span style={{ color: "var(--status-critical)" }}>▲ {fmtNum(r.acwr, 2)}</span> : fmtNum(r.acwr, 2)}
                    </td>
                    {isCoach && (
                      <td className="py-2 text-right">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            setAthleteId(r.athleteId);
                            router.push("/dashboard");
                          }}
                        >
                          Open
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Coach review: proposals created while the team has coach review on wait here before the athlete sees them. */
function ReviewQueue() {
  const queue = useProposals(undefined, ["awaiting_coach"]);
  const review = useCoachReview();

  return (
    <section className="space-y-3" aria-labelledby="queue-title">
      <h2 id="queue-title" className="text-lg font-semibold">
        Review queue {queue.data ? `(${queue.data.length})` : ""}
      </h2>
      {queue.data?.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting. When coach review is on, new proposals land here first.</p>}
      {queue.data?.map((p) => <QueueItem key={p.id} p={p} onReview={(action, note, durationMin) =>
        review.mutate(
          { id: p.id, action, note, durationMin },
          { onSuccess: () => toast.success(action === "approve" ? "Sent to the athlete." : "Proposal rejected."), onError: (err) => toast.error(errorMessage(err)) },
        )
      } busy={review.isPending} />)}
    </section>
  );
}

function QueueItem({ p, onReview, busy }: { p: Proposal; onReview: (a: "approve" | "reject", note?: string, durationMin?: number) => void; busy: boolean }) {
  const [duration, setDuration] = useState(p.proposedChange.durationMin !== undefined ? String(p.proposedChange.durationMin) : "");
  const editable = p.proposedChange.durationMin !== undefined;
  return (
    <ProposalCard
      p={p}
      showAthlete
      actions={(note) => (
        <>
          {editable && (
            <label className="flex items-center gap-2 text-sm">
              Duration
              <Input type="number" min={0} max={600} className="h-8 w-20" value={duration} onChange={(e) => setDuration(e.target.value)} aria-label="Edited duration in minutes" />
              min
            </label>
          )}
          <Button
            onClick={() => {
              const edited = editable && duration !== "" && Number(duration) !== p.proposedChange.durationMin ? Number(duration) : undefined;
              onReview("approve", note.trim() || undefined, edited);
            }}
            disabled={busy}
          >
            <Check /> Approve
          </Button>
          <Button variant="outline" onClick={() => onReview("reject", note.trim() || undefined)} disabled={busy}>
            <X /> Reject
          </Button>
        </>
      )}
    />
  );
}
