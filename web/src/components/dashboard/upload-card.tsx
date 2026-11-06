"use client";

import { useMutation } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/api";
import { useInvalidateAthleteData } from "@/lib/queries";

type UploadResult = { created: number; duplicates: number };

/** FIT/GPX upload. The API stores it right away; metrics and the coach's check run in the background. */
export function UploadCard() {
  const input = useRef<HTMLInputElement>(null);
  const [sport, setSport] = useState("");
  const invalidate = useInvalidateAthleteData();

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      if (sport) form.append("sport", sport);
      form.append("file", file);
      return api.upload<UploadResult>("/uploads/activity", form);
    },
    onSuccess: (r) => {
      if (r.created) toast.success("Activity added. Metrics and the coach's check are updating in the background.");
      else toast.info("This activity was already uploaded.");
      void invalidate();
      // Metrics are recomputed by the worker; refresh again once it has had a moment.
      setTimeout(() => void invalidate(), 4000);
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => {
      if (input.current) input.current.value = "";
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload an activity</CardTitle>
        <CardDescription>A .fit or .gpx file from your watch or bike computer.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <select className="h-8 rounded-md border bg-background px-2 text-sm" value={sport} onChange={(e) => setSport(e.target.value)} aria-label="Sport (optional)">
          <option value="">Sport: from file</option>
          <option value="run">Run</option>
          <option value="bike">Bike</option>
          <option value="swim">Swim</option>
          <option value="strength">Strength</option>
          <option value="other">Other</option>
        </select>
        <input ref={input} type="file" accept=".fit,.gpx" className="sr-only" id="activity-file" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
        <Button variant="outline" size="sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
          <Upload /> {upload.isPending ? "Uploading…" : "Choose file"}
        </Button>
      </CardContent>
    </Card>
  );
}
