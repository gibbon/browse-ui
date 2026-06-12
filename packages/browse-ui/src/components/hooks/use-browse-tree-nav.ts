"use client";

// Tree navigation for the browse canvas's chrome bar: back = parent of
// focused page node, forward = most-recent page descendant. Re-derived
// from rdanNodes/rdanEdges so it always reflects current canvas state.
//
// Returns the back/forward command callbacks + boolean flags for the
// chrome bar's button-enabled states.

import { useCallback, useMemo } from "react";
import type { BrowseNode, BrowseEdge } from "../../lib/browse-types";

interface UseBrowseTreeNavArgs {
  rdanNodes: BrowseNode[];
  rdanEdges: BrowseEdge[];
  getFocused: () => string | null;
  setFocused: (id: string | null) => void;
  focusNode: (id: string) => void;
}

export function useBrowseTreeNav({
  rdanNodes,
  rdanEdges,
  getFocused,
  setFocused,
  focusNode,
}: UseBrowseTreeNavArgs) {
  const tree = useMemo(() => {
    const parentOf = new Map<string, string>();
    const childrenOf = new Map<string, string[]>();
    const isPage = new Set(
      rdanNodes
        .filter((n) => n.kind === "page" && n.status === "active")
        .map((n) => n.id),
    );
    for (const e of rdanEdges) {
      if (e.status !== "active") continue;
      if (!isPage.has(e.sourceNode) || !isPage.has(e.targetNode)) continue;
      parentOf.set(e.targetNode, e.sourceNode);
      const list = childrenOf.get(e.sourceNode) ?? [];
      list.push(e.targetNode);
      childrenOf.set(e.sourceNode, list);
    }
    return { parentOf, childrenOf };
  }, [rdanNodes, rdanEdges]);

  const handleTreeBack = useCallback(() => {
    const id = getFocused();
    if (!id) return;
    const parent = tree.parentOf.get(id);
    if (parent) {
      setFocused(parent);
      focusNode(parent);
    }
  }, [tree, focusNode, getFocused, setFocused]);

  const handleTreeForward = useCallback(() => {
    const id = getFocused();
    if (!id) return;
    const kids = tree.childrenOf.get(id) ?? [];
    const last = kids[kids.length - 1];
    if (last) {
      setFocused(last);
      focusNode(last);
    }
  }, [tree, focusNode, getFocused, setFocused]);

  /** Whether the chrome bar's Back button should be enabled given the
   *  currently-focused node. Computed eagerly (caller can re-evaluate
   *  on every render — the underlying check is O(1) Map lookup). */
  const canBack = useCallback(() => {
    const id = getFocused();
    return Boolean(id && tree.parentOf.has(id));
  }, [tree, getFocused]);

  const canForward = useCallback(() => {
    const id = getFocused();
    return Boolean(id && (tree.childrenOf.get(id)?.length ?? 0) > 0);
  }, [tree, getFocused]);

  return { handleTreeBack, handleTreeForward, canBack, canForward };
}
