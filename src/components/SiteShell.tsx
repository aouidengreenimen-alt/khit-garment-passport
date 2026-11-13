import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function SiteShell({ children }: { children: ReactNode }) {
  const nav = "px-3 py-1.5 rounded-full text-sm text-muted-foreground hover:text-foreground transition-colors";
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-background/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 h-16 flex items-center justify-between gap-4">
          <Link to="/" className="font-display text-2xl font-semibold text-primary flex items-center gap-2">
            <span className="stitch-dot" /> Khit
          </Link>
          <nav className="flex gap-1">
            <Link to="/check" className={nav} activeProps={{ className: "bg-secondary text-foreground" }}>Check a paper</Link>
            <Link to="/companies" className={nav} activeProps={{ className: "bg-secondary text-foreground" }}>Companies</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-10">{children}</main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Khit — clothing passports recorded on Hedera. Demo data.
      </footer>
    </div>
  );
}

export const fmtDate = (s: number) =>
  new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
