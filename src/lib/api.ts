// The only data access layer.
//
// When these pages are served by the Thread agent (the chain/ folder of this
// repository), every function below talks to it, and through it to the
// passport contract on Hedera. Companies sign their own steps with MetaMask.
//
// Anywhere else (the Lovable preview, for example) there is no agent, and the
// same functions answer with the sample data in src/data/mock.ts, so the pages
// can still be looked at. getSource() says which of the two is in use, and the
// footer shows it, so sample data is never mistaken for the real chain.
import * as mock from "@/data/mock";

// ───────────────────────── shapes ─────────────────────────

export type CompanyRef = { name: string; country: string; address: string; approved: boolean };
export type Standing = "valid" | "withdrawn" | "company_removed" | string;
export type StepLine = {
  n: number;
  type: "step";
  lot: number;
  step: string;
  company: CompanyRef;
  at: number;
  kg: number;
  product: string | null;
  reference: string | null;
  pieces: number | null;
  note: string;
  standing: Standing;
  withdrawnAt: number | null;
  proof?: string | null;
};
export type HandoverLine = {
  n: number;
  type: "handover";
  lot: number;
  shipment: number;
  from: CompanyRef;
  to: CompanyRef;
  sentAt: number;
  at: number;
  kg: number;
  reference: string | null;
  standing: Standing;
  proof?: string | null;
};
export type PassportLine = StepLine | HandoverLine;
export type Origin = { country: string; company: string; standing: Standing; n: number };
export type Passport = {
  lot: number;
  code: string;
  holder: CompanyRef;
  kg: number;
  madeKg: number;
  product: string | null;
  reference: string | null;
  pieces: number | null;
  origins: Record<"weaving" | "dyeing" | "sewing" | "finishing", Origin[]>;
  lines: PassportLine[];
  warnings: string[];
};
export type PassportSummary = {
  code: string;
  lot: number;
  product: string;
  pieces: number | null;
  kg: number;
  holder: string;
  holderCountry: string;
};
export type Company = CompanyRef & { source: boolean; since: number };
export type Sample = { id: string; label: string; text: string };
export type Claim = {
  n: number;
  kind: string;
  claim: string;
  quote: string;
  status: string;
  note: string;
  by: string;
  line: number | null;
};
export type Report = {
  lot: number;
  code: string;
  counts: Record<"verified" | "differs" | "withdrawn" | "not_found", number>;
  claims: Claim[];
  notes: string[];
  model: string;
  checkedAt: string;
  log: { topicId: string; sequenceNumber: number; url?: string | null } | null;
  logError?: string | null;
};
export type WorkspaceLot = {
  lot: number;
  code: string;
  step: string;
  product: string;
  reference: string;
  pieces: number | null;
  kg: number;
  madeKg: number;
  received: boolean;
  withdrawn: boolean;
  canWithdraw: boolean;
};
type Party = { name: string; country: string };
export type Incoming = {
  shipment: number;
  from: Party;
  kg: number;
  reference: string;
  product: string;
  sentAt: number;
};
export type Outgoing = {
  shipment: number;
  to: Party;
  kg: number;
  reference: string;
  product: string;
  sentAt: number;
  status: string;
};
export type Workspace = {
  company: (CompanyRef & { source: boolean }) | null;
  isOwner: boolean;
  lots: WorkspaceLot[];
  incoming: Incoming[];
  outgoing: Outgoing[];
};
export type Source = {
  live: boolean;
  network?: string;
  chainId?: number;
  contract?: string;
  contractUrl?: string | null;
  logUrl?: string | null;
  model?: string;
};

/** The contract said no. Its message is the contract's own words, for example "More out than in". */
export class ChainRefusal extends Error {}

// ───────────────────────── the agent ─────────────────────────

type AgentConfig = {
  live: true;
  network: string;
  chainId: number;
  contract: string;
  abi: unknown[];
  owner: string;
  steps: { name: string; label: string }[];
  model: string;
  logTopicId: string | null;
  explorer: string | null;
  links: { contract: string | null; log: string | null };
};

const API = ((import.meta.env["VITE_API_URL"] as string | undefined) ?? "").replace(/\/$/, "");
let agent: Promise<AgentConfig | null> | null = null;

/** The agent's settings, or null when no agent is serving these pages. Asked once. */
function findAgent(): Promise<AgentConfig | null> {
  if (typeof window === "undefined") return Promise.resolve(null); // rendering on a server: no agent there
  if (!agent) {
    agent = fetch(`${API}/api/config`, { signal: AbortSignal.timeout(4000) })
      .then(async (res) => {
        if (!res.ok) return null;
        const config = await res.json();
        return config && config.live === true ? (config as AgentConfig) : null;
      })
      .catch(() => null);
  }
  return agent;
}

class AgentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, init);
  } catch {
    throw new AgentError("The agent is not answering. Is it still running in the terminal?", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new AgentError((data && data.error) || `The agent answered ${res.status}.`, res.status);
  return data as T;
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const wait = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));

