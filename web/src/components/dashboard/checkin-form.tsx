"use client";

import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { CheckinRequest } from "@coach/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { useInvalidateAthleteData } from "@/lib/queries";
import type { Checkin } from "@/lib/types";

const SCALE = [1, 2, 3, 4, 5];

function ScalePicker({ name, label, value, onChange, low, high }: { name: string; label: string; value: number | null; onChange: (v: number) => void; low: string; high: string }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex items-center gap-1">
        {SCALE.map((n) => (
          <label key={n} className="cursor-pointer">
            <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} className="peer sr-only" />
            <span className="grid size-8 place-items-center rounded-md border text-sm peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{n}</span>
          </label>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </fieldset>
  );
}

/** Daily wellness check-in (resting HR is not in activity files, so it comes from here). */
export function CheckinForm({ latest, today }: { latest: Checkin | null; today: string }) {
  const done = latest?.date === today;
  const [restingHr, setRestingHr] = useState(done && latest?.restingHr ? String(latest.restingHr) : "");
  const [sleep, setSleep] = useState(done && latest?.sleepHours ? String(latest.sleepHours) : "");
  const [fatigue, setFatigue] = useState<number | null>(done ? latest?.fatigue ?? null : null);
  const [soreness, setSoreness] = useState<number | null>(done ? latest?.soreness ?? null : null);
  const [note, setNote] = useState(done ? latest?.note ?? "" : "");
  const invalidate = useInvalidateAthleteData();

  const save = useMutation({
    mutationFn: (body: CheckinRequest) => api.post<{ checkin: Checkin }>("/checkins", body),
    onSuccess: () => {
      toast.success("Check-in saved.");
      void invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      restingHr: restingHr ? Number(restingHr) : null,
      sleepHours: sleep ? Number(sleep) : null,
      fatigue,
      soreness,
      note: note.trim() || null,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily check-in</CardTitle>
        <CardDescription>{done ? "Saved for today. Update it any time." : "Thirty seconds: it helps the coach read your recovery."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rhr">Resting HR (bpm)</Label>
              <Input id="rhr" type="number" inputMode="numeric" min={25} max={120} value={restingHr} onChange={(e) => setRestingHr(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sleep">Sleep (hours)</Label>
              <Input id="sleep" type="number" inputMode="decimal" step="0.1" min={0} max={24} value={sleep} onChange={(e) => setSleep(e.target.value)} />
            </div>
          </div>
          <ScalePicker name="fatigue" label="Fatigue" value={fatigue} onChange={setFatigue} low="Fresh" high="Exhausted" />
          <ScalePicker name="soreness" label="Soreness" value={soreness} onChange={setSoreness} low="None" high="Can't train" />
          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Textarea id="note" rows={2} maxLength={2000} placeholder="Anything worth knowing: sleep, stress, a niggle…" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save check-in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
