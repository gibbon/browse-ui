"use client";

import { useCallback, useEffect, useState } from "react";

// Browse canvas theme toggle — scoped to the canvas wrapper only,
// independent of the global rdan.theme. Persisted in localStorage as
// rdan.browse.theme = "light" | "dark" | "auto". "auto" means inherit
// the global theme (no inline override). "light" applies Dawn-style
// CSS variables onto the wrapper element via a className the canvas
// reads off the wrapper div.
//
// Why scope locally instead of switching the global theme? The user
// wants to read articles in light mode without flipping every other
// dashboard surface (job queue, audit log, settings dialogs) to light.

export type BrowseTheme = "auto" | "light" | "dark";

const STORAGE_KEY = "rdan.browse.theme";

function readStored(): BrowseTheme {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {
    // ignore
  }
  return "auto";
}

export function useBrowseTheme(): {
  theme: BrowseTheme;
  setTheme: (t: BrowseTheme) => void;
  /** Cycle auto → light → dark → auto. Bound to the toolbar button. */
  toggle: () => void;
  /** Tailwind-friendly className to apply to the canvas wrapper.
   *  Empty for "auto" so the global theme cascades through. */
  className: string;
} {
  const [theme, setThemeState] = useState<BrowseTheme>("auto");

  useEffect(() => {
    setThemeState(readStored());
  }, []);

  const setTheme = useCallback((t: BrowseTheme) => {
    setThemeState(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next: BrowseTheme = prev === "auto" ? "light" : prev === "light" ? "dark" : "auto";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const className =
    theme === "light" ? "browse-theme-light"
    : theme === "dark" ? "browse-theme-dark"
    : "";

  return { theme, setTheme, toggle, className };
}
