import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getCompanies } from "@/lib/api";
import { fmtDate } from "@/components/SiteShell";

const q = queryOptions({ queryKey: ["companies"], queryFn: getCompanies });

export const Route = createFileRoute("/companies")({
  head: () => ({
    meta: [
      { title: "Companies — Thread" },
      { name: "description", content: "The companies allowed to record steps in Thread passports." },
      { property: "og:title", content: "Companies — Thread" },
      { property: "og:description", content: "Who can record steps on Hedera, and their standing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: Companies,
});

function Companies() {
  const { data } = useSuspenseQuery(q);
  return (
    <div>
      <h1 className="font-display text-3xl mb-6">Companies</h1>
      <div className="grid gap-4">
        {data.map((c) => (
          <div key={c.address} className="rounded-2xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div className="min-w-0">
              <div className="font-display text-xl">{c.name}</div>
              <div className="text-sm text-muted-foreground">{c.country} · since {fmtDate(c.since)}</div>
              <div className="font-mono text-xs text-muted-foreground truncate mt-1">{c.address}</div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-secondary text-secondary-foreground px-3 py-1">{c.source ? "Can record new material" : "Works on received material"}</span>
              <span className={`rounded-full px-3 py-1 ${c.approved ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground"}`}>{c.approved ? "Approved" : "Removed"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
