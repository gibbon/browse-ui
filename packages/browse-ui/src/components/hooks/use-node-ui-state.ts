"use client";

// Per-node UI state (viewMode / userAgent / fetchMode) for the browse
// canvas. Persisted to localStorage keyed by sessionId so toggles
// survive a reload — without this, every refresh resets every node
// to Reader / default UA / Static, which is annoying for users who
// deliberately put a node in Headless mode.

import { useCallback, useEffect, useState } from "react";

export type ViewMode = "reader" | "rich" | "original";
export type FetchMode = "static" | "headless";

export interface NodeUiState {
  viewMode: ViewMode;
  userAgent: string;
  fetchMode: FetchMode;
}

type NodeUiMap = Map<string, NodeUiState>;

function load(sessionId: string): NodeUiMap {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(`browse:node-ui:${sessionId}`);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const m: NodeUiMap = new Map();
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v !== "object") continue;
      const e = v as { viewMode?: string; userAgent?: string; fetchMode?: string };
      const vm: ViewMode =
        e.viewMode === "original" ? "original"
        : e.viewMode === "rich" ? "rich"
        : "reader";
      m.set(k, {
        viewMode: vm,
        userAgent: typeof e.userAgent === "string" ? e.userAgent : "default",
        fetchMode: e.fetchMode === "headless" ? "headless" : "static",
      });
    }
    return m;
  } catch {
    return new Map();
  }
}

export function useNodeUiState(
  sessionId: string,
  defaultFetchMode: FetchMode,
  defaultViewMode: ViewMode = "reader",
) {
  const [state, setState] = useState<NodeUiMap>(() => load(sessionId));

  // Persist to localStorage on every change. Cheap because the map
  // is small (one entry per page node) and the user toggles
  // infrequently.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of state) obj[k] = v;
      window.localStorage.setItem(`browse:node-ui:${sessionId}`, JSON.stringify(obj));
    } catch {
      // localStorage full / disabled — silently skip
    }
  }, [state, sessionId]);

  const defaultFor = useCallback(
    (): NodeUiState => ({
      viewMode: defaultViewMode,
      userAgent: "default",
      fetchMode: defaultFetchMode,
    }),
    [defaultFetchMode, defaultViewMode],
  );

  const setViewMode = useCallback(
    (nodeId: string, mode: ViewMode) => {
      setState((prev) => {
        const next = new Map(prev);
        const cur = next.get(nodeId) ?? defaultFor();
        next.set(nodeId, { ...cur, viewMode: mode });
        return next;
      });
    },
    [defaultFor],
  );

  return { state, setState, defaultFor, setViewMode };
}
