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
