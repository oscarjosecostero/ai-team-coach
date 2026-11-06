"use client";

import { Check, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useSession } from "@/components/shell/session";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, errorMessage } from "@/lib/api";
import { useDecideProposal, useProposals } from "@/lib/queries";
import { ProposalCard } from "./proposal-card";

export function ProposalsView() {
  const { user, athleteId, athleteName } = useSession();
  const isCoach = user?.role === "coach";
  const open = useProposals(athleteId, isCoach ? ["awaiting_coach", "pending"] : ["pending"], Boolean(athleteId));
  const history = useProposals(athleteId, ["accepted", "rejected", "expired"], Boolean(athleteId));
  const decide = useDecideProposal();

  const act = (id: string, decision: "accept" | "reject", note: string) =>
    decide.mutate(
      { id, decision, note: note.trim() || undefined },
      {
        onSuccess: () => toast.success(decision === "accept" ? "Accepted. Your calendar is updated." : "Rejected. Your plan stays as it was."),
        onError: (err) =>
          toast.error(err instanceof ApiError && err.code === "stale_proposal" ? "The workout changed since this proposal was made. Run a new analysis." : errorMessage(err)),
      },
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Proposals</h1>
        <p className="text-sm text-muted-foreground">
          {isCoach ? `What the coach agent proposed for ${athleteName ?? "this athlete"}. Review the waiting ones from the Team page.` : "Your coach proposes, you decide. Nothing changes in your plan until you accept."}
        </p>
      </div>
      <Tabs defaultValue="open">
        <TabsList>
          <TabsTrigger value="open">Open {open.data ? `(${open.data.length})` : ""}</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="open" className="space-y-4 pt-2">
          {(open.isPending || !athleteId) && <Skeleton className="h-64" />}
          {open.data?.length === 0 && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No open proposals. <Link href="/dashboard" className="underline underline-offset-4">Run an analysis</Link> from the dashboard.
            </p>
          )}
          {open.data?.map((p) => (
            <ProposalCard
              key={p.id}
              p={p}
              actions={
                !isCoach && p.userId === user?.id
                  ? (note) => (
                      <>
                        <Button onClick={() => act(p.id, "accept", note)} disabled={decide.isPending} data-testid="accept-proposal">
                          <Check /> Accept
                        </Button>
                        <Button variant="outline" onClick={() => act(p.id, "reject", note)} disabled={decide.isPending} data-testid="reject-proposal">
                          <X /> Reject
                        </Button>
                      </>
                    )
                  : undefined
              }
            />
          ))}
        </TabsContent>
        <TabsContent value="history" className="space-y-4 pt-2">
          {history.data?.length === 0 && <p className="text-sm text-muted-foreground">No decisions yet.</p>}
          {history.data?.map((p) => <ProposalCard key={p.id} p={p} />)}
        </TabsContent>
      </Tabs>
    </div>
  );
}
