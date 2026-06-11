"use client";

// /browse — index page listing the user's browse-canvas sessions and
// offering a new-session form. Fetches through the same-origin proxy at
// /api/browse/sessions — no auth checks needed in standalone mode.

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NewSessionForm } from "@/components/browse/new-session-form";
import { formatDateTime } from "@/lib/format-date";
import type { BrowseSession } from "@/lib/browse-types";

export default function BrowseIndexPage() {
  const [sessions, setSessions] = useState<BrowseSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/browse/sessions");
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { sessions: BrowseSession[] };
      setSessions(data.sessions ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return (
    <div className="space-y-6 overflow-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-accent">Browse</h2>
      </div>

      <NewSessionForm onCreated={() => fetchSessions()} />

      {error && (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="text-destructive text-sm">{error}</div>
        </Card>
      )}

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading sessions…</div>
      ) : sessions.length === 0 ? (
        <div className="text-muted-foreground text-sm">No sessions yet.</div>
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-muted-foreground text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-4 py-2">Seed URL</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-card-border/50 hover:bg-card-border/20 transition-colors"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/browse/${s.id}`}
                      className="text-foreground hover:text-accent hover:underline"
                    >
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs font-mono break-all">
                    {s.seedUrl ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={s.status === "active" ? "secondary" : "outline"}>
                      {s.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs tabular-nums">
                    {s.createdAt ? formatDateTime(s.createdAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
