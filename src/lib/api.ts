// The only data access layer. Replace these bodies with real API calls later.
import * as mock from "@/data/mock";

type CompanyRef = { name: string; country: string; address: string; approved: boolean };
export type Standing = "valid" | "withdrawn" | "company_removed" | string;
export type StepLine = { n: number; type: "step"; lot: number; step: string; company: CompanyRef; at: number; kg: number; product: string; reference: string; pieces: number | null; note: string; standing: Standing; withdrawnAt: number | null };
export type HandoverLine = { n: number; type: "handover"; lot: number; shipment: number; from: CompanyRef; to: CompanyRef; sentAt: number; at: number; kg: number; reference: string; standing: Standing };
export type PassportLine = StepLine | HandoverLine;
export type Passport = Omit<typeof mock.passport, "lines"> & { lines: PassportLine[] };
export type PassportSummary = (typeof mock.passports)[number];
export type Company = (typeof mock.companies)[number];
export type Sample = (typeof mock.samples)[number];
export type Report = typeof mock.report;

const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150));

export async function getPassport(code: string): Promise<Passport | null> {
  return wait(code.trim().toUpperCase() === mock.passport.code ? (mock.passport as Passport) : null);
}
export async function listPassports(): Promise<PassportSummary[]> { return wait(mock.passports); }
export async function getCompanies(): Promise<Company[]> { return wait(mock.companies); }
export async function getSamples(): Promise<Sample[]> { return wait(mock.samples); }
export async function checkPaper(_text: string): Promise<Report> { return wait(mock.report); }

// ---- Company workspace (mock; replace with wallet + chain calls) ----
type Company0 = Omit<typeof mock.workspace.company, never>;
export type Workspace = Omit<typeof mock.workspace, "company"> & { company: Company0 | null };
export type WorkspaceLot = (typeof mock.workspace.lots)[number];
type Result = Promise<{ message: string }>;
const ok = (message: string) => wait({ message });
const refuse = (msg: string) => new Promise<never>((_, rej) => setTimeout(() => rej(new Error(msg)), 150));

export async function connectWallet(): Promise<string> {
  return new Promise((r) => setTimeout(() => r(mock.workspace.company.address), 600));
}
export async function getWorkspace(address: string): Promise<Workspace> {
  return wait(address.toLowerCase() === mock.workspace.company.address.toLowerCase()
    ? (mock.workspace as Workspace) : { ...mock.workspace, company: null, lots: [], incoming: [], outgoing: [] });
}
export async function recordMaterial(_i: { step: string; product: string; reference: string; kg: number }): Result {
  return ok("New material recorded.");
}
export async function makeProduct(i: { inputs: { lot: number; kg: number }[]; step: string; product: string; reference: string; pieces: number; kg: number }): Result {
  const used = i.inputs.reduce((s, x) => s + x.kg, 0);
  if (i.kg > used) return refuse("More out than in");
  return ok("Step recorded.");
}
export async function shipLot(i: { lot: number; to: string; kg: number; reference: string }): Result {
  const lot = mock.workspace.lots.find((l) => l.lot === i.lot);
  if (!lot || i.kg > lot.kg) return refuse("More than this lot holds");
  return ok("Shipment sent.");
}
export async function confirmShipment(_s: number): Result { return ok("Receipt confirmed."); }
export async function refuseShipment(_s: number): Result { return ok("Delivery refused."); }
export async function withdrawLot(_l: number): Result { return ok("Step withdrawn."); }
export async function approveCompany(_i: { address: string; name: string; country: string; source: boolean }): Result {
  return ok("Company approved.");
}
