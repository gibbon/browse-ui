"use client";

// URL bar that submits a new root page node into the active browse
// session. The actual POST is handled by the parent Canvas (so it can
// optimistically insert the returned node into xyflow state); this
// component owns input value, busy spinner, and inline error display.

import { useState } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { normalizeUrl } from "../lib/media-classify";

interface Props {
  onSubmit: (url: string) => Promise<void>;
  /** Total bytes of cached page content across all active nodes. */
  cacheBytes?: number;
  /** Active node count alongside the cache size — gives the byte total
   *  context (e.g. "12 nodes · 480 KB"). */
  nodeCount?: number;
  /** Session-default fetchMode applied to root spawns. Per-node toggles
   *  still override; this just sets the seed for new nodes. */
  defaultFetchMode?: "static" | "headless";
  onSetDefaultFetchMode?: (m: "static" | "headless") => void;
  /** When true, every newly-extracted page node spawns a summary tile
   *  automatically in the meta column. Toggled session-wide. */
  autoSummarize?: boolean;
  onSetAutoSummarize?: (on: boolean) => void;
  /** User-level default view mode for newly-opened pages (across all
   *  sessions). Per-card toggles still override. */
  defaultViewMode?: "reader" | "rich" | "original";
  onSetDefaultViewMode?: (m: "reader" | "rich" | "original") => void;
  /** Clears per-node drag overrides (BrowseViewport.nodePositions) so
   *  the columnar layout reclaims every node. Hidden when not provided. */
  onResetLayout?: () => void;
  /** Pan the viewport to the parent of the currently-focused node. */
  onTreeBack?: () => void;
  /** Pan the viewport to the most-recent descendant of the currently-focused node. */
  onTreeForward?: () => void;
  /** Disables the back button when no parent exists. */
  canTreeBack?: boolean;
  /** Disables the forward button when no descendant exists. */
  canTreeForward?: boolean;
  /** Browse-window-only theme. "auto" inherits the global dashboard
   *  theme; "light" / "dark" force a Dawn / Terminal palette on the
   *  canvas wrapper only. */
  browseTheme?: "auto" | "light" | "dark";
  onToggleBrowseTheme?: () => void;
  /** Whether the perf-debug overlay is showing. Toggle button next to
   *  the theme button. */
  perfOverlayOn?: boolean;
  onTogglePerfOverlay?: () => void;
  /** Opens the chat panel with canvas-level context for global asks
   *  ("make youtube tiles wider", "add transcript section", etc).
   *  Chat routes through r.dan → pi-coder for code changes. */
  onCustomise?: () => void;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

export function UrlBar({
  onSubmit,
  cacheBytes,
  nodeCount,
  defaultFetchMode = "static",
  onSetDefaultFetchMode,
  autoSummarize = false,
  onSetAutoSummarize,
  defaultViewMode = "rich",
  onSetDefaultViewMode,
  onResetLayout,
  onTreeBack,
  onTreeForward,
  canTreeBack,
  canTreeForward,
  browseTheme = "auto",
  onToggleBrowseTheme,
  perfOverlayOn,
  onTogglePerfOverlay,
  onCustomise,
}: Props) {
  const themeIcon = browseTheme === "light" ? "☀" : browseTheme === "dark" ? "☾" : "◑";
  const themeTitle =
    browseTheme === "auto"
      ? "Browse theme: follows the dashboard (click for light)"
      : browseTheme === "light"
      ? "Browse theme: light (click for dark)"
      : "Browse theme: dark (click to follow the dashboard)";
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.trim()) return;
        setBusy(true);
        setError(null);
        try {
          await onSubmit(normalizeUrl(v));
          setV("");
        } catch (err: unknown) {
          const msg =
            err instanceof Error ? err.message : String(err ?? "submit failed");
          setError(msg);
        } finally {
          setBusy(false);
        }
      }}
      className="flex items-center gap-2 p-2 border-b border-card-border bg-card"
    >
      {onTreeBack && (
        <Button
          type="button"
          variant="ghost"
          size="iconXs"
          disabled={canTreeBack === false}
          onClick={onTreeBack}
          title="Pan to the parent of the focused page"
        >
          ←
        </Button>
      )}
      {onTreeForward && (
        <Button
          type="button"
          variant="ghost"
          size="iconXs"
          disabled={canTreeForward === false}
          onClick={onTreeForward}
          title="Pan to the most-recent descendant of the focused page"
        >
          →
        </Button>
      )}
      <Input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="Enter URL"
        disabled={busy}
        className="flex-1 max-w-2xl"
      />
      <Button type="submit" disabled={busy || !v.trim()} size="sm">
        {busy ? "…" : "Go"}
      </Button>
      {onSetDefaultFetchMode && (
        <label
          className="text-xs text-muted-foreground inline-flex items-center gap-1 cursor-pointer select-none"
          title="When checked, new pages spawned in this session render via headless Chromium by default. Per-node toggles still override."
        >
          <input
            type="checkbox"
            checked={defaultFetchMode === "headless"}
            onChange={(e) =>
              onSetDefaultFetchMode(e.target.checked ? "headless" : "static")
            }
          />
          Headless
        </label>
      )}
      {onSetAutoSummarize && (
        <label
          className="text-xs text-muted-foreground inline-flex items-center gap-1 cursor-pointer select-none"
          title="When checked, every newly-extracted page node spawns an AI summary tile in the meta column automatically."
        >
          <input
            type="checkbox"
            checked={autoSummarize}
            onChange={(e) => onSetAutoSummarize(e.target.checked)}
          />
          Auto-summarize
        </label>
      )}
      {onSetDefaultViewMode && (
        <label
          className="text-xs text-muted-foreground inline-flex items-center gap-1 cursor-pointer select-none"
          title="How new pages open by default (your preference, across all sessions). Per-card toggles still override."
        >
          View:
          <select
            value={defaultViewMode}
            onChange={(e) =>
              onSetDefaultViewMode(
                e.target.value as "reader" | "rich" | "original",
              )
            }
            className="bg-card border border-card-border rounded px-1 py-0.5 text-xs cursor-pointer"
          >
            <option value="reader">Reader</option>
            <option value="rich">Rich</option>
            <option value="original">Original</option>
          </select>
        </label>
      )}
      {error && (
        <span className="text-destructive text-sm truncate" title={error}>
          {error}
        </span>
      )}
      {typeof cacheBytes === "number" && (
        <span
          className="ml-auto text-xs text-muted-foreground tabular-nums"
          title="Total bytes of cached content (markdown + links + media metadata) across active nodes"
        >
          {nodeCount ?? "?"} node{nodeCount === 1 ? "" : "s"} · {formatBytes(cacheBytes)}
        </span>
      )}
      {onResetLayout && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onResetLayout}
          title="Clear per-node drag overrides — every node snaps back to its computed columnar position"
        >
          Reset layout
        </Button>
      )}
      {onCustomise && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onCustomise}
          title="Customise the canvas — opens chat with pi-coder for layout, palette, host-specific renderers"
        >
          ✦ Customise
        </Button>
      )}
      {onTogglePerfOverlay && (
        <Button
          type="button"
          variant="ghost"
          size="iconXs"
          onClick={onTogglePerfOverlay}
          title={perfOverlayOn ? "Hide perf overlay" : "Show JS heap / FPS / node count overlay"}
          aria-pressed={perfOverlayOn}
        >
          {perfOverlayOn ? "■" : "▤"}
        </Button>
      )}
      {onToggleBrowseTheme && (
        <Button
          type="button"
          variant="ghost"
          size="iconXs"
          onClick={onToggleBrowseTheme}
          title={themeTitle}
        >
          {themeIcon}
        </Button>
      )}
    </form>
  );
}
