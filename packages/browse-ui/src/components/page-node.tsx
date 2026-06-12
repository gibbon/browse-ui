"use client";

// Custom xyflow node that renders a single browsed page: header (URL +
// title + byline + seen-before badge), body (markdown via
// react-markdown, with anchor clicks intercepted so Task 17 can spawn a
// new child node), and a collapsible Links/Media panel. Click handlers
// (onClickLink / onClickMedia / onRetry) are supplied by the Canvas via
// node `data`; this file is purely presentational so unit tests can
// drive every state branch with plain props.

import { memo, useRef, useState } from "react";
import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import type { BrowseLink, BrowseMedia } from "../lib/browse-types";
import { classifyContentUrl, classifyDirectMedia } from "../lib/media-classify";
import { SectionChips } from "./section-chips";
import { ChatTriggerButton } from "./chat-trigger-button";
import { writeDragExtractData } from "./drag-extract";
import { LinksPanel } from "./links-panel";

// Default reading-width for a fresh page node. The user can resize via
// NodeResizer; this is just the seed size and what's used as the
// canvas's grid stride for layout positioning.
const DEFAULT_PAGE_WIDTH = 640;
const DEFAULT_PAGE_HEIGHT = 1400;

// xyflow's NodeProps<T> expects T to extend Node, and Node<DataType>
// requires DataType to satisfy `Record<string, unknown>` (so the runtime
// can shallow-merge update partials). The trailing index signature lets
// our concrete fields coexist with that constraint.
export interface PageNodeData {
  title: string | null;
  byline: string | null;
  url: string;
  contentMarkdown: string | null;
  links: BrowseLink[];
  media: BrowseMedia[];
  extractionStatus: "ok" | "failed" | "pending";
  extractionError: string | null;
  seenBefore: boolean;
  seenBeforeBranch: number | null;
  onClickLink: (href: string, text: string) => void;
  onClickMedia: (m: BrowseMedia) => void;
  onRetry: () => void;
  onClose: () => void;
  /** True when the page content has been evicted from the filesystem
   *  cache. The body area shows "Content expired" with a Reload button
   *  instead of rendering markdown / proxy iframe. */
  contentEvicted?: boolean;
  /** Re-fetch this URL in place using the current fetch/user-agent settings. */
  onReload: () => void;
  /** Navigate the canvas viewport to the parent page node, if any. */
  onBack: () => void;
  /** Navigate to the most-recently spawned descendant page node. */
  onForward: () => void;
  /** True when this node has a parent page node — controls Back enable. */
  hasBack: boolean;
  /** True when this node has any descendant page node — controls Forward. */
  hasForward: boolean;
  /** "reader" = readability-extracted markdown (default — our origin,
   *               no JS surface, lossy on tables/code/math).
   *  "rich"    = readability HTML inside the kernel-proxy iframe — full
   *               HTML fidelity, sandboxed iframe origin so no DOMPurify
   *               needed. Tables, code, math render correctly.
   *  "original" = full upstream page in the same proxy iframe with
   *               click-capture injected — for forms, SPAs, when
   *               readability gets it wrong. */
  viewMode: "reader" | "rich" | "original";
  onSetViewMode: (mode: "reader" | "rich" | "original") => void;
  /** "static" (rdanFetch) or "headless" (Playwright). Static is fast +
   *  cheap; headless renders post-JS DOM, persists cookies per session,
   *  and works on SPA / JS-heavy sites. Per-node toggle. */
  fetchMode: "static" | "headless";
  onSetFetchMode: (mode: "static" | "headless") => void;
  /** UA preset key (see UA_PRESETS in proxy-routes.ts). Drives both the
   *  iframe-proxy fetch and any reload-via-readability that gets fired
   *  for this node. */
  userAgent: string;
  onSetUserAgent: (ua: string) => void;
  /** Session id needed to construct the proxy URL (`?sessionId=...`). */
  sessionId: string;
  /** DOM landmarks detected on this page at extract time. Toolbar shows
   *  one clickable chip per landmark; click pops out a section node. */
  sections?: import("../lib/browse-types").DetectedSection[];
  /** Browse-node id; needed by the section-chips POST endpoint. */
  nodeId?: string;
  /** Full BrowseNode reference for the chat-trigger button so it can
   *  build the prefill body from summary/content_markdown. */
  rdanNode?: import("../lib/browse-types").BrowseNode;
  /** Open the chat side panel with a quoted reference block. */
  onOpenChat?: (prefill: string) => void;
  [key: string]: unknown;
}

