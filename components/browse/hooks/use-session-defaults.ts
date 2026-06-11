"use client";

// Session-default fetchMode (static vs. headless) for the browse
// canvas. Persisted to localStorage keyed by sessionId so the choice
// survives a reload. Per-node toggles override this default; this is
// just the seed for newly-spawned roots.

import { useEffect, useState } from "react";

export interface SessionDefaults {
  fetchMode: "static" | "headless";
  /** When true, every newly-extracted page node spawns a summary tile
   *  automatically in the meta column. User controls this via a single
   *  toggle in the URL bar — supersedes the older per-domain
   *  __summary__ pin checkbox which proved hard to discover. */
  autoSummarize: boolean;
}

// Auto-summarize defaults to ON — the summary tile is the most useful
// piece of meta most of the time, and the user almost always wants it.
// Per-session opt-out via the URL-bar checkbox flips it false.
const DEFAULT: SessionDefaults = { fetchMode: "static", autoSummarize: true };

function load(sessionId: string, initialFetchMode?: SessionDefaults["fetchMode"]): SessionDefaults {
  const fallback: SessionDefaults = {
    ...DEFAULT,
    fetchMode: initialFetchMode ?? DEFAULT.fetchMode,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(`browse:session-defaults:${sessionId}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      fetchMode: parsed?.fetchMode === "headless" ? "headless" : "static",
      // Respect an explicit false; default true when key absent so
      // existing sessions opt in on next load.
      autoSummarize: parsed?.autoSummarize !== false,
    };
  } catch {
    return DEFAULT;
  }
}

export function useSessionDefaults(
  sessionId: string,
  initialFetchMode?: SessionDefaults["fetchMode"],
) {
  const [defaults, setDefaults] = useState<SessionDefaults>(() => load(sessionId, initialFetchMode));

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        `browse:session-defaults:${sessionId}`,
        JSON.stringify(defaults),
      );
    } catch {
      // localStorage full / disabled — silently skip
    }
  }, [defaults, sessionId]);

  return [defaults, setDefaults] as const;
}
