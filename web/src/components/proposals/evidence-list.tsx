import { Calculator, Quote } from "lucide-react";
import type { Fact } from "@/lib/types";
import { fmtFactValue } from "@/lib/format";

/** Evidence as stored by the backend: the facts the agent cited plus the impact the backend computed. */
export function EvidenceList({ evidence }: { evidence: Fact[] }) {
  const cited = evidence.filter((f) => f.source !== "computed");
  const computed = evidence.filter((f) => f.source === "computed");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <Quote className="size-3.5" aria-hidden /> Evidence cited
        </h4>
        <dl className="divide-y rounded-lg border text-sm">
          {cited.map((f) => (
            <div key={f.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5" title={f.id}>
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="text-right font-medium tabular-nums">{fmtFactValue(f)}</dd>
            </div>
          ))}
        </dl>
      </div>
      {computed.length > 0 && (
        <div>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Calculator className="size-3.5" aria-hidden /> Plan impact (computed by the backend)
          </h4>
          <dl className="divide-y rounded-lg border text-sm">
            {computed.map((f) => (
              <div key={f.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5" title={f.id}>
                <dt className="text-muted-foreground">{f.label}</dt>
                <dd className="text-right font-medium tabular-nums">{fmtFactValue(f)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
