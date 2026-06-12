"use client";

// Single source of truth for browse node positions. Pure derivation:
// rdanNodes + rdanEdges + viewport overrides go in, NodePlacement map
// comes out via computeColumnarLayout. No side effects, no state.
//
// This hook exists because canvas.tsx previously had FIVE different
// functions that each decided "where does a new child node go" with
// disagreeing algorithms — see commits 9765c3f4, a552257a for the
// bug-hunt fallout. Routing every position through this hook makes
// it structurally impossible for a future spawn surface to reintroduce
// the bug class.

import { useMemo } from "react";
import { computeColumnarLayout, type NodePlacement } from "../columnar-layout";

// Stable empty-array defaults: when a caller omits groups/groupMembers
// we must hand the SAME reference every render, otherwise the useMemo
// below sees a new dependency identity each time and the placement-map
// reference is no longer stable (which the downstream xyflow consumers
// rely on to skip re-layout work).
const EMPTY_GROUPS: BrowseGroup[] = [];
const EMPTY_MEMBERS: BrowseGroupMember[] = [];
// Stable empty default for the drop-position overrides (drag-extract drops
// land where the cursor released). Same reference every render when no
// drops exist, so the placement-map memo below stays reference-stable.
const EMPTY_OVERRIDES: Map<string, { x: number; y: number }> = new Map();
import type {
  BrowseNode,
  BrowseEdge,
  BrowseViewport,
  BrowseGroup,
  BrowseGroupMember,
} from "../../lib/browse-types";

/**
 * Compute layout positions for every active node in the session.
 *
 * Returned map keys: node ids. Values: {x, y, width, height} from the
 * columnar layout, with user drag overrides (from viewport.nodePositions)
 * applied.
 *
 * Memoised on input identity — the same `rdanNodes` / `rdanEdges` /
 * `viewport.nodePositions` references produce the same Map reference,
 * letting downstream xyflow consumers skip re-layout work.
 */
export function useBrowseLayout(
  rdanNodes: BrowseNode[],
  rdanEdges: BrowseEdge[],
  viewport: BrowseViewport | null,
  groups: BrowseGroup[] = EMPTY_GROUPS,
  groupMembers: BrowseGroupMember[] = EMPTY_MEMBERS,
  /** Live drop-position overrides (drag-extract). Merged AFTER the
   *  persisted viewport overrides so a fresh drop wins, and keyed by the
   *  new node id so the dropped pane lands at the cursor instead of its
   *  columnar slot. */
  extraOverrides: Map<string, { x: number; y: number }> = EMPTY_OVERRIDES,
): Map<string, NodePlacement> {
  return useMemo(() => {
    const overrides = new Map<string, { x: number; y: number }>(
      Object.entries(viewport?.nodePositions ?? {}),
    );
    for (const [id, pos] of extraOverrides) overrides.set(id, pos);
    return computeColumnarLayout(rdanNodes, rdanEdges, overrides, groups, groupMembers);
  }, [rdanNodes, rdanEdges, viewport?.nodePositions, groups, groupMembers, extraOverrides]);
}
