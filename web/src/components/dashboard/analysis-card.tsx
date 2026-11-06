"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { CitedText } from "@/components/cited-text";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage } from "@/lib/api";
import { useRunAnalysis, useRuns } from "@/lib/queries";

const KIND = { weekly: "Weekly review", post_activity: "Post-activity check", chat: "Chat" } as const;

/** Latest coach summary, plus the manual "Run analysis" trigger. */
export function AnalysisCard({ athleteId }: { athleteId: string }) {
  const runs = useRuns(athleteId);
  const run = useRunAnalysis();
  const latest = runs.data?.find((r) => r.kind !== "chat" && r.status === "succeeded");

  const start = () =>
    run.mutate(
      { athleteId, kind: "weekly" },
      {
        onSuccess: (a) => {
          if (a.status === "failed") toast.error("The analysis did not finish. Try again in a moment.");
          else toast.success(a.proposals.length ? `Analysis done: ${a.proposals.length} proposal(s) to review.` : "Analysis done: no change needed.");
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" aria-hidden /> Coach summary
        </CardTitle>
        <CardDescription>{latest ? `${KIND[latest.kind]} · ${new Date(latest.startedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · ${latest.model}` : "No analysis yet."}</CardDescription>
        <CardAction>
          <Button size="sm" onClick={start} disabled={run.isPending} data-testid="run-analysis">
            {run.isPending ? "Analyzing… (up to a minute)" : "Run analysis"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        {latest?.summary ? <CitedText text={latest.summary} citations={latest.citations} className="text-sm leading-relaxed" /> : <p className="text-sm text-muted-foreground">Run an analysis to get a summary of your week and, if the data supports it, a proposed change to your plan.</p>}
        {latest && latest.proposalIds.length > 0 && (
          <Link href="/proposals" className="text-sm font-medium underline underline-offset-4">
            Review the proposal →
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
