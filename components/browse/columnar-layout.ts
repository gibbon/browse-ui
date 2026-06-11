// Pure layout function for the browse canvas. Maps a session's active node
// tree to per-node (x, y, width, height). Depth → column; siblings stack
// vertically; metadata children get a paired metadata column right of
// their depth's page column; widths shrink ~15% per depth (floor 360);
// user drag overrides (from BrowseViewport.nodePositions) win.
//
// Why pure: this function runs every render of canvas.tsx and we want it
// unit-testable in isolation without booting xyflow + jsdom.
//
// Spec: docs/superpowers/specs/2026-05-24-browse-columnar-layout-design.md

import type { BrowseNode, BrowseEdge, BrowseGroup, BrowseGroupMember } from "@/lib/browse-types";
import { membersByGroup, computeFrameBounds } from "./group-utils";

export const PAGE_HEIGHT = 1400;
export const META_WIDTH = 480;
export const META_HEIGHT = 540;
export const GALLERY_WIDTH = 480;
export const GALLERY_HEIGHT = 540;
// Breathing room between sibling page nodes + adjacent columns. Bumped
// from 24 → 80 (rows) / 48 (columns) after user feedback that pages
// felt cramped. Meta tiles inside a column stack tighter (12 / 12)
// because they're meant to read as a unit.
export const ROW_GUTTER = 80;
export const COLUMN_GUTTER = 48;
export const META_ROW_GUTTER = 12;
export const GALLERY_ROW_GUTTER = 12;

const PAGE_WIDTH_BASE = 840;
const PAGE_WIDTH_SHRINK = 0.85;
const PAGE_WIDTH_FLOOR = 360;

/** Hosts that render best with a wider tile — video/streaming sites
 *  bake in a 16:9 player + sidebar that's painful at 840. The width
 *  picked is the depth-0 base; siblings further down still shrink
 *  via PAGE_WIDTH_SHRINK on top of this base. Add new hosts here
 *  rather than per-instance overrides. */
const WIDE_HOST_BASE: Record<string, number> = {
  "www.youtube.com": 1100,
  "youtube.com": 1100,
  "m.youtube.com": 1100,
  "youtu.be": 1100,
  "www.twitch.tv": 1100,
  "twitch.tv": 1100,
  "vimeo.com": 1100,
  "www.vimeo.com": 1100,
};

function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function pageWidthForDepth(depth: number): number {
  const w = Math.round(PAGE_WIDTH_BASE * Math.pow(PAGE_WIDTH_SHRINK, depth));
  return Math.max(w, PAGE_WIDTH_FLOOR);
}

/** Like pageWidthForDepth but consults WIDE_HOST_BASE for the seed
 *  width when the page is a known wide host. Falls back to the
 *  standard 840 base for everything else. */
export function pageWidthForNode(url: string | null | undefined, depth: number): number {
  const host = hostOf(url);
  const base = WIDE_HOST_BASE[host] ?? PAGE_WIDTH_BASE;
  const w = Math.round(base * Math.pow(PAGE_WIDTH_SHRINK, depth));
  return Math.max(w, PAGE_WIDTH_FLOOR);
}

export interface NodePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the layout for a session's active nodes/edges.
 *
 * - Roots (active page nodes with no parent) stack from y=0 in column 0.
 * - Page children of a parent stack vertically starting at parent.y in
 *   the next depth's page column.
 * - Media children (kind='media': sections, summaries, popouts) live in
 *   the paired metadata column at the PARENT's depth, anchored to the
 *   parent's y. Summary tiles render first (top of the meta stack) by
 *   sorting metadata children with mediaKind='summary' ahead of others.
 * - Overrides win: a node id present in `overrides` uses that (x, y)
 *   verbatim and width/height fall back to the computed defaults.
 */
