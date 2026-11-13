import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
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

export function SiteShell({ children }: { children: ReactNode }) {
  const nav = "px-3 py-1.5 rounded-full text-sm text-muted-foreground hover:text-foreground transition-colors";
  return (
    <div className="min-h-screen flex flex-col door-bg" style={{ ["--door-url" as string]: `url(${door.url})` }}>
      <header className="border-b border-border bg-background/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="font-display text-2xl font-semibold text-primary flex items-center gap-2">
            <ThreadLogo /> Thread
          </Link>
          <nav className="flex gap-1">
            <Link to="/check" className={nav} activeProps={{ className: "bg-secondary text-foreground" }}>Check a paper</Link>
            <Link to="/companies" className={nav} activeProps={{ className: "bg-secondary text-foreground" }}>Companies</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-10">{children}</main>
      <footer className="border-t border-border bg-background/90 py-6 text-center text-xs text-muted-foreground">
        Thread — clothing passports recorded on Hedera. Demo data.
      </footer>
    </div>
  );
}

export const fmtDate = (s: number) =>
  new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
