import type { Fact } from "@/lib/types";
import { fmtFactValue } from "@/lib/format";

/**
 * Renders agent text with its inline [[fact-id]] citations replaced by chips that show the
 * BACKEND value of each fact (never a number typed by the model). Unknown ids were already
 * removed by the API; anything still unresolved is dropped here too.
 */
export function CitedText({ text, citations, className }: { text: string; citations: Fact[]; className?: string }) {
  const byId = new Map(citations.map((c) => [c.id, c]));
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return (
    <p className={className}>
      {parts.map((part, i) => {
        const m = /^\[\[([^\]]+)\]\]$/.exec(part);
        if (!m) return <span key={i}>{part}</span>;
        const fact = byId.get(m[1]!);
        if (!fact) return null;
        return (
          <span
            key={i}
            className="mx-0.5 inline-flex items-baseline gap-1 rounded-md border bg-muted/60 px-1.5 py-px align-baseline text-[0.8em] whitespace-nowrap"
            title={`${fact.label} · backend value (${fact.id})`}
            data-fact-id={fact.id}
          >
            <span className="font-medium text-foreground">{fmtFactValue(fact)}</span>
            <span className="text-muted-foreground">{fact.label}</span>
          </span>
        );
      })}
    </p>
  );
}