export type PageFlowNode = Node<PageNodeData, "page">;

// Memoized with custom equality: xyflow passes position-adjacent
// props (selected, dragging, positionAbsoluteX/Y, zIndex) that change
// on every drag frame. Default memo compares all of them shallowly
// → bails out. Custom equality compares only `data` (which canvas.tsx
// makes reference-stable via dataByNodeId.fullPageData) + `selected`
// + `id`. Result: PageNode skips re-render during drag entirely.
export const PageNode = memo(PageNodeImpl, (prev, next) =>
  prev.id === next.id && prev.data === next.data && prev.selected === next.selected,
);
function PageNodeImpl({ id, data }: NodeProps<PageFlowNode>) {
  // Layout: flex column with three regions inside a resizable shell.
  //   - NodeResizer overlay: lets the user drag corners/edges. xyflow
  //     manages width/height in node.style; we just expose the handles.
  //   - header (shrink-0): URL + title + close, always visible at top.
  //   - middle (flex-1, overflow-y-auto, nowheel, nodrag): markdown
  //     body. `nowheel` keeps scroll-wheel events from being eaten by
  //     ReactFlow's pan/zoom handler so the body actually scrolls.
  //     `nodrag` lets native text selection work inside the body
  //     (xyflow otherwise grabs the mousedown for node dragging and
  //     selection silently fails).
  //   - footer (shrink-0): LinksPanel, always pinned at bottom.
  //
  // rootRef gives the → Chat button a scope for selection capture so
  // it only picks up text highlighted inside THIS node (vs. a stray
  // selection elsewhere on the canvas).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const absolutize = (value: string | undefined) => {
    if (!value) return undefined;
    try {
      return new URL(value, data.url).toString();
    } catch {
      return value;
    }
  };
  return (
    <div
      ref={rootRef}
      className={`bg-card border rounded shadow flex flex-col text-sm w-full h-full overflow-hidden ${
        data.extractionStatus === "failed"
          ? "border-destructive"
          : "border-card-border"
      }`}
      style={{ minWidth: 360, minHeight: 220 }}
    >
      <NodeResizer
        minWidth={360}
        minHeight={220}
        lineClassName="!border-primary/50"
        handleClassName="!bg-primary !border-card !w-2 !h-2"
      />
      <Handle type="target" position={Position.Left} />
      <div className="p-3 border-b border-card-border shrink-0 relative">
        <div className="absolute top-1 right-1 flex items-center gap-0.5">
          <NodeIconButton
            onClick={data.onBack}
            disabled={!data.hasBack}
            ariaLabel="back"
            title="Back to parent page"
          >
            ‹
          </NodeIconButton>
          <NodeIconButton
            onClick={data.onForward}
            disabled={!data.hasForward}
            ariaLabel="forward"
            title="Forward to most recently opened child"
          >
            ›
          </NodeIconButton>
          <NodeIconButton
            onClick={data.onReload}
            ariaLabel="reload"
            title="Refresh this pane"
          >
            ↻
          </NodeIconButton>
          <NodeIconButton
            onClick={() => {
              if (typeof window !== "undefined") {
                window.open(data.url, "_blank", "noopener,noreferrer");
              }
            }}
            ariaLabel="open in browser"
            title="Open this page in a new browser tab (uses your real browser's cookies — separate from the headless context's session)"
          >
            ↗
          </NodeIconButton>
          <NodeIconButton
            onClick={data.onClose}
            ariaLabel="close"
            title="Close (children close too — Undo bar appears)"
          >
            ×
          </NodeIconButton>
        </div>
        <div
          className="text-xs text-muted-foreground truncate pr-24"
          title={data.url}
        >
          {data.url}
        </div>
        <div className="text-base font-semibold leading-tight mt-1 pr-24">
          {data.title ?? data.url}
        </div>
        {data.byline && (
          <div className="text-xs italic text-muted-foreground">
            {data.byline}
          </div>
        )}
        {data.seenBefore && (
          <Badge variant="secondary" className="mt-1 text-[10px]">
            also at branch {data.seenBeforeBranch}
          </Badge>
        )}
      </div>
      {data.nodeId && (
        <div className="flex items-center gap-2 px-2 py-1 flex-wrap">
          <SummaryChip nodeId={data.nodeId} url={data.url} />
          {data.rdanNode && data.onOpenChat && (
            <ChatTriggerButton
              node={data.rdanNode}
              rootRef={rootRef}
              onOpenChat={data.onOpenChat}
            />
          )}
          {data.sections && data.sections.length > 0 && (
            <SectionChips
              sections={data.sections}
              sessionId={data.sessionId}
              nodeId={data.nodeId}
            />
          )}
        </div>
      )}
      <div className="px-3 pt-1 shrink-0 flex items-center gap-2 text-[11px] flex-wrap">
        <ViewModeToggle value={data.viewMode} onChange={data.onSetViewMode} />
        <FetchModeToggle value={data.fetchMode} onChange={data.onSetFetchMode} />
        <UserAgentSelect value={data.userAgent} onChange={data.onSetUserAgent} />
        {/* Reader-mode stale hint — content_markdown was extracted at
            page-fetch time using whichever mode was active then; if the
            user toggles fetch mode AFTER, the displayed text won't
            reflect it until the in-place refresh completes. We show this hint only when
            the toggle has likely diverged from the rendered content. */}
        {data.viewMode === "reader" && data.fetchMode === "headless" && data.contentMarkdown && (
          <span className="text-[10px] text-muted-foreground italic" title="The shown content may have been extracted via the static path. Click ↻ to re-extract this pane using Headless.">
            ↻ applies Headless
          </span>
        )}
      </div>
      {(() => {
        // Known media-host URL? Render the embed iframe in place of
        // Readability-extracted content. Without this, clicking a
        // YouTube/Vimeo/etc. link spawns a page node whose Readability
        // extraction fails (no <article>) and the user sees only the
        // error message instead of the actual video.
        const direct = classifyDirectMedia(data.url);
        const embedHost = !direct && classifyContentUrl(data.url);
        if (embedHost && embedHost.kind === "iframe") {
          return (
            <div className="nowheel nodrag flex-1 min-h-0 overflow-hidden relative bg-black">
              <iframe
                src={embedHost.embedUrl}
                title={data.title ?? data.url}
                className="absolute inset-0 w-full h-full border-0"
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                loading="lazy"
              />
            </div>
          );
        }
        return null;
      })()}
      {(() => {
        // Skip the rest of the body for embed-host pages — the iframe
        // above replaces it. Direct-file URLs fall through to the
        // OriginalIframe / markdown render so PDFs etc. still work
        // via the existing proxy path.
        const direct = classifyDirectMedia(data.url);
        const embedHost = !direct && classifyContentUrl(data.url);
        if (embedHost && embedHost.kind === "iframe") return null;
        // Content evicted from the cache: show a compact state with a
        // Reload button. Reload spawns a fresh child node that re-fetches
        // the URL; the evicted node remains for context but its body is
        // no longer available. Shown over whatever viewMode was active
        // so an evicted page doesn't auto-open the proxy iframe.
        if (data.contentEvicted) {
          return (
            <div className="nowheel nodrag flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-4 text-sm text-muted-foreground">
              <span className="italic">Content expired</span>
              <Button variant="outline" size="sm" onClick={data.onReload}>
                Reload
              </Button>
            </div>
          );
        }
        return data.viewMode === "original" || data.viewMode === "rich" ? (
        <OriginalIframe
          url={data.url}
          ua={data.userAgent}
          sessionId={data.sessionId}
          nodeId={id}
          fetchMode={data.fetchMode}
          title={data.title ?? data.url}
          readified={data.viewMode === "rich"}
        />
      ) : (
        <div
          className="nowheel nodrag select-text cursor-text p-3 prose prose-sm dark:prose-invert max-w-none flex-1 overflow-y-auto min-h-0"
          // Drag-extract source capture now lives at the canvas level
          // (resolves the node id from the DOM data-id), so it works from
          // any node body without per-component wiring. This `select-text`
          // host-DOM body is draggable; proxy-iframe views remain a
          // documented follow-up (drags don't cross the frame boundary).
        >
          {data.extractionStatus === "pending" && (
            <div className="text-muted-foreground italic">loading…</div>
          )}
          {data.extractionStatus === "failed" && (
            <div className="text-destructive">
              <div>
                Extraction failed
                {data.extractionError ? `: ${data.extractionError}` : ""}.
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" size="xs" onClick={data.onRetry}>
                  Retry
                </Button>
                {/* Most static-extraction failures are JS-rendered SPAs.
                    Suggesting Headless is high-yield: it'll often
                    resolve "extracted body too short" / "no article
                    found" by waiting for the JS to populate the DOM. */}
                {data.fetchMode !== "headless" && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      data.onSetFetchMode("headless");
                    }}
                  >
                    Try with Headless
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => data.onSetViewMode("original")}
                >
                  Open as iframe
                </Button>
              </div>
            </div>
          )}
          {data.extractionStatus === "ok" && data.contentMarkdown && (
            <ReactMarkdown
              // remark-breaks turns soft line breaks (single \n) into <br>
              // — without it, sites like Hacker News whose content uses
              // single newlines render as one wall of text because
              // CommonMark collapses them.
              remarkPlugins={[remarkBreaks]}
              components={{
                a: ({ href, children }) => (
                  <a
                    href={href}
                    onClick={(e) => {
                      e.preventDefault();
                      if (href) data.onClickLink(href, String(children));
                    }}
                    draggable={Boolean(href)}
                    onDragStart={(e) => {
                      const absoluteHref = absolutize(href);
                      if (absoluteHref) {
                        e.stopPropagation();
                        writeDragExtractData(e.dataTransfer, { kind: "link", href: absoluteHref });
                      }
                    }}
                    className="text-primary underline cursor-pointer"
                  >
                    {children}
                  </a>
                ),
                // Constrain inline images to the node's content width so
                // an oversized hero doesn't push the body into horizontal
                // overflow. `origin-when-cross-origin` matches the iframe
                // proxy fix — Wikimedia + a few CDNs 403 a no-referrer
                // request. `loading="lazy"` keeps an article with 30+
                // images cheap on first render.
                img: ({ src, alt }) => (
                  <img
                    src={typeof src === "string" ? src : undefined}
                    alt={alt ?? ""}
                    loading="lazy"
                    referrerPolicy="origin-when-cross-origin"
                    className="max-w-full h-auto rounded my-2"
                    draggable={typeof src === "string"}
                    onDragStart={(e) => {
                      const absoluteSrc = typeof src === "string" ? absolutize(src) : undefined;
                      if (absoluteSrc) {
                        e.stopPropagation();
                        writeDragExtractData(e.dataTransfer, { kind: "image", src: absoluteSrc });
                      }
                    }}
                  />
                ),
              }}
            >
              {data.contentMarkdown}
            </ReactMarkdown>
          )}
        </div>
      );
      })()}
      <Handle type="source" position={Position.Right} />
      {data.links && data.links.length > 0 && (
        <LinksPanel links={data.links} onClickLink={data.onClickLink} />
      )}
    </div>
  );
}

