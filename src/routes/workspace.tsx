import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  approveCompany, ChainRefusal, confirmShipment, connectWallet, getCompanies, getWorkspace, makeProduct,
  recordMaterial, refuseShipment, shipLot, withdrawLot, type Workspace,
} from "@/lib/api";
import { fmtDate } from "@/components/SiteShell";

export const Route = createFileRoute("/workspace")({
  head: () => ({
    meta: [
      { title: "For companies — Thread" },
      { name: "description", content: "Companies sign their manufacturing steps on Hedera with their own wallet." },
      { property: "og:title", content: "For companies — Thread" },
      { property: "og:description", content: "Record, ship and confirm lots of clothes on Hedera." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorkspacePage,
});

const input = "w-full rounded-xl border border-input bg-card px-3 h-10 text-sm outline-none focus:ring-2 focus:ring-ring";
const btn = "rounded-full bg-primary text-primary-foreground h-10 px-5 text-sm font-semibold disabled:opacity-50";
const card = "rounded-2xl border border-border bg-card p-5";
type Msg = { ok: boolean; text: string } | null;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm space-y-1"><span className="text-muted-foreground">{label}</span>{children}</label>;
}

function WorkspacePage() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const ws = useQuery({ queryKey: ["workspace", address], queryFn: () => getWorkspace(address!), enabled: !!address });

  async function run(fn: () => Promise<{ message: string }>) {
    setBusy(true); setMsg(null);
    try { const r = await fn(); setMsg({ ok: true, text: r.message }); }
    catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      setMsg({ ok: false, text: e instanceof ChainRefusal ? "The chain refused: " + text : text });
    }
    finally { setBusy(false); ws.refetch(); }
  }

  if (!address) {
    return (
      <div className="max-w-lg space-y-5">
        <h1 className="font-display text-3xl">For companies</h1>
        <p className="text-muted-foreground">Each company signs its own steps with its wallet.</p>
        <button className={btn} disabled={connecting}
          onClick={async () => {
            setConnecting(true); setMsg(null);
            try { setAddress(await connectWallet()); }
            catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
            finally { setConnecting(false); }
          }}>
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
        {msg && <p role="alert" className="rounded-2xl bg-destructive text-destructive-foreground p-4 text-sm font-medium">{msg.text}</p>}
      </div>
    );
  }
  if (!ws.data) return <p className="text-muted-foreground">Loading your workspace…</p>;
  const w = ws.data;
  if (!w.company) {
    return (
      <div className="space-y-10">
        <div className={card}>
          <p className="font-semibold">{w.isOwner ? "This wallet owns the contract" : "This wallet is not an approved company"}</p>
          <p className="font-mono text-xs text-muted-foreground truncate mt-1">{address}</p>
          <p className="text-sm text-muted-foreground mt-2">
            {w.isOwner
              ? "It approves the companies that may record steps. It is not a company itself, so it records none."
              : "Only approved companies record steps. The owner of the contract approves a company by its wallet address."}
          </p>
        </div>
        {msg && (
          <div role="status" className={`rounded-2xl p-4 text-sm font-medium ${msg.ok ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground"}`}>
            {msg.text}
          </div>
        )}
        {w.isOwner && <Approve busy={busy} run={run} />}
      </div>
    );
  }
  const c = w.company;

  return (
    <div className="space-y-10">
      <header className={card + " flex flex-wrap items-center justify-between gap-3"}>
        <div>
          <h1 className="font-display text-3xl">{c.name}</h1>
          <div className="text-sm text-muted-foreground">{c.country}</div>
          <div className="font-mono text-xs text-muted-foreground truncate">{c.address}</div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs ${c.approved ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground"}`}>
          {c.approved ? "Approved" : "Not approved"}
        </span>
      </header>

      {msg && (
        <div role="status" className={`rounded-2xl p-4 text-sm font-medium ${msg.ok ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground"}`}>
          {msg.text}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-2xl">Deliveries waiting for you</h2>
        {w.incoming.length === 0 && <p className="text-muted-foreground text-sm">Nothing waiting.</p>}
        {w.incoming.map((d) => (
          <div key={d.shipment} className={card + " flex flex-wrap items-center justify-between gap-3"}>
            <div>
              <div className="font-semibold">{d.product}</div>
              <div className="text-sm text-muted-foreground">From {d.from.name}, {d.from.country} · {d.kg} kg · note {d.reference} · sent {fmtDate(d.sentAt)}</div>
            </div>
            <div className="flex gap-2">
              <button className={btn} disabled={busy} onClick={() => run(() => confirmShipment(d.shipment))}>Confirm receipt</button>
              <button className="rounded-full border border-border h-10 px-5 text-sm disabled:opacity-50" disabled={busy}
                onClick={() => run(() => refuseShipment(d.shipment))}>Refuse</button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl">Your lots</h2>
        {w.lots.map((l) => (
          <div key={l.lot} className={card + " flex flex-wrap items-center justify-between gap-3"}>
            <div>
              <div className="font-semibold">{l.product}</div>
              <div className="text-sm text-muted-foreground">Batch {l.reference} · {l.step} · {l.kg} kg left of {l.madeKg} kg</div>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/passport/$code" params={{ code: l.code }} className="font-mono text-sm text-primary underline">{l.code}</Link>
              {l.canWithdraw && (
                <AlertDialog>
                  <AlertDialogTrigger className="text-xs text-destructive underline">Withdraw this step</AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Withdraw this step?</AlertDialogTitle>
                      <AlertDialogDescription>{l.product} ({l.reference}) will be marked as withdrawn on every passport that uses it.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => run(() => withdrawLot(l.lot))}>Withdraw</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        ))}
      </section>

      <RecordStep w={w} busy={busy} run={run} />
      {w.isOwner && <Approve busy={busy} run={run} />}
    </div>
  );
}

type RunFn = (fn: () => Promise<{ message: string }>) => Promise<void>;

function RecordStep({ w, busy, run }: { w: Workspace; busy: boolean; run: RunFn }) {
  const source = !!w.company?.source;
  const [tab, setTab] = useState<"make" | "ship" | "new">("make");
  const tabs = [["make", "Make something"], ["ship", "Ship"], ...(source ? [["new", "New material"]] : [])] as [typeof tab, string][];
  return (
    <section className="space-y-3">
      <h2 className="font-display text-2xl">Record a step</h2>
      <div role="tablist" className="flex gap-1">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 rounded-full text-sm ${tab === k ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>{label}</button>
        ))}
      </div>
      <div className={card}>
        {tab === "make" && <MakeForm w={w} busy={busy} run={run} />}
        {tab === "ship" && <ShipForm w={w} busy={busy} run={run} />}
        {tab === "new" && source && <NewForm busy={busy} run={run} />}
      </div>
    </section>
  );
}

function MakeForm({ w, busy, run }: { w: Workspace; busy: boolean; run: RunFn }) {
  const [used, setUsed] = useState<Record<number, string>>({});
  const [picked, setPicked] = useState<number[]>([]);
  const [step, setStep] = useState("sewing");
  const [product, setProduct] = useState(""); const [reference, setReference] = useState("");
  const [pieces, setPieces] = useState(""); const [kg, setKg] = useState("");
  const stock = w.lots.filter((l) => l.kg > 0);
  // A lot that was used up since it was ticked is no longer part of the step.
  const chosen = picked.filter((id) => stock.some((l) => l.lot === id));
  const total = chosen.reduce((s, l) => s + (Number(used[l]) || 0), 0);
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault();
      run(() => makeProduct({ inputs: chosen.map((l) => ({ lot: l, kg: Number(used[l]) || 0 })), step, product, reference, pieces: Number(pieces) || 0, kg: Number(kg) || 0 })); }}>
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground">Lots used</div>
        {stock.length === 0 && <p className="text-sm text-muted-foreground">You hold no lot with anything left in it.</p>}
        {stock.map((l) => (
          <div key={l.lot} className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={chosen.includes(l.lot)} aria-label={`Use ${l.code}`}
              onChange={(e) => setPicked(e.target.checked ? [...chosen, l.lot] : chosen.filter((x) => x !== l.lot))} />
            <span className="flex-1 min-w-0">{l.product} · {l.code} · {l.kg} kg left</span>
            {chosen.includes(l.lot) && <input className={input.replace("w-full ", "") + " w-28 shrink-0"} type="number" min="0" placeholder="kg used" aria-label={`kg used from ${l.code}`}
              value={used[l.lot] ?? ""} onChange={(e) => setUsed({ ...used, [l.lot]: e.target.value })} />}
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Step"><select className={input} value={step} onChange={(e) => setStep(e.target.value)}><option value="sewing">Sewing</option><option value="finishing">Finishing</option></select></Field>
        <Field label="Product name"><input className={input} required value={product} onChange={(e) => setProduct(e.target.value)} /></Field>
        <Field label="Batch reference"><input className={input} required value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Number of pieces"><input className={input} type="number" min="0" value={pieces} onChange={(e) => setPieces(e.target.value)} /></Field>
        <Field label="Weight out (kg)"><input className={input} type="number" min="0" required value={kg} onChange={(e) => setKg(e.target.value)} /></Field>
        <div className="text-sm self-end pb-2">Total used: <span className="font-semibold">{total} kg</span> · out: <span className={`font-semibold ${Number(kg) > total ? "text-destructive" : ""}`}>{Number(kg) || 0} kg</span></div>
      </div>
      <button className={btn} disabled={busy || chosen.length === 0}>Record this step</button>
    </form>
  );
}

function ShipForm({ w, busy, run }: { w: Workspace; busy: boolean; run: RunFn }) {
  const companies = useQuery({ queryKey: ["companies"], queryFn: getCompanies });
  const stock = w.lots.filter((l) => l.kg > 0);
  const [lot, setLot] = useState(String(stock[0]?.lot ?? ""));
  const [to, setTo] = useState(""); const [kg, setKg] = useState(""); const [reference, setReference] = useState("");
  const others = (companies.data ?? []).filter((c) => c.approved && c.address.toLowerCase() !== w.company?.address.toLowerCase());
  // The lot that is really selected: the one chosen, or the first one once that lot has been shipped away.
  const current = stock.some((l) => String(l.lot) === lot) ? lot : String(stock[0]?.lot ?? "");
  if (stock.length === 0) return <p className="text-sm text-muted-foreground">You hold no lot with anything left in it.</p>;
  return (
    <form className="grid sm:grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); run(() => shipLot({ lot: Number(current), to, kg: Number(kg) || 0, reference })); }}>
      <Field label="Lot"><select className={input} value={current} onChange={(e) => setLot(e.target.value)}>
        {stock.map((l) => <option key={l.lot} value={l.lot}>{l.code} · {l.product} ({l.kg} kg)</option>)}</select></Field>
      <Field label="Receiving company"><select className={input} required value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Choose…</option>{others.map((c) => <option key={c.address} value={c.address}>{c.name}, {c.country}</option>)}</select></Field>
      <Field label="Weight (kg)"><input className={input} type="number" min="0" required value={kg} onChange={(e) => setKg(e.target.value)} /></Field>
      <Field label="Delivery note number"><input className={input} required value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      <div><button className={btn} disabled={busy}>Ship</button></div>
    </form>
  );
}

function NewForm({ busy, run }: { busy: boolean; run: RunFn }) {
  const [step, setStep] = useState("weaving"); const [product, setProduct] = useState("");
  const [reference, setReference] = useState(""); const [kg, setKg] = useState("");
  return (
    <form className="grid sm:grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); run(() => recordMaterial({ step, product, reference, kg: Number(kg) || 0 })); }}>
      <Field label="Step"><select className={input} value={step} onChange={(e) => setStep(e.target.value)}><option value="weaving">Weaving</option><option value="dyeing">Dyeing</option></select></Field>
      <Field label="Product"><input className={input} required value={product} onChange={(e) => setProduct(e.target.value)} /></Field>
      <Field label="Batch reference"><input className={input} required value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      <Field label="Weight (kg)"><input className={input} type="number" min="0" required value={kg} onChange={(e) => setKg(e.target.value)} /></Field>
      <div><button className={btn} disabled={busy}>Record material</button></div>
    </form>
  );
}

function Approve({ busy, run }: { busy: boolean; run: RunFn }) {
  const [address, setAddress] = useState(""); const [name, setName] = useState("");
  const [country, setCountry] = useState(""); const [source, setSource] = useState(false);
  return (
    <section className="space-y-3">
      <h2 className="font-display text-2xl">Approve a company</h2>
      <form className={card + " grid sm:grid-cols-2 gap-3"} onSubmit={(e) => { e.preventDefault(); run(() => approveCompany({ address, name, country, source })); }}>
        <Field label="Wallet address"><input className={input} required value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="Name"><input className={input} required value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Country"><input className={input} required value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm self-end pb-2"><input type="checkbox" checked={source} onChange={(e) => setSource(e.target.checked)} /> Can record new material</label>
        <div><button className={btn} disabled={busy}>Approve</button></div>
      </form>
    </section>
  );
}
