import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getPassport, type PassportLine } from "@/lib/api";
import { fmtDate } from "@/components/SiteShell";

const passportQuery = (code: string) =>
  queryOptions({ queryKey: ["passport", code], queryFn: () => getPassport(code) });

export const Route = createFileRoute("/passport/$code")({
  loader: async ({ context, params }) => {
    const p = await context.queryClient.ensureQueryData(passportQuery(params.code));
    if (!p) throw notFound();
    return { product: p.product };
  },
  head: ({ params, loaderData }) => ({
    meta: [
      { title: loaderData ? `${params.code} · ${loaderData.product} — Thread` : "Passport — Thread" },
      { name: "description", content: `Manufacturing journey of passport ${params.code}, recorded on Hedera.` },
      { property: "og:title", content: `Passport ${params.code} — Thread` },
      { property: "og:description", content: "Every step and handover, recorded by the company that did it." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  notFoundComponent: () => (
    <div className="text-center py-20">
      <h1 className="font-display text-3xl">No passport with this code</h1>
      <Link to="/" className="text-primary underline mt-4 inline-block">Back home</Link>
    </div>
  ),
  component: PassportPage,
});

const stepLabel: Record<string, string> = { weaving: "Weaving", dyeing: "Dyeing", sewing: "Sewing", finishing: "Washing & finishing" };
const originRows = [["weaving", "Woven in"], ["dyeing", "Dyed in"], ["sewing", "Sewn in"], ["finishing", "Washed in"]] as const;

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>;
}

function PassportPage() {
  const { code } = Route.useParams();
  const { data: p } = useSuspenseQuery(passportQuery(code));
  if (!p) return null;
  const lines = [...p.lines].sort((a, b) => a.n - b.n);
  return (
    <div className="space-y-10">
      {p.warnings.length > 0 && (
        <div className="rounded-2xl border border-destructive bg-warning text-warning-foreground p-4 space-y-1">
          {p.warnings.map((w) => <p key={w}>⚠ {w}</p>)}
        </div>
      )}
      <header className="rounded-3xl bg-denim text-primary-foreground p-8">
        <div className="font-mono text-sm opacity-80">Passport {p.code}</div>
        <h1 className="font-display text-3xl sm:text-4xl mt-2">{p.product}</h1>
        <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4 [&_dt]:text-primary-foreground/70">
          <Fact k="Pieces" v={p.pieces.toLocaleString("en")} />
          <Fact k="Weight" v={`${p.kg} kg`} />
          <Fact k="Code" v={<span className="font-mono">{p.code}</span>} />
          <Fact k="Current holder" v={`${p.holder.name}, ${p.holder.country}`} />
        </dl>
      </header>

      <section>
        <h2 className="font-display text-2xl mb-4">Where it was made</h2>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {originRows.map(([key, label]) => (
            <div key={key} className="rounded-2xl border border-border bg-card p-5">
              <div className="text-sm text-muted-foreground">{label}</div>
              {p.origins[key].map((o) => (
                <div key={o.n} className={o.standing !== "valid" ? "text-destructive" : ""}>
                  <div className="font-display text-xl">{o.country}</div>
                  <div className="text-sm">{o.company}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-display text-2xl mb-6">The journey</h2>
        <ol className="relative">
          {lines.map((l, i) => <Line key={l.n} l={l} last={i === lines.length - 1} />)}
        </ol>
      </section>
    </div>
  );
}

function Line({ l, last }: { l: PassportLine; last: boolean }) {
  const bad = l.standing === "withdrawn" || l.standing === "company_removed";
  return (
    <li id={`line-${l.n}`} className="relative pl-12 pb-8">
      {!last && <span className="stitch-line absolute left-[15px] top-8 bottom-0" />}
      <span className={`absolute left-0 top-0 w-8 h-8 rounded-full grid place-items-center text-xs font-mono font-semibold ${bad ? "bg-destructive text-destructive-foreground" : l.type === "handover" ? "bg-accent text-accent-foreground" : "bg-primary text-primary-foreground"}`}>{l.n}</span>
      <div className={`rounded-2xl border p-5 ${bad ? "border-destructive bg-warning" : "border-border bg-card"}`}>
        {bad && (
          <p className="text-sm font-semibold text-destructive mb-2">
            ⚠ {l.standing === "withdrawn" ? "This step was withdrawn by the company" : "The company that recorded this was removed"}
          </p>
        )}
        {l.type === "step" ? (
          <>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{stepLabel[l.step] ?? l.step}</div>
            <div className="font-display text-xl">{l.product}</div>
            <div className="text-sm mt-1">{l.company.name} · {l.company.country}</div>
            <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Fact k="Date" v={fmtDate(l.at)} />
              <Fact k="Weight" v={`${l.kg} kg`} />
              <Fact k="Pieces" v={l.pieces != null ? l.pieces.toLocaleString("en") : "—"} />
              <Fact k="Batch ref." v={<span className="font-mono">{l.reference}</span>} />
            </dl>
          </>
        ) : (
          <>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Handover</div>
            <div className="font-display text-xl">{l.from.name} → {l.to.name}</div>
            <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Fact k="Sent" v={fmtDate(l.sentAt)} />
              <Fact k="Received" v={fmtDate(l.at)} />
              <Fact k="Weight" v={`${l.kg} kg`} />
              <Fact k="Delivery note" v={<span className="font-mono">{l.reference}</span>} />
            </dl>
            {!bad && <span className="inline-flex mt-3 rounded-full bg-success text-success-foreground text-xs px-3 py-1">✓ Confirmed by both sides</span>}
          </>
        )}
        <a href="#" className="block mt-3 text-xs text-primary underline underline-offset-2">Proof on Hedera</a>
      </div>
    </li>
  );
}