export const PAGE_NODE_DEFAULTS = {
  width: DEFAULT_PAGE_WIDTH,
  height: DEFAULT_PAGE_HEIGHT,
};

/**
 * Iframe wrapper with a loading overlay. The overlay shows until the
 * iframe fires its first onLoad — without it, the user sees a blank
 * card for the 1-30 seconds it takes to fetch + render (especially in
 * Headless mode where Playwright waits for networkidle). The overlay
 * disappears once the proxied HTML lands. State is keyed by src, so
 * toggling fetchMode / UA re-shows the spinner during the re-fetch.
 */
function OriginalIframe({
  url,
  ua,
  sessionId,
  nodeId,
  fetchMode,
  title,
  readified = false,
}: {
  url: string;
  ua: string;
  sessionId: string;
  nodeId: string;
  fetchMode: "static" | "headless";
  title: string;
  /** True for "rich" view mode — kernel runs Readability on the upstream
   *  HTML and returns just the article body in a reading-friendly shell.
   *  Same iframe sandbox; same click-capture; lossless tables/code. */
  readified?: boolean;
}) {
  const src = `/api/browse/proxy?url=${encodeURIComponent(url)}&ua=${encodeURIComponent(ua)}&sessionId=${encodeURIComponent(sessionId)}&nodeId=${encodeURIComponent(nodeId)}&mode=${encodeURIComponent(fetchMode)}${readified ? "&readified=1" : ""}`;
  // Reset loading state when src changes so the overlay reappears on
  // toggle. useState seed runs once; this useEffect-equivalent is
  // implemented via key-comparison.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const isLoading = loadedSrc !== src;
  // Absolute-position the iframe instead of relying on `h-full` inside a
  // flex-1 wrapper. An <iframe>'s computed height in a flex column can
  // collapse to 0 in browsers that don't propagate the flex height
  // through `height: 100%` on replaced elements — the symptom is a
  // sliver-tall iframe even though the wrapper has space. inset-0 +
  // absolute on the iframe sidesteps that.
  return (
    <div className="nowheel nodrag flex-1 min-h-0 overflow-hidden relative">
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/80 text-xs text-muted-foreground pointer-events-none">
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            {fetchMode === "headless" ? "Rendering with Chromium…" : "Loading…"}
          </div>
        </div>
      )}
      <iframe
        // Toggling UA / fetchMode changes src; the browser will refetch
        // and the onLoad below re-arms the loaded marker.
        src={src}
        title={title}
        className="absolute inset-0 w-full h-full border-0"
        onLoad={() => setLoadedSrc(src)}
        // Permissive sandbox: same-origin + scripts so the page can
        // run; popups + forms + downloads so common nav works. The
        // kernel proxy strips frame-ancestors / XFO upstream so the
        // iframe even loads in the first place.
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
        // Image CDNs (Wikimedia, news sites) hot-link-protect via the
        // Referer header. no-referrer blocks every image; default
        // policy at least sends the proxy origin which the base-href
        // trick already exposes.
        referrerPolicy="origin-when-cross-origin"
      />
    </div>
  );
}