// ───────────────────────── reading ─────────────────────────

/** Whether the pages show the real chain or the sample data. */
export async function getSource(): Promise<Source> {
  const a = await findAgent();
  if (!a) return { live: false };
  return {
    live: true,
    network: a.network,
    chainId: a.chainId,
    contract: a.contract,
    contractUrl: a.links.contract,
    logUrl: a.links.log,
    model: a.model,
  };
}

export async function getPassport(code: string): Promise<Passport | null> {
  if (!(await findAgent()))
    return wait(
      code.trim().toUpperCase() === mock.passport.code ? (mock.passport as Passport) : null,
    );
  try {
    return await call<Passport>(`/api/passports/${encodeURIComponent(code.trim())}`);
  } catch (error) {
    // No such passport is an answer, not a failure.
    if (error instanceof AgentError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  }
}

export async function listPassports(): Promise<PassportSummary[]> {
  return (await findAgent()) ? call<PassportSummary[]>("/api/passports") : wait(mock.passports);
}

export async function getCompanies(): Promise<Company[]> {
  return (await findAgent()) ? call<Company[]>("/api/companies") : wait(mock.companies);
}

export async function getSamples(): Promise<Sample[]> {
  return (await findAgent()) ? call<Sample[]>("/api/samples") : wait(mock.samples);
}

export async function checkPaper(text: string): Promise<Report> {
  return (await findAgent())
    ? post<Report>("/api/check", { paper: text })
    : wait(mock.report as Report);
}

// ───────────────────────── the company's wallet ─────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type Wallet = {
  request(args: { method: string; params?: unknown[] }): Promise<any>;
  on?(event: string, handler: () => void): void;
};
const wallet = (): Wallet | undefined =>
  typeof window === "undefined" ? undefined : ((window as any).ethereum as Wallet | undefined);

let watching = false;
/** A company page belongs to one account. When MetaMask changes account or network, start again. */
function watch(eth: Wallet) {
  if (watching || !eth.on) return;
  watching = true;
  eth.on("accountsChanged", () => window.location.reload());
  eth.on("chainChanged", () => window.location.reload());
}

let ethersLibrary: Promise<any> | null = null;
/** The wallet library, served by the agent so the pages need nothing more installed. */
function loadEthers(): Promise<any> {
  if (!ethersLibrary) {
    ethersLibrary = new Promise((resolve, reject) => {
      if ((window as any).ethers) return resolve((window as any).ethers);
      const script = document.createElement("script");
      script.src = `${API}/vendor/ethers.js`;
      script.onload = () => resolve((window as any).ethers);
      script.onerror = () =>
        reject(new Error("The wallet library could not be loaded from the agent."));
      document.head.append(script);
    });
  }
  return ethersLibrary;
}

/** Puts MetaMask on the network the contract lives on. */
async function switchNetwork(eth: Wallet, a: AgentConfig) {
  const wanted = "0x" + a.chainId.toString(16);
  if ((await eth.request({ method: "eth_chainId" })) === wanted) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: wanted }] });
  } catch (error: any) {
    if (error?.code !== 4902 || a.chainId !== 296) throw error;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: wanted,
          chainName: "Hedera Testnet",
          nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
          rpcUrls: ["https://testnet.hashio.io/api"],
          blockExplorerUrls: ["https://hashscan.io/testnet"],
        },
      ],
    });
  }
}

/** Turns a wallet or contract error into one plain sentence. */
function explain(error: any): Error {
  if (error instanceof ChainRefusal || error instanceof AgentError) return error;
  const code = error?.code ?? error?.info?.error?.code;
  if (code === "ACTION_REJECTED" || code === 4001) return new Error("You cancelled in MetaMask.");
  const reason = error?.reason || error?.revert?.args?.[0];
  if (reason) return new ChainRefusal(String(reason));
  return new Error(
    error?.shortMessage || error?.info?.error?.message || error?.message || "Something went wrong.",
  );
}

type Result = Promise<{ message: string }>;

/**
 * Signs one call to the contract with the company's own account.
 * The call is rehearsed first, so a refusal comes back in the contract's own
 * words before anything is signed or paid for.
 */
