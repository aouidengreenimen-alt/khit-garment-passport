import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { checkPaper, getSamples } from "@/lib/api";

const samplesQuery = queryOptions({ queryKey: ["samples"], queryFn: getSamples });

export const Route = createFileRoute("/check")({
  head: () => ({
    meta: [
      { title: "Check a paper — Khit" },
      { name: "description", content: "Paste a delivery note and compare each statement with the passport on Hedera." },
      { property: "og:title", content: "Check a paper — Khit" },
      { property: "og:description", content: "Compare a delivery note with the passport recorded on Hedera." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(samplesQuery),
  component: Check,
});

const statuses = {
  verified: { label: "On Hedera", cls: "bg-success text-success-foreground" },
  differs: { label: "Chain says otherwise", cls: "bg-destructive text-destructive-foreground" },
  withdrawn: { label: "Step withdrawn", cls: "bg-warning text-warning-foreground" },
  not_found: { label: "No record", cls: "bg-muted text-muted-foreground border border-border" },
} as const;
type S = keyof typeof statuses;

function Check() {
  const { data: samples } = useSuspenseQuery(samplesQuery);
  const [text, setText] = useState("");
  const m = useMutation({ mutationFn: checkPaper });
  const r = m.data;
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl">Check a paper</h1>
        <p className="text-muted-foreground mt-1">Paste a delivery note. Each statement is compared with the passport.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {samples.map((s) => (
          <button key={s.id} onClick={() => setText(s.text)} className="rounded-full border border-border bg-card px-4 py-2 text-sm hover:border-primary">
            Load: {s.label}
          </button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder="Paste a delivery note here…"
        aria-label="Delivery note"
        className="w-full rounded-2xl border border-input bg-card p-4 font-mono text-sm outline-none focus:ring-2 focus:ring-ring" />
      <button disabled={!text.trim() || m.isPending} onClick={() => m.mutate(text)}
        className="rounded-full bg-primary text-primary-foreground h-12 px-8 font-semibold disabled:opacity-50">
        {m.isPending ? "Checking…" : "Check this paper"}
      </button>

      {r && (
        <section className="space-y-4">
          <h2 className="font-display text-2xl">Report for <Link to="/passport/$code" params={{ code: r.code }} className="text-primary underline">{r.code}</Link></h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(Object.keys(statuses) as S[]).map((k) => (
              <div key={k} className="rounded-2xl border border-border bg-card p-4">
                <div className="font-display text-3xl">{r.counts[k]}</div>
                <span className={`inline-block mt-1 rounded-full text-xs px-2 py-0.5 ${statuses[k].cls}`}>{statuses[k].label}</span>
              </div>
            ))}
          </div>
          <ul className="space-y-3">
            {r.claims.map((c) => {
              const st = statuses[c.status as S];
              return (
                <li key={c.n} className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <span className={`rounded-full text-xs px-3 py-1 font-semibold ${st.cls}`}>{st.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.line != null ? <Link to="/passport/$code" params={{ code: r.code }} hash={`line-${c.line}`} className="underline">Passport line {c.line}</Link> : "No passport line"}
                    </span>
                  </div>
                  <blockquote className="mt-3 border-l-2 border-accent pl-3 font-mono text-sm">“{c.quote}”</blockquote>
                  <p className="mt-2 text-sm">{c.note}</p>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">Checked {new Date(r.checkedAt).toLocaleString("en-GB")} · logged on Hedera topic {r.log.topicId} #{r.log.sequenceNumber}</p>
        </section>
      )}
    </div>
  );
}