/**
 * ✨ Summary chip + per-domain auto-summary toggle. Click ✨ POSTs to
 * the kernel summarize route which creates a media-kind='summary' child
 * node (or updates the existing one) and starts the LLM call. The toggle
 * pins the __summary__ sentinel for this URL's domain so every future
 * extraction in this domain auto-creates a summary tile.
 */
function SummaryChip({ nodeId, url }: { nodeId: string; url: string }) {
  const [busy, setBusy] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [pinned, setPinned] = useState(false);
  const domain = (() => {
    try { return new URL(url).hostname; } catch { return ""; }
  })();

  async function summarize() {
    setBusy(true);
    try {
      const res = await fetch(`/api/browse/nodes/${encodeURIComponent(nodeId)}/summarize`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`POST returned ${res.status}`);
      // The kernel creates a NEW media-kind=summary child node on success.
      // The canvas's polling effect only runs when something is pending —
      // a summarize doesn't put anything pending — so we broadcast a
      // CustomEvent that canvas.tsx listens to and bumps pollTick on,
      // forcing one immediate refetch that picks up the new child node.
      window.dispatchEvent(new CustomEvent("rdan-browse-refetch"));
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(`Summary failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAutoSummary(checked: boolean) {
    if (!domain) return;
    setPinning(true);
    try {
      const res = await fetch("/api/browse/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          landmark: "__summary__",
          selector: "",
          action: checked ? "pin" : "unpin",
        }),
      });
      if (!res.ok) throw new Error(`POST returned ${res.status}`);
      setPinned(checked);
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(`Auto-summary toggle failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPinning(false);
    }
  }

  // Per-domain auto-summary checkbox is intentionally removed (was hard
  // to discover + the toggle never actually fed back into the dashboard
  // poll-tick so users couldn't tell it was on). The session-wide
  // "Auto-summarize" toggle in the URL bar replaces it.
  void pinning; void pinned; void domain; void toggleAutoSummary; // satisfy lint
  return (
    <button
      type="button"
      disabled={busy}
      onClick={summarize}
      className="text-[11px] px-1.5 py-0.5 rounded bg-card-border/40 hover:bg-card-border/70"
      title="Generate an AI summary of this page as a metadata tile"
    >
      {busy ? "✨ summarizing…" : "✨ summary"}
    </button>
  );
}

function ViewModeToggle({
  value,
  onChange,
}: {
  value: "reader" | "rich" | "original";
  onChange: (m: "reader" | "rich" | "original") => void;
}) {
  const TITLES: Record<typeof value, string> = {
    reader: "Cleaned markdown — fast, lossy on tables/code/math",
    rich: "Readability HTML in iframe — lossless tables/code, ad-free",
    original: "Full upstream page in iframe — for forms, SPAs, sites that mis-extract",
  };
  const LABELS: Record<typeof value, string> = {
    reader: "Reader",
    rich: "Rich",
    original: "Original",
  };
  return (
    <div className="inline-flex border border-card-border rounded overflow-hidden">
      {(["reader", "rich", "original"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange(m);
          }}
          className={`px-2 py-0.5 cursor-pointer ${
            value === m
              ? "bg-card-border/60 font-semibold"
              : "text-muted-foreground hover:bg-card-border/30"
          }`}
          title={TITLES[m]}
        >
          {LABELS[m]}
        </button>
      ))}
    </div>
  );
}

