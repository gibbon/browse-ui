"use client";

// Browse viewport persistence — applies the initial viewport on mount,
// debounces save-back to the kernel on pan/zoom/drag, and tracks which
// node ids have been user-dragged (so the save loop only persists those
// as overrides — not placeholder positions from the spawn pipeline).
//
// Extracted from canvas.tsx so the persistence concern lives in one
// place. canvas.tsx wires the returned `markUserDragged`, `setFocused`,
// `clearOverrides`, and `scheduleViewportSave` into ReactFlow's
// onNodeDragStop / handleNodeClick / handleResetLayout / handleNodesChange.

import { useCallback, useEffect, useRef } from "react";
import { useReactFlow, type Node } from "@xyflow/react";
import type { BrowseViewport } from "../../lib/browse-types";

const VIEWPORT_DEBOUNCE_MS = 250;

export function useViewportPersistence(
  sessionId: string,
  initialViewport: BrowseViewport | null,
  nodes: Node[],
) {
  const reactFlow = useReactFlow();
  const viewportAppliedRef = useRef(false);
  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedNodeIdRef = useRef<string | null>(null);
  // Only IDs the user has actually dragged this session count as
  // overrides. Do NOT seed from initialViewport — older versions of
  // the save loop persisted bogus placeholder positions, so existing
  // nodePositions on disk often contain side-by-side garbage that
  // would defeat the columnar layout if we treated them as user
  // intent. buildFlow reads initialViewport.nodePositions on FIRST
  // render so any legacy overrides still show up on load; they just
  // stop being written back unless the user drags.
  const userDraggedRef = useRef<Set<string>>(new Set());

  // Restore viewport on mount. Use a ref guard so we only call
  // setViewport once even if React StrictMode double-invokes.
  useEffect(() => {
    if (viewportAppliedRef.current) return;
    if (initialViewport) {
      reactFlow.setViewport({
        x: initialViewport.panX,
        y: initialViewport.panY,
        zoom: initialViewport.zoom,
      });
    }
    viewportAppliedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleViewportSave = useCallback(() => {
    if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
    viewportTimerRef.current = setTimeout(() => {
      try {
        const vp = reactFlow.getViewport();
        const nodePositions: Record<string, { x: number; y: number }> = {};
        for (const n of nodes) {
          if (!userDraggedRef.current.has(n.id)) continue;
          // Skip group MEMBER nodes: once a node is reparented into a
          // group frame (parentId set), xyflow reports its `position`
          // as frame-RELATIVE, but nodePositions overrides are consumed
          // as ABSOLUTE by computeColumnarLayout — persisting the
          // relative coords would corrupt the member's location on
          // reload (and poison computeFrameBounds). Per-member drag
          // persistence is a Task-8 concern (attach/detach); for now a
          // member's position is owned by the layout. Group FRAME nodes
          // (id `group:*`, no parentId) are genuinely absolute and DO
          // persist here so frame drags survive reload.
          if (n.parentId) continue;
          nodePositions[n.id] = { x: n.position.x, y: n.position.y };
        }
        const payload: BrowseViewport = {
          zoom: vp.zoom,
          panX: vp.x,
          panY: vp.y,
          focusedNodeId: focusedNodeIdRef.current,
          nodePositions,
        };
        void fetch(
          `/api/browse/sessions/${encodeURIComponent(sessionId)}/viewport`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        ).catch((err) => console.error("viewport save failed", err));
      } catch (err) {
        console.error("viewport save scheduling failed", err);
      }
    }, VIEWPORT_DEBOUNCE_MS);
  }, [reactFlow, nodes, sessionId]);

  // Cleanup any pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
    };
  }, []);

  const markUserDragged = useCallback(
    (id: string) => {
      userDraggedRef.current.add(id);
      scheduleViewportSave();
    },
    [scheduleViewportSave],
  );

  const setFocused = useCallback((id: string | null) => {
    focusedNodeIdRef.current = id;
  }, []);

  /** Read the currently-focused node id. Returns null if none set. */
  const getFocused = useCallback(() => focusedNodeIdRef.current, []);

  const clearOverrides = useCallback(() => {
    userDraggedRef.current.clear();
    scheduleViewportSave();
  }, [scheduleViewportSave]);

  return {
    markUserDragged,
    setFocused,
    getFocused,
    clearOverrides,
    scheduleViewportSave,
  };
}
