// Pure helpers for the browse → Chat side panel. Splits selection
// capture and prefill text construction out of the React component so
// both are unit-testable in isolation.

import type { BrowseNode } from "@/lib/browse-types";

/**
 * Read the current text selection, restricted to a given DOM root and
 * (optionally) the inside of an iframe. Returns null when no selection
 * (or the selection sits outside the requested region). Used by the
 * → Chat button to capture whatever the user has highlighted on a
 * node before opening the chat panel.
 *
 * Same-origin iframe contentWindow access is fine — the browse proxy
 * iframe is served from the dashboard origin via /api/browse/proxy.
 */
export function captureSelection(
  root: HTMLElement | null,
  iframe?: HTMLIFrameElement | null,
): string | null {
  // 1. Iframe selection wins when it has one — most page content lives
  //    there. Caller may pass the iframe directly; otherwise we hunt
  //    inside the root for the first one (PageNode renders its proxy
  //    iframe nested inside several wrappers, so direct ref plumbing
  //    would mean forwarding refs through 2-3 components).
  const ifr = iframe ?? root?.querySelector("iframe") ?? null;
  if (ifr?.contentWindow) {
    try {
      const sel = ifr.contentWindow.getSelection();
      const text = sel?.toString().trim();
      if (text) return text;
    } catch {
      // Cross-origin iframe — we shouldn't hit this for the proxy iframe
      // but the catch guards against future iframe sources.
    }
  }
  // 2. Then the node's own DOM (section/summary tiles).
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  const text = sel?.toString().trim();
  if (!text) return null;
  if (!root) return text;
  for (let i = 0; i < sel!.rangeCount; i++) {
    if (root.contains(sel!.getRangeAt(i).commonAncestorContainer)) {
      return text;
    }
  }
  return null;
}

/**
 * Pick the fallback body text when the user hasn't selected anything.
 * Order per spec §3: summary → first 500 chars of content_markdown →
 * media_src (for section/summary tiles) → URL only.
 *
 * Evicted pages with no summary degrade gracefully to URL only — content
 * is restored once the user reloads the node.
 */
export function pickFallbackBody(node: BrowseNode): string {
  if (node.summaryText && node.summaryStatus === "ok") return node.summaryText;
  if (node.contentMarkdown) return node.contentMarkdown.slice(0, 500);
  if (node.kind === "media" && node.mediaSrc) return node.mediaSrc.slice(0, 500);
  return node.url;
}

/**
 * Build the markdown blockquote that pre-fills the chat composer.
 * Format:
 *   > **[<title>](<url>)**
 *   >
 *   > <body line 1>
 *   > <body line 2>
 *   …
 *   <blank line — cursor lands here>
 */
export function buildPrefill(node: BrowseNode, selection: string | null): string {
  const title = node.title ?? node.url;
  const header = `> **[${title}](${node.url})**`;
  const body = (selection ?? pickFallbackBody(node)).trim();
  const quoted = body
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  const kindHint = ((): string => {
    if (node.kind === "page") return `Pane: page (kind=page, host=${hostOf(node.url)}).`;
    if (node.mediaKind) return `Pane: ${node.mediaKind} tile.`;
    return `Pane: ${node.kind} tile.`;
  })();
  // The per-pane → Chat opens r.dan (general questions about content).
  // To MODIFY the canvas itself (widths, sections, palette, behaviour),
  // close this and hit ✦ Customise in the URL bar — that opens a fresh
  // chat bound directly to pi-coder so the request lands without
  // depending on r.dan to delegate.
  const customiseHint =
    `${kindHint} Ask me about its content. For canvas changes (wider tiles, ` +
    `new sections, palette), use ✦ Customise in the URL bar — that goes ` +
    `straight to pi-coder.`;
  // Quote the hint too (`> _…_`) so the ENTIRE block lifts into the
  // QuoteCard — a labelled box above the composer — leaving the textarea
  // empty for the user's request. joinComposer re-attaches it on send.
  return `${header}\n>\n${quoted}\n>\n> _${customiseHint}_\n\n`;
}

function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Canvas-level prefill — for the URL-bar "✦ Customise" button. No
 *  specific node selected; instead summarises the canvas itself so
 *  the agent has context for global asks ("make all youtube tiles
 *  wider", "add a transcript section"). */
export function buildCanvasPrefill(opts: {
  sessionId: string;
  nodeCount: number;
  hosts: string[];
  focusedNodeId: string | null;
  focusedNodeTitle: string | null;
  focusedNodeUrl: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`> **Browse canvas — session \`${opts.sessionId}\`**`);
  lines.push(`>`);
  lines.push(`> ${opts.nodeCount} active node${opts.nodeCount === 1 ? "" : "s"}.`);
  if (opts.hosts.length > 0) {
    lines.push(`> Hosts represented: ${opts.hosts.slice(0, 6).join(", ")}${opts.hosts.length > 6 ? "…" : ""}`);
  }
  if (opts.focusedNodeUrl) {
    lines.push(`> Focused pane: ${opts.focusedNodeTitle ?? opts.focusedNodeUrl} (${hostOf(opts.focusedNodeUrl)}).`);
  }
  // Quote the pi-coder guidance too, so the ENTIRE block lifts into the
  // QuoteCard (a box above the composer) and the textarea stays empty for
  // the user's request. joinComposer re-attaches it on send.
  lines.push(`>`);
  lines.push(
    `> _You are pi-coder. Edit the canvas directly — no need to delegate. ` +
    `Layout / widths / columns: \`dashboard/components/browse/columnar-layout.ts\`. ` +
    `Host-specific sections: \`src/plugins/browse/section-detector.ts\`. ` +
    `Palette / theme: \`dashboard/app/globals.css\`. ` +
    `Other UI: \`dashboard/components/browse/\`. ` +
    `Restart the dashboard with the auto-rebuild hook; kernel changes need \`docker compose restart rdan\`._`,
  );
  lines.push("");
  lines.push("");
  return lines.join("\n");
}