function FetchModeToggle({
  value,
  onChange,
}: {
  value: "static" | "headless";
  onChange: (m: "static" | "headless") => void;
}) {
  return (
    <div className="inline-flex border border-card-border rounded overflow-hidden">
      {(["static", "headless"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange(m);
          }}
          className={`px-2 py-0.5 cursor-pointer ${
            value === m
              ? "bg-card-border/60 font-semibold"
              : "text-muted-foreground hover:bg-card-border/30"
          }`}
          title={
            m === "static"
              ? "Fast plain HTTP fetch (no JS)"
              : "Headless Chromium — runs page JS, persists cookies, works on SPAs"
          }
        >
          {m === "static" ? "Static" : "Headless"}
        </button>
      ))}
    </div>
  );
}

const UA_OPTIONS: { key: string; label: string }[] = [
  { key: "default", label: "Browser (Chrome)" },
  { key: "rdan", label: "r.dan UA" },
  { key: "googlebot", label: "Googlebot" },
  { key: "bingbot", label: "Bingbot" },
  { key: "twitterbot", label: "Twitterbot" },
  { key: "facebot", label: "Facebot" },
  { key: "duckduckbot", label: "DuckDuckBot" },
  { key: "applebot", label: "Applebot" },
  { key: "firefox", label: "Firefox" },
  { key: "safari", label: "Safari" },
  { key: "iphone", label: "iPhone Safari" },
];

function UserAgentSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (ua: string) => void;
}) {
  return (
    <select
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      value={value}
      className="bg-card border border-card-border rounded px-1 py-0.5 cursor-pointer"
      title="User-Agent — picks how the kernel identifies itself when fetching this URL"
    >
      {UA_OPTIONS.map((u) => (
        <option key={u.key} value={u.key}>
          {u.label}
        </option>
      ))}
    </select>
  );
}

// Small icon button used in the node header for back/forward/reload/close.
// Stops propagation so the click doesn't bubble up to xyflow's
// onNodeClick / drag handler.
function NodeIconButton({
  onClick,
  disabled,
  ariaLabel,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`w-5 h-5 rounded leading-none text-base ${
        disabled
          ? "text-muted-foreground/30 cursor-not-allowed"
          : "text-muted-foreground hover:text-foreground hover:bg-card-border/50 cursor-pointer"
      }`}
    >
      {children}
    </button>
  );
}
