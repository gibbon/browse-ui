"use client";

// Per-node actions for the browse canvas: refetch, change UA, change
// fetchMode, retry a failed extraction. These all share one underlying
// HTTP call (`postNode` for spawns lives elsewhere — this hook is just
// for actions on existing nodes).
//
// Returns command callbacks the canvas wires into PageNode's dropdowns
// + retry button via the wiredNodes useMemo.

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BrowseNode } from "@/lib/browse-types";
import type { FetchMode, NodeUiState } from "./use-node-ui-state";

interface UseBrowseNodeActionsArgs {
  sessionId: string;
  nodeUiState: Map<string, NodeUiState>;
  setNodeUiState: Dispatch<SetStateAction<Map<string, NodeUiState>>>;
  defaultUiFor: () => NodeUiState;
  setRdanNodes: Dispatch<SetStateAction<BrowseNode[]>>;
  /** Bumped after each refetch to nudge the polling hook to re-evaluate
   *  (a freshly-pending node should kick the poller back on). */
  bumpPollTick: () => void;
}

export function useBrowseNodeActions({
  sessionId,
  nodeUiState,
  setNodeUiState,
  defaultUiFor,
  setRdanNodes,
  bumpPollTick,
}: UseBrowseNodeActionsArgs) {
  // In-place refetch helper. Called from setUserAgent / setFetchMode so
  // a Reader-mode dropdown change immediately re-extracts with the new
  // params — Original mode self-handles via the iframe `src`. The
  // overrides are passed explicitly because setNodeUiState is async;
  // reading nodeUiState here would race against the updater that just
  // set the new value.
  const refetchNodeWith = useCallback(
    async (nodeId: string, overrides: { userAgent: string; useHeadless: boolean }) => {
      try {
        const res = await fetch(
          `/api/browse/sessions/${encodeURIComponent(sessionId)}/nodes/${encodeURIComponent(nodeId)}/refetch`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(overrides),
          },
        );
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`refetch failed (${res.status}): ${txt || res.statusText}`);
        }
        const refreshed = (await res.json()) as BrowseNode;
        setRdanNodes((curr) => curr.map((n) => (n.id === nodeId ? refreshed : n)));
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("rdan-browse-endpoints-refresh", {
              detail: { nodeId, useHeadless: overrides.useHeadless },
            }),
          );
        }
        bumpPollTick();
      } catch (err) {
        console.error("refetch failed", err);
      }
    },
    [sessionId, setRdanNodes, bumpPollTick],
  );

  const setUserAgent = useCallback(
    (nodeId: string, ua: string) => {
      const cur = nodeUiState.get(nodeId) ?? defaultUiFor();
      const updated = { ...cur, userAgent: ua };
      setNodeUiState((prev) => new Map(prev).set(nodeId, updated));
      // Reader-mode requires re-extraction; Original-mode iframe
      // refetches itself when its `&ua=` URL param changes.
      if (updated.viewMode === "reader") {
        void refetchNodeWith(nodeId, {
          userAgent: ua,
          useHeadless: updated.fetchMode === "headless",
        });
      }
    },
    [nodeUiState, defaultUiFor, refetchNodeWith, setNodeUiState],
  );

  const setFetchMode = useCallback(
    (nodeId: string, mode: FetchMode) => {
      const cur = nodeUiState.get(nodeId) ?? defaultUiFor();
      const updated = { ...cur, fetchMode: mode };
      setNodeUiState((prev) => new Map(prev).set(nodeId, updated));
      if (updated.viewMode === "reader") {
        void refetchNodeWith(nodeId, {
          userAgent: updated.userAgent,
          useHeadless: mode === "headless",
        });
      }
    },
    [nodeUiState, defaultUiFor, refetchNodeWith, setNodeUiState],
  );

  const onRetryNode = useCallback(
    (nodeId: string) => {
      // Failure-state CTA. Read whatever's currently selected on the
      // node's dropdowns and refetch once. The setUserAgent / setFetchMode
      // path already auto-refetches; this exists for the case where the
      // user hits "Try with Headless" or the generic ↻ retry button on
      // a failed extraction without changing any toggle.
      const ui = nodeUiState.get(nodeId) ?? defaultUiFor();
      void refetchNodeWith(nodeId, {
        userAgent: ui.userAgent,
        useHeadless: ui.fetchMode === "headless",
      });
    },
    [nodeUiState, defaultUiFor, refetchNodeWith],
  );

  return { refetchNodeWith, setUserAgent, setFetchMode, onRetryNode };
}
