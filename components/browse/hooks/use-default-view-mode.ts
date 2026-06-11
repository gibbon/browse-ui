"use client";

// User-level default view mode for newly-opened browse pages — "how I like
// pages to open". Now backed by the server-side per-user preferences store
// (useUserPref → kernel /api/user-prefs), so it follows the user across
// browsers and devices instead of living in per-browser localStorage. Defaults
// to "rich". Per-card toggles (ViewModeToggle in page-node) still override.

import { useCallback } from "react";
import type { ViewMode } from "./use-node-ui-state";
import { useUserPref } from "@/lib/user-prefs";

const PREF_KEY = "browse.defaultViewMode";

function isViewMode(v: unknown): v is ViewMode {
  return v === "reader" || v === "rich" || v === "original";
}

export function useDefaultViewMode() {
  const [raw, setRaw] = useUserPref<ViewMode>(PREF_KEY, "rich");
  const mode: ViewMode = isViewMode(raw) ? raw : "rich";
  const setMode = useCallback((m: ViewMode) => setRaw(m), [setRaw]);
  return [mode, setMode] as const;
}
