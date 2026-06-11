"use client";

// Optimistic spawn/close actions for the browse canvas. Each spawn
// handler POSTs the new node to the kernel, then updates rdanNodes/
// rdanEdges. The derived-flow useEffect in canvas.tsx re-derives
// xyflow positions on the next render — these handlers don't touch
// setNodes/setEdges directly.
//
// `onSpawned(id)` is invoked after a successful spawn so the canvas
// can pan the camera once useBrowseLayout has placed the new node
// (see pendingFocusIdRef in canvas.tsx).

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BrowseNode, BrowseEdge, BrowseMedia } from "@/lib/browse-types";
import { classifyDirectMedia, isLoginUrl } from "@/lib/media-classify";
import type { NodeUiState, ViewMode } from "./use-node-ui-state";
import type { SessionDefaults } from "./use-session-defaults";

interface SpawnResponse {
  node: BrowseNode;
  edge?: BrowseEdge;
}

interface HideRecord {
  nodeIds: string[];
  edgeIds: string[];
  expiresAt: number;
}

interface UseBrowseSpawnActionsArgs {
  sessionId: string;
  rdanNodes: BrowseNode[];
  rdanEdges: BrowseEdge[];
  setRdanNodes: Dispatch<SetStateAction<BrowseNode[]>>;
  setRdanEdges: Dispatch<SetStateAction<BrowseEdge[]>>;
  nodeUiState: Map<string, NodeUiState>;
  setNodeUiState: Dispatch<SetStateAction<Map<string, NodeUiState>>>;
  sessionDefaults: SessionDefaults;
  defaultViewMode: ViewMode;
  setLastHide: Dispatch<SetStateAction<HideRecord | null>>;
  /** Called with the new node id after a successful spawn so the
   *  caller can pan the camera once layout has placed the node. */
  onSpawned: (id: string) => void;
}

