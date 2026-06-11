"use client";

// Client form for creating a new browse session. POSTs through the
// dashboard's /api/browse/sessions pass-through (which fronts the kernel
// route and runs the snake→camel transform), then routes the user to the
// freshly created session's canvas at /browse/<id>.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import type { BrowseSession } from "@/lib/browse-types";
import { normalizeUrl } from "@/lib/media-classify";

interface NewSessionFormProps {
  onCreated?: (session: BrowseSession) => void;
}

// One-click starter sites. Clicking the button creates a session named
// after the site, seeded at the URL — no typing required. Same shape as
// `handleSubmit` would build, just with the inputs pre-filled.
const STARTERS: Array<{ label: string; name: string; url: string }> = [
  { label: "HN Search", name: "hn algolia search", url: "https://hn.algolia.com/?q=react" },
  { label: "Open Library", name: "open library search", url: "https://openlibrary.org/search?q=react" },
  { label: "npm Search", name: "npm package search", url: "https://www.npmjs.com/search?q=react" },
  { label: "Hacker News", name: "hacker news", url: "https://news.ycombinator.com" },
];

export function NewSessionForm({ onCreated }: NewSessionFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [seedUrl, setSeedUrl] = useState("");
  const [useHeadless, setUseHeadless] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createSession(rawName: string, rawSeed: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/browse/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: rawName.trim(),
          seedUrl: rawSeed.trim() ? normalizeUrl(rawSeed) : undefined,
          useHeadless,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { session: BrowseSession };
      onCreated?.(data.session);
      router.push(`/browse/${data.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await createSession(name, seedUrl);
  }

  return (
    <Card className="p-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="browse-session-name" className="text-xs uppercase tracking-wider text-muted-foreground">
            Name
          </label>
          <Input
            id="browse-session-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. wikipedia: octopus cognition"
            required
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="browse-session-seed" className="text-xs uppercase tracking-wider text-muted-foreground">
            Seed URL <span className="text-muted-foreground/60">(optional)</span>
          </label>
          {/* type="text" not "url" — the HTML5 url validator would
              reject "google.com" before normalizeUrl gets to add the
              https:// prefix. Same reasoning as the per-session url-bar. */}
          <Input
            id="browse-session-seed"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={seedUrl}
            onChange={(e) => setSeedUrl(e.target.value)}
            placeholder="example.com or https://example.com/start"
            disabled={busy}
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex border border-card-border rounded overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setUseHeadless(false)}
              disabled={busy}
              className={`px-2 py-1 ${!useHeadless ? "bg-card-border/60 font-semibold" : "text-muted-foreground hover:bg-card-border/30"}`}
              title="Fast plain HTTP fetch; does not capture browser-side endpoints"
            >
              Static
            </button>
            <button
              type="button"
              onClick={() => setUseHeadless(true)}
              disabled={busy}
              className={`px-2 py-1 ${useHeadless ? "bg-card-border/60 font-semibold" : "text-muted-foreground hover:bg-card-border/30"}`}
              title="Run page JavaScript in Chromium and capture endpoint metadata"
            >
              Headless
            </button>
          </div>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "New session"}
          </Button>
          {error && <span className="text-destructive text-sm">{error}</span>}
        </div>
      </form>
      <div className="mt-3 pt-3 border-t border-card-border flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Quick start
        </span>
        {STARTERS.map((s) => (
          <Button
            key={s.label}
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => createSession(s.name, s.url)}
          >
            {s.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}
