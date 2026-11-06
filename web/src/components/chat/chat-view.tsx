"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SendHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { CitedText } from "@/components/cited-text";
import { useSession } from "@/components/shell/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { keys, useChat, useInvalidateAthleteData } from "@/lib/queries";
import type { ChatMessage, Proposal } from "@/lib/types";
import { cn } from "cn";

const SUGGESTIONS = ["Am I ready for my race?", "Why do my legs feel heavy this week?", "How did this week compare to last week?", "Can you make Thursday easier?"];

export function ChatView() {
  const { user } = useSession();
  const chat = useChat(user?.role === "athlete");
  const qc = useQueryClient();
  const router = useRouter();
  const invalidate = useInvalidateAthleteData();
  const [draft, setDraft] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const send = useMutation({
    mutationFn: (message: string) => api.post<{ message: ChatMessage; proposals: Proposal[] }>("/chat", { message }),
    onMutate: (message) => setPendingQuestion(message),
    onSuccess: (r) => {
      if (r.proposals.length) {
        toast.success("Your coach made a proposal.", { action: { label: "Review", onClick: () => router.push("/proposals") } });
        void invalidate();
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: keys.chat });
      setPendingQuestion(null);
    },
  });

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [chat.data?.length, pendingQuestion]);

  if (user && user.role !== "athlete") return <p className="text-sm text-muted-foreground">Chat is for athletes, about their own training.</p>;

  const submit = (text: string) => {
    const message = text.trim();
    if (!message || send.isPending) return;
    setDraft("");
    send.mutate(message);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(draft);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(draft);
    }
  };

  const messages = chat.data ?? [];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Coach chat</h1>
        <p className="text-sm text-muted-foreground">Answers come from your own data. Highlighted figures are the backend’s values, not the model’s.</p>
      </div>
      <Card>
        <CardContent className="space-y-4" aria-live="polite">
          {messages.length === 0 && !pendingQuestion && (
            <div className="space-y-3 py-4 text-center">
              <p className="text-sm text-muted-foreground">Ask about your training. For example:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <Button key={s} variant="outline" size="sm" onClick={() => submit(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <Bubble key={m.id} role={m.role}>
              {m.role === "assistant" ? <CitedText text={m.content} citations={m.citations} className="leading-relaxed whitespace-pre-wrap" /> : <p className="whitespace-pre-wrap">{m.content}</p>}
            </Bubble>
          ))}
          {pendingQuestion && (
            <>
              <Bubble role="user">
                <p className="whitespace-pre-wrap">{pendingQuestion}</p>
              </Bubble>
              <Bubble role="assistant">
                <p className="text-muted-foreground">Looking at your data…</p>
              </Bubble>
            </>
          )}
          <div ref={bottom} />
        </CardContent>
      </Card>
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <Textarea
          rows={2}
          maxLength={2000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask your coach… (Enter to send, Shift+Enter for a new line)"
          aria-label="Message"
          disabled={send.isPending}
        />
        <Button type="submit" size="icon-lg" disabled={send.isPending || !draft.trim()} aria-label="Send">
          <SendHorizontal />
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Plan changes the coach suggests show up in <Link href="/proposals" className="underline underline-offset-4">Proposals</Link>. Not medical advice: for pain or injury, see a professional.
      </p>
    </div>
  );
}

function Bubble({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  return (
    <div className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm", role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>{children}</div>
    </div>
  );
}
