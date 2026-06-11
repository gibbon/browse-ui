"use client";

// Left rail for the browse-canvas page: lists every session belonging to
// the caller and highlights the current one. Mirrors the `bg-card`,
// `border-card-border`, and `hover:bg-card-border/30` tokens used by
// the topbar / sidebar / chat session-list elsewhere in the dashboard.
//
// 2026-05-24 (T12): adds filter chip (active/archived/all), node-count
// badge, and overflow menu with Archive/Restore actions.

import Link from "next/link";
import { useState } from "react";
import type { BrowseSession } from "@/lib/browse-types";

type Filter = "active" | "archived" | "all";

interface SessionSidebarProps {
  sessions: BrowseSession[];
  currentId: string;
}

export function SessionSidebar({ sessions: initial, currentId }: SessionSidebarProps) {
  const [sessions, setSessions] = useState(initial);
  const [filter, setFilter] = useState<Filter>("active");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const filtered = sessions.filter((s) => {
    if (filter === "all") return s.status !== "deleted";
    if (filter === "active") return s.status === "active";
    return s.status === "archived";
  });

  async function setStatus(id: string, status: "active" | "archived") {
    setPendingId(id);
    try {
      const res = await fetch(`/api/browse/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`PATCH returned ${res.status}`);
      const body = (await res.json()) as { session: BrowseSession };
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...body.session } : s)));
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(`Failed to update session: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPendingId(null);
    }
  }

  return (
    <aside className="w-64 shrink-0 border-r border-card-border overflow-y-auto bg-card flex flex-col">
      <Link
        href="/browse"
        className="block p-3 border-b border-card-border font-semibold text-sm hover:bg-card-border/30"
      >
        + New session
      </Link>
      <div className="px-3 py-2 border-b border-card-border flex gap-1 text-xs">
        {(["active", "archived", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-2 py-0.5 rounded ${
              filter === f
                ? "bg-card-border/60 text-foreground"
                : "text-muted-foreground hover:bg-card-border/30"
            }`}
          >
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <ul className="flex-1">
        {filtered.map((s) => (
          <li
            key={s.id}
            className={`group relative border-b border-card-border/40 ${
              s.id === currentId ? "bg-card-border/50" : ""
            }`}
          >
            <Link
              href={`/browse/${s.id}`}
              className={`block px-3 py-2 text-sm truncate hover:bg-card-border/30 pr-12 ${
                s.id === currentId ? "font-medium text-accent" : "text-foreground"
              }`}
              title={s.name}
            >
              <span className="truncate">{s.name}</span>
              {typeof s.nodeCount === "number" && s.nodeCount > 0 && (
                <span className="ml-2 text-[10px] tabular-nums text-muted-foreground">
                  {s.nodeCount}
                </span>
              )}
              {s.status === "archived" && (
                <span className="ml-2 text-[10px] uppercase text-amber-500/80">archived</span>
              )}
            </Link>
            <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex gap-1">
              {s.status === "active" ? (
                <button
                  type="button"
                  disabled={pendingId === s.id}
                  onClick={(e) => {
                    e.preventDefault();
                    void setStatus(s.id, "archived");
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-card-border/60 hover:bg-card-border"
                  title="Archive this session (still readable; hidden from Active list)"
                >
                  Archive
                </button>
              ) : s.status === "archived" ? (
                <button
                  type="button"
                  disabled={pendingId === s.id}
                  onClick={(e) => {
                    e.preventDefault();
                    void setStatus(s.id, "active");
                  }}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-card-border/60 hover:bg-card-border"
                  title="Restore this archived session to the Active list"
                >
                  Restore
                </button>
              ) : null}
            </div>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-3 py-2 text-xs text-muted-foreground">
            {filter === "archived"
              ? "No archived sessions."
              : filter === "active"
                ? "No active sessions."
                : "No sessions yet."}
          </li>
        )}
      </ul>
    </aside>
  );
}