export function useBrowseSpawnActions({
  sessionId,
  rdanNodes,
  rdanEdges,
  setRdanNodes,
  setRdanEdges,
  nodeUiState,
  setNodeUiState,
  sessionDefaults,
  defaultViewMode,
  setLastHide,
  onSpawned,
}: UseBrowseSpawnActionsArgs) {
  const postNode = useCallback(
    async (body: {
      parentNodeId?: string | null;
      url: string;
      kind: "page" | "media";
      linkText?: string;
      mediaSrc?: string;
      mediaKind?: "image" | "video" | "iframe";
      userAgent?: string;
      useHeadless?: boolean;
    }): Promise<SpawnResponse> => {
      const res = await fetch(
        `/api/browse/sessions/${encodeURIComponent(sessionId)}/nodes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`spawn failed (${res.status}): ${txt || res.statusText}`);
      }
      return (await res.json()) as SpawnResponse;
    },
    [sessionId],
  );

  const addOptimisticMediaChild = useCallback(
    async (parentId: string, m: BrowseMedia): Promise<string | undefined> => {
      try {
        const returned = await postNode({
          parentNodeId: parentId,
          url: m.src,
          kind: "media",
          mediaSrc: m.src,
          mediaKind: m.kind,
          linkText: m.alt ?? undefined,
        });
        setRdanNodes((curr) => [...curr, returned.node]);
        if (returned.edge) {
          setRdanEdges((curr) => [...curr, returned.edge!]);
        }
        // Return the new node id so drag-extract can add the dropped
        // media tile to a group frame it landed inside (mirrors
        // addOptimisticPageChild's return).
        return returned.node.id;
      } catch (err) {
        console.error("spawn media failed", err);
      }
    },
    [postNode, setRdanNodes, setRdanEdges],
  );

  /** Drag-extract: a text selection dragged out of a source page becomes
   *  a clip node linked to its source by a dashed `derived` edge. POSTs
   *  to the clips endpoint (which returns {node, edge}) and pushes both
   *  into rdan state in the same pattern as addOptimisticMediaChild. */
  const addOptimisticClip = useCallback(
    async (
      sourceId: string,
      text: string,
      sourceUrl: string,
    ): Promise<string | undefined> => {
      try {
        const res = await fetch(
          `/api/browse/sessions/${encodeURIComponent(sessionId)}/clips`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceNodeId: sourceId, text, sourceUrl }),
          },
        );
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(
            `clip failed (${res.status}): ${txt || res.statusText}`,
          );
        }
        const returned = (await res.json()) as SpawnResponse;
        setRdanNodes((curr) => [...curr, returned.node]);
        if (returned.edge) {
          setRdanEdges((curr) => [...curr, returned.edge!]);
        }
        return returned.node.id;
      } catch (err) {
        console.error("spawn clip failed", err);
      }
    },
    [sessionId, setRdanNodes, setRdanEdges],
  );

  const addOptimisticRoot = useCallback(
    async (url: string) => {
      // Same classifier the link-click flow runs — typing
      // youtube.com/watch?v=X into the URL bar should spawn an iframe
      // media node, not a page node that runs browse-clean against an
      // empty SPA shell. Login-shaped URLs hand off to the real
      // browser the same way too.
      if (isLoginUrl(url)) {
        if (typeof window !== "undefined") {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      // Only direct media URLs (.mp4 / .jpg / .pdf / etc.) spawn as
      // root media tiles — embed-host page URLs (youtube.com/watch
      // etc.) spawn as page roots so kernel auto-extract pulls the
      // embed iframe into the meta column on extraction.
      const direct = classifyDirectMedia(url);
      if (direct) {
        try {
          const returned = await postNode({
            url: direct.embedUrl,
            kind: "media",
            mediaSrc: direct.embedUrl,
            mediaKind: direct.kind === "image" ? "image" : direct.kind,
          });
          setRdanNodes((curr) => [...curr, returned.node]);
          onSpawned(returned.node.id);
        } catch (err) {
          console.error("spawn root media failed", err);
        }
        return;
      }
      // Seed the kernel fetch with the session's default headless flag
      // so the FIRST extraction uses the chosen mode — without this,
      // the initial fetch is always static and the user has to Reload
      // to apply Headless.
      const returned = await postNode({
        url,
        kind: "page",
        useHeadless: sessionDefaults.fetchMode === "headless",
      });
      setRdanNodes((curr) => [...curr, returned.node]);
      if (returned.edge) {
        setRdanEdges((curr) => [...curr, returned.edge!]);
      }
      onSpawned(returned.node.id);
    },
    [postNode, sessionDefaults.fetchMode, setRdanNodes, setRdanEdges, onSpawned],
  );

  const addOptimisticPageChild = useCallback(
    async (parentId: string, url: string, linkText: string) => {
      // Auth-protected URLs: open in the user's real browser instead
      // of a node. The kernel fetches server-side with no cookies +
      // no JS, so OAuth flows + login forms can't work.
      if (isLoginUrl(url)) {
        if (typeof window !== "undefined") {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      // Direct media files (mp4 / jpg / pdf / etc.) skip browse-clean
      // and spawn as a media tile directly — they're not pages.
      // Embed-host PAGE URLs (youtube.com/watch?v=X, vimeo.com/123)
      // fall through and spawn as page nodes; the kernel's auto-extract
      // pulls the embed iframe into the meta column on extraction, so
      // the user gets BOTH a navigable page AND the player tile.
      const direct = classifyDirectMedia(url);
      if (direct) {
        await addOptimisticMediaChild(parentId, {
          kind: direct.kind === "image" ? "image" : direct.kind,
          src: direct.embedUrl,
          alt: linkText,
          position: 0,
        });
        return;
      }
      try {
        // Inherit fetchMode + UA from parent if user explicitly set
        // them; otherwise fall back to the session default.
        const parentUi = nodeUiState.get(parentId);
        const inheritedFetchMode =
          parentUi?.fetchMode ?? sessionDefaults.fetchMode;
        const inheritedUa = parentUi?.userAgent ?? "default";
        const returned = await postNode({
          parentNodeId: parentId,
          url,
          kind: "page",
          linkText,
          useHeadless: inheritedFetchMode === "headless",
          userAgent: inheritedUa,
        });
        setRdanNodes((curr) => [...curr, returned.node]);
        setNodeUiState((prev) => {
          const next = new Map(prev);
          next.set(returned.node.id, {
            viewMode: parentUi?.viewMode ?? defaultViewMode,
            userAgent: inheritedUa,
            fetchMode: inheritedFetchMode,
          });
          return next;
        });
        if (returned.edge) {
          setRdanEdges((curr) => [...curr, returned.edge!]);
        }
        onSpawned(returned.node.id);
        return returned.node.id;
      } catch (err) {
        console.error("spawn child failed", err);
      }
    },
    [
      postNode, nodeUiState, sessionDefaults.fetchMode,
      defaultViewMode, addOptimisticMediaChild, setRdanNodes, setRdanEdges, setNodeUiState, onSpawned,
    ],
  );

  /** Re-fetch the same URL as a fresh page node. The reload-child sits
   *  in the standard sibling-column layout slot; the history-column
   *  "below the source" metaphor is not preserved by the columnar
   *  refactor — see the refactor spec's non-goals. */
  const addOptimisticReloadChild = useCallback(
    async (parentId: string, url: string) => {
      try {
        const parentUi = nodeUiState.get(parentId);
        const inheritedFetchMode =
          parentUi?.fetchMode ?? sessionDefaults.fetchMode;
        const inheritedUa = parentUi?.userAgent ?? "default";
        const returned = await postNode({
          parentNodeId: parentId,
          url,
          kind: "page",
          linkText: "(reload)",
          useHeadless: inheritedFetchMode === "headless",
          userAgent: inheritedUa,
        });
        setRdanNodes((curr) => [...curr, returned.node]);
        setNodeUiState((prev) => {
          const next = new Map(prev);
          next.set(returned.node.id, {
            viewMode: parentUi?.viewMode ?? defaultViewMode,
            userAgent: inheritedUa,
            fetchMode: inheritedFetchMode,
          });
          return next;
        });
        if (returned.edge) {
          setRdanEdges((curr) => [...curr, returned.edge!]);
        }
        onSpawned(returned.node.id);
      } catch (err) {
        console.error("reload spawn failed", err);
      }
    },
    [postNode, nodeUiState, sessionDefaults.fetchMode, defaultViewMode, setRdanNodes, setRdanEdges, setNodeUiState, onSpawned],
  );

  const closeNode = useCallback(
    async (nodeId: string) => {
      // Optimistic — flip status to "deleted" on the node + every
      // descendant immediately. Layout hook filters by status === "active"
      // so the canvas snaps shut. Reconciles against the server's
      // deletedNodeIds list when the request settles; on failure we
      // restore the snapshot so a 403 doesn't silently eat the user's
      // nodes.
      const rdanNodesSnapshot = rdanNodes;
      const rdanEdgesSnapshot = rdanEdges;

      const childrenOf = new Map<string, string[]>();
      for (const e of rdanEdges) {
        if (e.status !== "active") continue;
        const list = childrenOf.get(e.sourceNode) ?? [];
        list.push(e.targetNode);
        childrenOf.set(e.sourceNode, list);
      }
      const toRemove = new Set<string>();
      const queue: string[] = [nodeId];
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (toRemove.has(id)) continue;
        toRemove.add(id);
        for (const kid of childrenOf.get(id) ?? []) queue.push(kid);
      }

      setRdanNodes((curr) =>
        curr.map((n) =>
          toRemove.has(n.id) ? { ...n, status: "deleted" as const } : n,
        ),
      );
      setRdanEdges((curr) =>
        curr.map((e) =>
          toRemove.has(e.sourceNode) || toRemove.has(e.targetNode)
            ? { ...e, status: "deleted" as const }
            : e,
        ),
      );

      try {
        const res = await fetch(
          `/api/browse/sessions/${encodeURIComponent(sessionId)}/nodes/${encodeURIComponent(nodeId)}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as {
          deletedNodeIds?: string[];
          deletedEdgeIds?: string[];
        };
        // Single-step undo: a fresh hide replaces the buffer.
        setLastHide({
          nodeIds: Array.isArray(body.deletedNodeIds) ? body.deletedNodeIds : [...toRemove],
          edgeIds: Array.isArray(body.deletedEdgeIds) ? body.deletedEdgeIds : [],
          expiresAt: Date.now() + 30_000,
        });
      } catch (err) {
        console.error("close node failed", err);
        // Roll back the optimistic delete.
        setRdanNodes(rdanNodesSnapshot);
        setRdanEdges(rdanEdgesSnapshot);
      }
    },
    [sessionId, rdanNodes, rdanEdges, setRdanNodes, setRdanEdges, setLastHide],
  );

  return {
    postNode,
    addOptimisticRoot,
    addOptimisticPageChild,
    addOptimisticReloadChild,
    addOptimisticMediaChild,
    addOptimisticClip,
    closeNode,
  };
}
