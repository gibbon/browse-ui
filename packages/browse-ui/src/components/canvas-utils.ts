// Pure helpers for the browse canvas. Extracted from canvas.tsx so the
// seen-before DFS can be unit-tested without booting xyflow + jsdom.
//
// computeSeenBefore: for each node, decide whether its URL was first
// observed on a different root branch than the one it sits in. The
// canvas uses this to render the "also at branch N" badge.

import type { Node } from "@xyflow/react";
import type { BrowseNode, BrowseEdge } from "../lib/browse-types";

/**
 * Resolve a node's actual rendered width. xyflow stores the
 * BROWSER-measured value under `measured.width` once a ResizeObserver
 * fires; before that we fall back to the configured `width`, then to
 * the inline style, then to the caller's fallback. Without measured-
 * first, a child placed at parent.right ends up overlapping the parent
 * after it grows past its initial 640px seed.
 */
export function widthOf(n: Node | null | undefined, fallback: number): number {
  if (!n) return fallback;
  const m = (n as { measured?: { width?: number } }).measured;
  return (
    m?.width
    ?? (n as { width?: number }).width
    ?? (n.style?.width as number | undefined)
    ?? fallback
  );
}

/** Mirror of widthOf for heights. Used by columnar layout's stack math. */
export function heightOf(n: Node | null | undefined, fallback: number): number {
  if (!n) return fallback;
  const m = (n as { measured?: { height?: number } }).measured;
  return (
    m?.height
    ?? (n as { height?: number }).height
    ?? (n.style?.height as number | undefined)
    ?? fallback
  );
}

export interface SeenBeforeInfo {
  seenBefore: boolean;
  seenBeforeBranch: number | null;
}

export function computeSeenBefore(
  rdanNodes: BrowseNode[],
  rdanEdges: BrowseEdge[],
): Map<string, SeenBeforeInfo> {
  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const e of rdanEdges) {
    if (e.status !== "active") continue;
    const list = childrenOf.get(e.sourceNode) ?? [];
    list.push(e.targetNode);
    childrenOf.set(e.sourceNode, list);
    parentOf.set(e.targetNode, e.sourceNode);
  }

  const activeNodes = rdanNodes.filter((n) => n.status === "active");
  const roots = activeNodes.filter((n) => !parentOf.has(n.id));

  const seenUrls = new Map<string, number>();
  const branchOfNode = new Map<string, number>();
  let nextBranch = 1;
  const visited = new Set<string>();

  for (const root of roots) {
    const branch = nextBranch++;
    const stack = [root.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      branchOfNode.set(id, branch);
      const node = activeNodes.find((n) => n.id === id);
      if (node && !seenUrls.has(node.url)) seenUrls.set(node.url, branch);
      const kids = childrenOf.get(id) ?? [];
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
  }

  const out = new Map<string, SeenBeforeInfo>();
  for (const n of rdanNodes) {
    const firstBranch = seenUrls.get(n.url);
    const myBranch = branchOfNode.get(n.id);
    const seenBefore =
      firstBranch != null && myBranch != null && firstBranch !== myBranch;
    out.set(n.id, {
      seenBefore,
      seenBeforeBranch: seenBefore ? firstBranch! : null,
    });
  }
  return out;
}
