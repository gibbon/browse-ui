"use client";

// Background polling for the browse session. While any node is pending
// extraction, polls the session bundle every POLL_INTERVAL_MS and
// reconciles rdanNodes/rdanEdges with the server's latest state.
//
// Position computation is NOT done here — it lives in useBrowseLayout
// and gets re-derived automatically from rdanNodes/rdanEdges on every
// render. The poll only merges data, never decides where nodes go.

import { useEffect } from "react";
import type {
  BrowseNode,
  BrowseEdge,
  BrowseSession,
  BrowseGroup,
  BrowseGroupMember,
} from "../../lib/browse-types";

const POLL_INTERVAL_MS = 1500;

interface UseBrowsePollingArgs {
  sessionId: string;
  rdanNodes: BrowseNode[];
  rdanEdges: BrowseEdge[];
  setRdanNodes: React.Dispatch<React.SetStateAction<BrowseNode[]>>;
  setRdanEdges: React.Dispatch<React.SetStateAction<BrowseEdge[]>>;
  setRdanGroups: React.Dispatch<React.SetStateAction<BrowseGroup[]>>;
  setRdanGroupMembers: React.Dispatch<React.SetStateAction<BrowseGroupMember[]>>;
  /** External signal — bumped to force a re-evaluation when external
   *  events (e.g. retry) put a node back into pending. */
  pollTick: number;
}

export function useBrowsePolling({
  sessionId,
  rdanNodes,
  rdanEdges,
  setRdanNodes,
  setRdanEdges,
  setRdanGroups,
  setRdanGroupMembers,
  pollTick,
}: UseBrowsePollingArgs) {
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/browse/sessions/${encodeURIComponent(sessionId)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          session: BrowseSession;
          nodes: BrowseNode[];
          edges: BrowseEdge[];
          groups?: BrowseGroup[];
          groupMembers?: BrowseGroupMember[];
        };
        if (cancelled) return;

        // Merge: update existing nodes whose server version is newer
        // AND add nodes the server has that we don't (server-spawned
        // gallery + the edges to them — the kernel autospawns these
        // when browse-clean finishes; they have no client optimistic
        // counterpart so the poll is the only path they reach the
        // canvas).
        const serverById = new Map(data.nodes.map((n) => [n.id, n]));
        const localIds = new Set(rdanNodes.map((n) => n.id));
        // Server-side IDs that are STILL active. Anything in our local
        // mirror that's missing from this set has been tombstoned and
        // should disappear from the canvas.
        const activeServerIds = new Set(
          data.nodes.filter((n) => n.status === "active").map((n) => n.id),
        );
        setRdanNodes((curr) => {
          // Detect whether anything actually changed BEFORE allocating
          // a new array. Without this guard, .map() returns a new
          // reference even when every element is identity-equal, which
          // triggers an effect re-run → tick() → poll loop → all
          // downstream memos invalidate every 1.5s and the page node's
          // markdown re-renders ~10000 times in 3s.
          let droppedAny = false;
          let bumpedAny = false;
          for (const n of curr) {
            if (serverById.has(n.id) && !activeServerIds.has(n.id)) {
              droppedAny = true;
            } else {
              const fresh = serverById.get(n.id);
              if (fresh && fresh.version > n.version) bumpedAny = true;
            }
          }
          const added = data.nodes.filter(
            (n) => !localIds.has(n.id) && n.status === "active",
          );
          if (!droppedAny && !bumpedAny && added.length === 0) return curr;
          const updated = curr
            .filter((n) => activeServerIds.has(n.id) || !serverById.has(n.id))
            .map((n) => {
              const fresh = serverById.get(n.id);
              if (!fresh) return n;
              if (fresh.version > n.version) return fresh;
              return n;
            });
          return added.length > 0 ? [...updated, ...added] : updated;
        });

        // Edges: drop tombstoned, add new active ones the client doesn't
        // have yet (gallery edge from the auto-spawn path is the main
        // case). Without the drop step, edges would stay drawn after
        // their target node disappeared, leaving a dangling line.
        const activeServerEdgeIds = new Set(
          data.edges.filter((e) => e.status === "active").map((e) => e.id),
        );
        const serverEdgeIds = new Set(data.edges.map((e) => e.id));
        const localEdgeIds = new Set(rdanEdges.map((e) => e.id));
        const newEdges = data.edges.filter(
          (e) => !localEdgeIds.has(e.id) && e.status === "active",
        );
        const haveDeletions = rdanEdges.some(
          (e) => serverEdgeIds.has(e.id) && !activeServerEdgeIds.has(e.id),
        );
        if (haveDeletions || newEdges.length > 0) {
          setRdanEdges((curr) => {
            const filtered = curr.filter(
              (e) => activeServerEdgeIds.has(e.id) || !serverEdgeIds.has(e.id),
            );
            // Skip allocating a new array when nothing actually changed
            // (same guard as setRdanNodes above).
            if (filtered.length === curr.length && newEdges.length === 0) return curr;
            return newEdges.length > 0 ? [...filtered, ...newEdges] : filtered;
          });
        }

        // Reconcile groups + group members. Same signature-string guard
        // as nodes/edges above: only push a new array into state when the
        // incoming set differs by id/version/status (+ label/color for
        // groups). Without this guard the setter would allocate a fresh
        // array every 1.5s, re-running this effect → poll loop.
        const incomingGroups = data.groups ?? [];
        const incomingMembers = data.groupMembers ?? [];
        const groupSig = (arr: BrowseGroup[]) =>
          arr
            .map(
              (x) =>
                x.id + ":" + x.version + ":" + x.status + ":" + (x.label ?? "") + ":" + (x.color ?? ""),
            )
            .sort()
            .join("|");
        const memberSig = (arr: BrowseGroupMember[]) =>
          arr.map((x) => x.id + ":" + x.version + ":" + x.status).sort().join("|");
        setRdanGroups((curr) =>
          groupSig(curr) === groupSig(incomingGroups) ? curr : incomingGroups,
        );
        setRdanGroupMembers((curr) =>
          memberSig(curr) === memberSig(incomingMembers) ? curr : incomingMembers,
        );
      } catch (err) {
        console.error("poll failed", err);
      }
    };

    // Always do one immediate fetch on mount + on every pollTick bump.
    // This handles signals that don't put nodes into "pending"
    // extraction state — most notably the ✨ summarize chip, which
    // creates a NEW media-kind=summary child node on the server with
    // no pending status, so the user would otherwise never see it
    // until a full page reload.
    void tick();
    // Continue polling on an interval only when something is pending
    // (extraction in-flight). Without this gate, we'd hammer the
    // kernel forever even when nothing's changing.
    const hasPending = rdanNodes.some(
      (n) => n.extractionStatus === "pending" && n.status === "active",
    );
    const id = hasPending ? setInterval(tick, POLL_INTERVAL_MS) : null;
    return () => {
      cancelled = true;
      if (id !== null) clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rdanNodes, sessionId, pollTick]);
}
