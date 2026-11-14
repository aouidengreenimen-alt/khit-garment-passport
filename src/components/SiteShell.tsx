import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getSource } from "@/lib/api";
import door from "@/assets/tunisian_green_door.jpg.asset.json";

export function ThreadLogo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" fill="none">
      {/* heart-shaped thread */}
      <path d="M24 40 C10 30 6 22 10 15 C14 9 21 11 24 17 C27 11 34 9 38 15 C42 22 38 30 24 40"
        className="stroke-accent" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 3" />
      {/* needle */}
      <g transform="rotate(40 24 24)">
        <rect x="22.8" y="4" width="2.4" height="38" rx="1.2" className="fill-primary" />
        <path d="M22.8 40 L24 46 L25.2 40 Z" className="fill-primary" />
        <ellipse cx="24" cy="8" rx="0.6" ry="2.2" className="fill-background" />
      </g>
    </svg>
  );
}

/** Says whether the pages show the real chain or the sample data, so one is never taken for the other. */
function DataSource() {
  const source = useQuery({ queryKey: ["source"], queryFn: getSource, staleTime: Infinity });
  if (!source.data) return null;
  if (!source.data.live) return <> Sample data: these pages are not connected to Hedera here.</>;
  const where = source.data.chainId === 296 ? "Hedera testnet" : `a local test chain (${source.data.chainId})`;
  return (
    <>
      {" "}Live from {where}
      {source.data.contractUrl
        ? <>, <a href={source.data.contractUrl} target="_blank" rel="noopener noreferrer" className="underline">see the contract</a></>
        : null}
      . Names ending in (demo) are placeholders.
    </>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  const nav = "px-2.5 sm:px-3 py-1.5 rounded-full text-sm whitespace-nowrap text-muted-foreground hover:text-foreground transition-colors";
  return (
    <div className="min-h-screen flex flex-col door-bg" style={{ ["--door-url" as string]: `url(${door.url})` }}>
      <header className="border-b border-border bg-background/90 backdrop-blur sticky top-0 z-10">
        {/* On a phone the three links do not fit beside the name, so they go on a line of their own. */}
        <div className="mx-auto max-w-5xl px-4 min-h-16 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <Link to="/" className="font-display text-2xl font-semibold text-primary flex items-center gap-2">
            <ThreadLogo /> Thread
          </Link>
          <nav className="flex flex-wrap gap-1 -mx-2.5 sm:mx-0">
            <Link to="/check" className={nav} activeProps={{ className: "bg-secondary text-foreground" }}>Check a paper</Link>
            <Link to="/companies" className={nav} activeProps={{ className: "bg-secondary text-foreground" }}>Companies</Link>
            <Link to="/workspace" className={nav} activeProps={{ className: "bg-secondary text-foreground" }}>For companies</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-10">{children}</main>
      <footer className="border-t border-border bg-background/90 py-6 text-center text-xs text-muted-foreground">
        Thread — clothing passports recorded on Hedera.<DataSource />
      </footer>
    </div>
  );
}

export const fmtDate = (s: number) =>
  new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
