import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listPassports } from "@/lib/api";

const passportsQuery = queryOptions({ queryKey: ["passports"], queryFn: listPassports });

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Thread — the passport of your clothes" },
      { name: "description", content: "Every manufacturing step of a batch of clothes, recorded on Hedera by the company that did it." },
      { property: "og:title", content: "Thread — the passport of your clothes" },
      { property: "og:description", content: "Every manufacturing step, recorded on Hedera by the company that did it." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(passportsQuery),
  component: Home,
});

const steps = [
  ["Each company records its own step", "The mill, the factory and the brand each write what they did, under their own name."],
  ["Each handover is confirmed by both sides", "The sender records the shipment, the receiver confirms it arrived."],
  ["Anyone can check the journey", "Type a passport code, or paste a delivery note to compare it with the record."],
];

function Home() {
  const { data } = useSuspenseQuery(passportsQuery);
  const [code, setCode] = useState("");
  const navigate = useNavigate();
  return (
    <div className="space-y-14">
      <section className="rounded-3xl bg-denim text-primary-foreground p-8 sm:p-12">
        <p className="text-sm uppercase tracking-widest opacity-80">Thread · khit, in Tunisian Arabic</p>
        <h1 className="font-display text-4xl sm:text-5xl mt-3 max-w-2xl leading-tight">The passport of a batch of clothes.</h1>
        <form
          className="mt-8 flex flex-col sm:flex-row gap-3 max-w-xl"
          onSubmit={(e) => { e.preventDefault(); if (code.trim()) navigate({ to: "/passport/$code", params: { code: code.trim().toUpperCase() } }); }}
        >
          <input
            value={code} onChange={(e) => setCode(e.target.value)} placeholder="Passport code, e.g. KHIT-6"
            aria-label="Passport code"
            className="flex-1 rounded-full bg-card text-foreground px-5 h-12 font-mono outline-none focus:ring-2 focus:ring-accent"
          />
          <button className="rounded-full bg-accent text-accent-foreground h-12 px-6 font-semibold hover:opacity-90">See the passport</button>
        </form>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {steps.map(([t, d], i) => (
          <div key={t} className="rounded-2xl border border-border bg-card p-6">
            <div className="font-display text-3xl text-accent">{i + 1}</div>
            <h2 className="font-semibold mt-2">{t}</h2>
            <p className="text-sm text-muted-foreground mt-1">{d}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="font-display text-2xl mb-4">Passports</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {data.map((p) => (
            <Link key={p.code} to="/passport/$code" params={{ code: p.code }}
              className="rounded-2xl border border-border bg-card p-6 hover:border-primary transition-colors">
              <div className="font-mono text-sm text-primary">{p.code}</div>
              <div className="font-display text-xl mt-1">{p.product}</div>
              <div className="text-sm text-muted-foreground mt-2">{p.pieces.toLocaleString("en")} pieces · {p.kg} kg</div>
              <div className="text-sm mt-1">Held by {p.holder}, {p.holderCountry}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