export function computeColumnarLayout(
  nodes: BrowseNode[],
  edges: BrowseEdge[],
  overrides: Map<string, { x: number; y: number }>,
  groups: BrowseGroup[] = [],
  groupMembers: BrowseGroupMember[] = [],
): Map<string, NodePlacement> {
  const active = nodes.filter((n) => n.status === "active");
  const activeEdges = edges.filter((e) => e.status === "active");

  const nodeById = new Map(active.map((n) => [n.id, n]));
  const childOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const e of activeEdges) {
    if (!nodeById.has(e.sourceNode) || !nodeById.has(e.targetNode)) continue;
    const list = childOf.get(e.sourceNode) ?? [];
    list.push(e.targetNode);
    childOf.set(e.sourceNode, list);
    parentOf.set(e.targetNode, e.sourceNode);
  }

  // Depth via memoised recursion.
  const depthOf = new Map<string, number>();
  function depth(id: string): number {
    if (depthOf.has(id)) return depthOf.get(id)!;
    const p = parentOf.get(id);
    const d = p && nodeById.has(p) ? depth(p) + 1 : 0;
    depthOf.set(id, d);
    return d;
  }
  for (const n of active) depth(n.id);

  // Which depths have at least one metadata / gallery child (so we need
  // to reserve the corresponding columns at that depth)?
  // All non-page children (summary, gallery, video/iframe/image, section)
  // share ONE meta column immediately right of the page, stacked
  // vertically. Sort order in the stack: summary first (TL;DR), then
  // visual media (gallery / video / iframe / image), then text-meta
  // (section / other). Rationale: the user reads top-down, so the
  // most-informative tile (LLM summary) lands at eye level.
  const isSummaryNode = (n: BrowseNode) =>
    n.kind === "media" && n.mediaKind === "summary";
  const isDetailedSummaryNode = (n: BrowseNode) =>
    n.kind === "media" && n.mediaKind === "summary-detailed";
  const isVisualMediaKind = (mk: string | null | undefined) =>
    mk === "video" || mk === "iframe" || mk === "image";
  const isVisualMediaNode = (n: BrowseNode) =>
    n.kind === "gallery" || (n.kind === "media" && isVisualMediaKind(n.mediaKind));

  const depthsWithMeta = new Set<number>();
  const depthsWithDetailed = new Set<number>();
  for (const n of active) {
    if (n.kind === "page") continue;
    const parent = parentOf.get(n.id);
    const parentDepth = parent ? depthOf.get(parent) ?? 0 : 0;
    if (isDetailedSummaryNode(n)) {
      depthsWithDetailed.add(parentDepth);
    } else {
      depthsWithMeta.add(parentDepth);
    }
  }

  // Compute column x positions per depth.
  // Order per depth: page → META (summary + sections + visual media)
  // → DETAILED (detailed summary in its own column to the right of
  // meta, aligned vertically with the basic summary tile). The
  // detailed column is allocated only when a page at this depth
  // actually has a detailed-summary child.
  // Iterative max instead of Math.max(...spread) — the spread variant
  // hits V8's argument-count soft limit on very large sessions.
  let maxDepth = 0;
  for (const d of depthOf.values()) if (d > maxDepth) maxDepth = d;

  // Per-depth max page width — wide hosts (YouTube etc) bump the
  // depth's column width so siblings still align cleanly into the
  // next column. Otherwise a single YouTube page at depth 1 would
  // overlap depth-2 pages.
  const pageWidthAt = new Map<number, number>();
  for (const n of active) {
    if (n.kind !== "page") continue;
    const d = depthOf.get(n.id) ?? 0;
    const w = pageWidthForNode(n.url, d);
    const cur = pageWidthAt.get(d) ?? 0;
    if (w > cur) pageWidthAt.set(d, w);
  }
  const depthPageWidth = (d: number): number =>
    pageWidthAt.get(d) ?? pageWidthForDepth(d);
  // Width of the meta column = the widest possible child tile
  // (gallery 480 ≈ meta 480), keeping a single allocation simple.
  const META_COL_WIDTH = Math.max(META_WIDTH, GALLERY_WIDTH);
  const DETAILED_COL_WIDTH = META_WIDTH;
  const colX = new Map<number, { pageX: number; metaX: number | null; detailedX: number | null }>();
  let cursor = 0;
  for (let d = 0; d <= maxDepth; d++) {
    const pageW = depthPageWidth(d);
    const hasMeta = depthsWithMeta.has(d);
    const hasDetailed = depthsWithDetailed.has(d);
    const metaX = hasMeta ? cursor + pageW + COLUMN_GUTTER : null;
    const detailedX = hasDetailed
      ? (metaX !== null ? metaX + META_COL_WIDTH + COLUMN_GUTTER : cursor + pageW + COLUMN_GUTTER)
      : null;
    colX.set(d, { pageX: cursor, metaX, detailedX });
    cursor +=
      pageW + COLUMN_GUTTER
      + (hasMeta ? META_COL_WIDTH + COLUMN_GUTTER : 0)
      + (hasDetailed ? DETAILED_COL_WIDTH + COLUMN_GUTTER : 0);
  }

  const placement = new Map<string, NodePlacement>();
  const pageChildrenOf = (id: string) =>
    (childOf.get(id) ?? []).filter((cid) => nodeById.get(cid)?.kind === "page");

  /** Sort order in the single meta column: summary first (TL;DR at top),
   *  then visual media (gallery / video / iframe / image), then text-
   *  meta (section / other). Detailed summary is EXCLUDED — it goes
   *  in its own column to the right of the meta column. Stable for
   *  same-category ties so insertion order is preserved. */
  function metaSortKey(n: BrowseNode | undefined): number {
    if (!n) return 9;
    if (isSummaryNode(n)) return 0;
    if (isVisualMediaNode(n)) return 1;
    return 2; // section + future text-meta
  }
  const metaChildrenOf = (id: string) => {
    const kids = (childOf.get(id) ?? []).filter((cid) => {
      const n = nodeById.get(cid);
      return n?.kind !== "page" && !isDetailedSummaryNode(n!);
    });
    return kids
      .map((cid, idx) => ({ cid, sort: metaSortKey(nodeById.get(cid)), idx }))
      .sort((a, b) => a.sort - b.sort || a.idx - b.idx)
      .map((x) => x.cid);
  };
  const detailedSummaryChildrenOf = (id: string) =>
    (childOf.get(id) ?? []).filter((cid) => isDetailedSummaryNode(nodeById.get(cid)!));

  // Per-tile dimensions: galleries are taller, summaries/sections are
  // medium height. Width is uniform across kinds so the column doesn't
  // shimmer left/right between rows.
  function tileSize(n: BrowseNode | undefined): { w: number; h: number; rowGutter: number } {
    if (n?.kind === "gallery" || (n?.kind === "media" && isVisualMediaKind(n.mediaKind))) {
      return { w: GALLERY_WIDTH, h: GALLERY_HEIGHT, rowGutter: GALLERY_ROW_GUTTER };
    }
    return { w: META_WIDTH, h: META_HEIGHT, rowGutter: META_ROW_GUTTER };
  }

  // BFS through page tree to track sibling stack positions per parent.
  function placePage(id: string, y: number): number {
    const d = depthOf.get(id)!;
    const node = nodeById.get(id);
    const w = pageWidthForNode(node?.url, d);
    const ovr = overrides.get(id);
    placement.set(id, {
      x: ovr?.x ?? colX.get(d)!.pageX,
      y: ovr?.y ?? y,
      width: w,
      height: PAGE_HEIGHT,
    });

    // All non-page, non-detailed-summary children stack in ONE meta
    // column anchored to the page's y. Sort: summary → visual → text-meta.
    let metaY = ovr?.y ?? y;
    const metaXVal = colX.get(d)!.metaX
      ?? colX.get(d)!.pageX + w + COLUMN_GUTTER;
    for (const mid of metaChildrenOf(id)) {
      const child = nodeById.get(mid);
      const { w: tw, h: th, rowGutter } = tileSize(child);
      const mo = overrides.get(mid);
      placement.set(mid, {
        x: mo?.x ?? metaXVal,
        y: mo?.y ?? metaY,
        width: tw,
        height: th,
      });
      metaY += th + rowGutter;
    }

    // Detailed summary tiles go in their own column to the right of
    // the meta column, anchored at the page's y so they sit visually
    // next to the basic summary (which is the first tile in meta).
    // Multiple detailed tiles stack vertically (rare but supported).
    const detailedXVal = colX.get(d)!.detailedX;
    if (detailedXVal !== null) {
      let detailedY = ovr?.y ?? y;
      for (const did of detailedSummaryChildrenOf(id)) {
        const child = nodeById.get(did);
        const { w: tw, h: th, rowGutter } = tileSize(child);
        const dovr = overrides.get(did);
        placement.set(did, {
          x: dovr?.x ?? detailedXVal,
          y: dovr?.y ?? detailedY,
          width: tw,
          height: th,
        });
        detailedY += th + rowGutter;
      }
    }

    // Row footprint = max(page bottom, meta-stack bottom). Sibling
    // pages stack below this so a tall meta column (lots of sections
    // / videos / links) doesn't get overlapped by the next sibling
    // page. Previously the stack used a fixed PAGE_HEIGHT stride.
    const pageBottom = (ovr?.y ?? y) + PAGE_HEIGHT;
    const rowBottom = Math.max(pageBottom, metaY);
    let childY = ovr?.y ?? y;
    let subtreeMaxY = rowBottom;
    for (const cid of pageChildrenOf(id)) {
      const reached = placePage(cid, childY);
      childY = reached + ROW_GUTTER;
      subtreeMaxY = Math.max(subtreeMaxY, reached);
    }
    return subtreeMaxY;
  }

  const roots = active.filter((n) => n.kind === "page" && !parentOf.has(n.id));
  let rootCursor = 0;
  for (const root of roots) {
    const reached = placePage(root.id, rootCursor);
    rootCursor = reached + ROW_GUTTER;
  }

  // Fallback pass: place any active node the page-tree walk missed. The
  // walk only descends page nodes + their direct meta-children, so a node
  // whose PARENT is itself a non-page tile — e.g. a clip drag-extracted
  // from another clip / summary / section — never gets positioned and
  // would default to (0,0) (on top of the first pane). Honor a drop/user
  // override if present (drag-extract always sets one); otherwise tuck it
  // just right of its parent so it's at least visible and linked.
  for (const n of active) {
    if (placement.has(n.id)) continue;
    const { w: tw, h: th } = tileSize(n);
    const ovr = overrides.get(n.id);
    if (ovr) {
      placement.set(n.id, { x: ovr.x, y: ovr.y, width: tw, height: th });
      continue;
    }
    const pp = parentOf.get(n.id)
      ? placement.get(parentOf.get(n.id)!)
      : undefined;
    placement.set(n.id, {
      x: (pp?.x ?? 0) + (pp?.width ?? 0) + COLUMN_GUTTER,
      y: pp?.y ?? 0,
      width: tw,
      height: th,
    });
  }

  // Group frames: for each active group, compute a padded bounding box
  // around the placements of its active members. The box width/height
  // come from the live placement so the frame tracks member moves; the
  // frame's (x,y) can be dragged independently and persists via the
  // 'group:<id>' override key.
  // Extra top clearance so the frame's label header band doesn't overlap
  // the first member pane. build-flow reparents members relative to the
  // frame's y, so extending the frame UP by GROUP_HEADER_H pushes every
  // member down out from under the label.
  const GROUP_HEADER_H = 40;
  const byGroupForFrames = membersByGroup(groupMembers);
  for (const g of groups) {
    if (g.status !== "active") continue;
    const memberIds = byGroupForFrames.get(g.id) ?? [];
    const bounds = computeFrameBounds(memberIds, placement);
    if (bounds === null) continue;
    const override = overrides.get("group:" + g.id);
    const frame = override
      ? { x: override.x, y: override.y, width: bounds.width, height: bounds.height + GROUP_HEADER_H }
      : { x: bounds.x, y: bounds.y - GROUP_HEADER_H, width: bounds.width, height: bounds.height + GROUP_HEADER_H };
    placement.set("group:" + g.id, frame);
  }

  return placement;
}