async function sign(a: AgentConfig, method: string, args: unknown[], done: string): Result {
  const eth = wallet();
  if (!eth) throw new Error("MetaMask was not found in this browser.");
  try {
    const ethers = await loadEthers();
    const [account] = await eth.request({ method: "eth_requestAccounts" });
    await switchNetwork(eth, a);
    const signer = await new ethers.BrowserProvider(eth).getSigner(account);
    const contract = new ethers.Contract(a.contract, a.abi, signer);
    await contract[method].staticCall(...args);
    const receipt = await (await contract[method](...args)).wait();
    // Tell the agent which transaction this was, so the passport can link to it. Not essential.
    post("/api/proofs", { transaction: receipt.hash }).catch(() => undefined);
    return { message: done };
  } catch (error) {
    throw explain(error);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const grams = (kg: number) => BigInt(Math.round((Number(kg) || 0) * 1000));

function stepNumber(a: AgentConfig, name: string): number {
  const index = a.steps.findIndex((step) => step.name === name);
  if (index < 0) throw new Error("Choose the step.");
  return index;
}

/** Hands the wording to the agent and gets back the fingerprint that goes on the chain. */
async function fingerprint(details: Record<string, unknown>): Promise<string> {
  return (await post<{ detailsHash: string }>("/api/details", details)).detailsHash;
}

const ok = (message: string) => wait({ message });
const refuse = (message: string) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(new ChainRefusal(message)), 150));

export async function connectWallet(): Promise<string> {
  if (!(await findAgent()))
    return new Promise((r) => setTimeout(() => r(mock.workspace.company.address), 600));
  const eth = wallet();
  if (!eth)
    throw new Error("MetaMask was not found in this browser. Companies sign their steps with it.");
  try {
    const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
    if (!accounts[0]) throw new Error("No account was chosen in MetaMask.");
    watch(eth);
    return accounts[0];
  } catch (error) {
    throw explain(error);
  }
}

export async function getWorkspace(address: string): Promise<Workspace> {
  if (await findAgent()) return call<Workspace>(`/api/workspace/${address}`);
  return wait(
    address.toLowerCase() === mock.workspace.company.address.toLowerCase()
      ? (mock.workspace as Workspace)
      : { ...mock.workspace, company: null, lots: [], incoming: [], outgoing: [] },
  );
}

export async function recordMaterial(i: {
  step: string;
  product: string;
  reference: string;
  kg: number;
}): Result {
  const a = await findAgent();
  if (!a) return ok("New material recorded.");
  const hash = await fingerprint({
    kind: "step",
    step: i.step,
    product: i.product,
    reference: i.reference,
  });
  return sign(
    a,
    "record",
    [stepNumber(a, i.step), grams(i.kg), hash],
    "New material recorded on Hedera.",
  );
}

export async function makeProduct(i: {
  inputs: { lot: number; kg: number }[];
  step: string;
  product: string;
  reference: string;
  pieces: number;
  kg: number;
}): Result {
  const a = await findAgent();
  if (!a) {
    const used = i.inputs.reduce((s, x) => s + x.kg, 0);
    return i.kg > used ? refuse("More out than in") : ok("Step recorded.");
  }
  const inputs = i.inputs.filter((x) => x.kg > 0);
  if (!inputs.length) throw new Error("Say how many kg you used from each lot.");
  const hash = await fingerprint({
    kind: "step",
    step: i.step,
    product: i.product,
    reference: i.reference,
    pieces: i.pieces > 0 ? i.pieces : null,
  });
  return sign(
    a,
    "transform",
    [
      inputs.map((x) => x.lot),
      inputs.map((x) => grams(x.kg)),
      stepNumber(a, i.step),
      grams(i.kg),
      hash,
    ],
    "Step recorded on Hedera.",
  );
}

export async function shipLot(i: {
  lot: number;
  to: string;
  kg: number;
  reference: string;
}): Result {
  const a = await findAgent();
  if (!a) {
    const lot = mock.workspace.lots.find((l) => l.lot === i.lot);
    return !lot || i.kg > lot.kg ? refuse("More than this lot holds") : ok("Shipment sent.");
  }
  const hash = await fingerprint({ kind: "note", reference: i.reference });
  return sign(
    a,
    "ship",
    [i.lot, i.to, grams(i.kg), hash],
    "Shipment recorded on Hedera. It counts once the receiver confirms it.",
  );
}

export async function confirmShipment(shipment: number): Result {
  const a = await findAgent();
  return a
    ? sign(a, "confirm", [shipment], "Receipt confirmed on Hedera. The lot is yours now.")
    : ok("Receipt confirmed.");
}

export async function refuseShipment(shipment: number): Result {
  const a = await findAgent();
  return a
    ? sign(
        a,
        "refuse",
        [shipment],
        "Delivery refused on Hedera. The weight went back to the sender.",
      )
    : ok("Delivery refused.");
}

export async function withdrawLot(lot: number): Result {
  const a = await findAgent();
  return a
    ? sign(
        a,
        "withdraw",
        [lot],
        "Step withdrawn on Hedera. Every passport that uses it now shows a warning.",
      )
    : ok("Step withdrawn.");
}

export async function approveCompany(i: {
  address: string;
  name: string;
  country: string;
  source: boolean;
}): Result {
  const a = await findAgent();
  if (!a) return ok("Company approved.");
  return sign(
    a,
    "approveCompany",
    [i.address.trim(), i.name.trim(), i.country.trim(), i.source],
    `${i.name.trim()} is approved on Hedera.`,
  );
}
