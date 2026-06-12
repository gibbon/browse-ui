"use client";

// xyflow wrapper for the browse-canvas. Task 14 scaffolded the layout;
// Task 15 swapped default-typed nodes for the custom PageNode (full
// title/body/links UI) and computed the seen-before badge by visiting
// every active page in DFS order grouped by root: the first time a URL
// appears we tag its branch, and any later occurrence shows a "also at
// branch N" badge. Task 17 wires real click handlers — URL bar spawns
// a new root, link clicks spawn a child below the parent, media clicks
// insert a media child, retry triggers the kernel refetch. Optimistic
// inserts surface the pending node immediately.
//
// Task 18: a polling effect ticks every 1500ms while any node is
// extractionStatus === "pending" — fetches the session and replaces
// pending nodes' data with whatever the server now reports, preserving
// the local position so dragging during a poll-tick doesn't snap back.
// The retry handler nudges a pollTick state to make sure the effect is
// running even if pending nodes were added between renders.
//
// Task 19: viewport (pan/zoom + per-node positions) is restored on
// mount via useReactFlow().setViewport, and PATCHed to the kernel
// debounced 250ms after any pan/zoom/drag event. fitView is suppressed
// when a persisted viewport exists so it doesn't fight setViewport.
//
// Task 20: the seen-before computation moved to canvas-utils.ts so it
// can be unit-tested as a pure helper, and is recomputed on every
// render via the wiredNodes useMemo so optimistic inserts also pick
// up the badge correctly.

import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
  SelectionMode,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  BrowseSession,
  BrowseNode,
  BrowseEdge,
  BrowseViewport,
  BrowseMedia,
  BrowseGroup,
  BrowseGroupMember,
} from "../lib/browse-types";
import { PageNode, type PageNodeData } from "./page-node";
import { MediaNode } from "./media-node";
import { GalleryNode } from "./gallery-node";
import { GroupNode } from "./group-node";
import { toggle, hitTestGroup, membersByGroup } from "./group-utils";
import { classifyDragData, writeDragExtractData, type DragExtract } from "./drag-extract";
import { Button } from "../ui/button";
import { UrlBar } from "./url-bar";
import { computeSeenBefore, widthOf, heightOf } from "./canvas-utils";
import {
  computeColumnarLayout,
  PAGE_HEIGHT,
  type NodePlacement,
} from "./columnar-layout";
import { buildFlow } from "./build-flow";
import { useBrowseLayout } from "./hooks/use-browse-layout";
import { useViewportPersistence } from "./hooks/use-viewport-persistence";
import { useChatPanel } from "./hooks/use-chat-panel";
import { useBrowseTheme } from "./hooks/use-browse-theme";
import { PerfOverlay } from "./perf-overlay";
import { useCanvasPan } from "./hooks/use-canvas-pan";
import { useBrowsePolling } from "./hooks/use-browse-polling";
import { useSessionDefaults } from "./hooks/use-session-defaults";
import { useNodeUiState } from "./hooks/use-node-ui-state";
import { useDefaultViewMode } from "./hooks/use-default-view-mode";
import { useBrowseNodeActions } from "./hooks/use-browse-node-actions";
import { useBrowseSpawnActions } from "./hooks/use-browse-spawn-actions";
import { useBrowseTreeNav } from "./hooks/use-browse-tree-nav";
import { SectionNode } from "./section-node";
import { SummaryNode } from "./summary-node";
import { EndpointsNode } from "./endpoints-node";
import { EndpointDetailNode, type EndpointPlaygroundRequest } from "./endpoint-detail-node";
import { PlaygroundNode, type PlaygroundSuggestion } from "./playground-node";
import { GeneratedViewNode } from "./generated-view-node";
import { ClipNode } from "./clip-node";
import { ChatPanel, CLOSED_PANEL, type ChatPanelState } from "./chat-panel";
import {
  BrowseAssistantPanel,
  type ChatMessage as AssistantMessage,
  type BrowseChatAction,
} from "./browse-assistant-panel";
import { EndpointsPanel } from "./endpoints-panel";
import { buildCanvasPrefill } from "./chat-prefill";

interface CanvasProps {
  initialSession: BrowseSession;
  initialNodes: BrowseNode[];
  initialEdges: BrowseEdge[];
  initialViewport: BrowseViewport | null;
  initialGroups: BrowseGroup[];
  initialGroupMembers: BrowseGroupMember[];
}

// Default reading-width for a fresh page node + horizontal stride for
// child layout. Bumped from 480 → 700 (640 node + 60 gutter) when page
// nodes became resizable with a 640 default — children otherwise
// landed underneath the source node's right edge.
const NODE_WIDTH = 700;
const NODE_VERT = 240;

const nodeTypes = {
  page: PageNode,
  media: MediaNode,
  gallery: GalleryNode,
  section: SectionNode,
  summary: SummaryNode,
  endpoints: EndpointsNode,
  endpointDetail: EndpointDetailNode,
  playground: PlaygroundNode,
  generatedView: GeneratedViewNode,
  group: GroupNode,
  clip: ClipNode,
};

// buildFlow: rdan graph + placement → xyflow Node[]/Edge[]. Pure;
// moved out to build-flow.ts so the file size lives there. Handlers
// in node `data` are placeholders that wiredNodes (below) re-binds
// on every render.

// The CanvasInner / Canvas split exists because useReactFlow() must be
// called inside a ReactFlowProvider. The wrapper below mounts the
// provider so the inner component can use the hook.
function CanvasInner({
  initialSession,
  initialNodes,
  initialEdges,
  initialViewport,
  initialGroups,
  initialGroupMembers,
}: CanvasProps) {
  // Initial placement is derived from the immutable initialNodes /
  // initialEdges that arrived with the page bundle. The live placement
  // (driven by rdanNodes) is computed below via useBrowseLayout once
  // rdanNodes state exists.
  const initialPlacement = useMemo(
    () => computeColumnarLayout(
      initialNodes,
      initialEdges,
      new Map(Object.entries(initialViewport?.nodePositions ?? {})),
    ),
    [initialNodes, initialEdges, initialViewport],
  );
  const initial = useMemo(
    () => buildFlow(initialNodes, initialEdges, initialPlacement),
    [initialNodes, initialEdges, initialPlacement],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);

  // Track the original BrowseEdge[] (with kind/linkText) so the seen-before
  // pass and the polling reconciler don't have to invert the xyflow Edge
  // shape back into a BrowseEdge. Mirrors `nodes`/`edges` for parity.
  const [rdanEdges, setRdanEdges] = useState<BrowseEdge[]>(initialEdges);

  // Keep a parallel BrowseNode[] mirror of canvas state so seen-before
  // (which needs URL + status, not xyflow's Node shape) and the polling
  // reconciler have a clean source of truth.
  const [rdanNodes, setRdanNodes] = useState<BrowseNode[]>(initialNodes);

  // Group frames + their membership, seeded from the page bundle and
  // reconciled by the polling hook. collapsedGroups is client-only UI
  // state (no server row yet) tracking which frames are collapsed.
  const [rdanGroups, setRdanGroups] = useState<BrowseGroup[]>(initialGroups);
  const [rdanGroupMembers, setRdanGroupMembers] = useState<BrowseGroupMember[]>(
    initialGroupMembers,
  );
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  // Currently selected node ids (via xyflow onSelectionChange). Drives
  // the "Group selected" floating affordance.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Canvas assistant (dedicated chat that acts on the canvas) — distinct from
  // the general r.dan ChatPanel drawer.
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [endpointsOpen, setEndpointsOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantBusy, setAssistantBusy] = useState(false);

  // Drag-extract drop positions: nodeId → flow-space {x,y} where the user
  // released. Merged into the placement (via useBrowseLayout) so a dropped
  // pane lands at the cursor instead of its columnar slot, and survives
  // the next layout pass. Starts empty (stable ref until the first drop).
  const [dropOverrides, setDropOverrides] = useState<
    Map<string, { x: number; y: number }>
  >(() => new Map());

  // Live placement derived from the rdan mirror. Drives the single
  // derivation that feeds xyflow's setNodes/setEdges — every state
  // change rebuilds the flow shape from this one source. The result
  // is that NO other code path can return positions for browse nodes
  // (previously five different functions each had their own algorithm,
  // see commits 9765c3f4 / a552257a for the bug-hunt fallout).
  const livePlacement = useBrowseLayout(
    rdanNodes,
    rdanEdges,
    initialViewport,
    rdanGroups,
    rdanGroupMembers,
    dropOverrides,
  );

  const initialFetchMode = initialNodes.find((n) => n.kind === "page" && n.fetchMode)?.fetchMode ?? undefined;
  // Session-default fetchMode (static vs. headless) — applied to new
  // root spawns. Per-node toggles override. Persisted to localStorage.
  const [sessionDefaults, setSessionDefaults] = useSessionDefaults(initialSession.id, initialFetchMode ?? undefined);
  // User-level "how I like pages to open" preference (across all sessions),
  // default "rich". Seeds each new card's initial view mode.
  const [defaultViewMode, setDefaultViewMode] = useDefaultViewMode();

  // Per-node UI state (viewMode / userAgent / fetchMode) — persisted to
  // localStorage so toggles survive a reload. defaultUiFor / setViewMode
  // / setNodeUiState (raw setter for the other setters below) come from
  // the hook.
  const {
    state: nodeUiState,
    setState: setNodeUiState,
    defaultFor: defaultUiFor,
    setViewMode,
  } = useNodeUiState(initialSession.id, sessionDefaults.fetchMode, defaultViewMode);


  // Most-recent hide for the Undo affordance. Captured on every
  // successful close-X click and consumed by the floating Undo bar.
  // Replaced (not stacked) when a new hide happens — the current UX
  // is "undo my last action," not a multi-step stack.
  const [lastHide, setLastHide] = useState<{
    nodeIds: string[];
    edgeIds: string[];
    expiresAt: number;
  } | null>(null);

  // Polling tick — bumped to force the polling effect to re-evaluate
  // when retry transitions a node back to pending. The effect's
  // dependency on rdanNodes already covers normal cases, but a manual
  // nudge is cheap insurance.
  const [pollTick, setPollTick] = useState(0);

  const reactFlow = useReactFlow();
  // Viewport persistence: applies initial viewport on mount + debounces
  // save-back to kernel. Owns userDraggedRef, viewportTimerRef,
  // focusedNodeIdRef internally — canvas only sees the returned commands.
  const {
    markUserDragged,
    setFocused,
    getFocused,
    clearOverrides,
    scheduleViewportSave,
  } = useViewportPersistence(initialSession.id, initialViewport, nodes);

  // Tracks the most recently spawned node id so a derived useEffect can
  // pan the camera to its computed-by-useBrowseLayout position once the
  // rdan state batch flushes. The spawn handlers (via useBrowseSpawnActions'
  // onSpawned callback) set this; the effect clears it after panning so
  // a re-render doesn't re-pan.
  const pendingFocusIdRef = useRef<string | null>(null);
  const onSpawned = useCallback((id: string) => {
    pendingFocusIdRef.current = id;
  }, []);

  // Drag-extract source: PageNode's reader body dispatches a
  // "rdan-drag-source" window event on dragstart with the originating
  // node id + url; we stash it here so the canvas drop handler can link
  // the new pane back to its source. Cleared on drop.
  const dragSourceRef = useRef<{
    sourceNodeId: string | undefined;
    sourceUrl: string;
  } | null>(null);
  const iframeDragPayloadRef = useRef<DragExtract | null>(null);

  useEffect(() => {
    const focusId = pendingFocusIdRef.current;
    if (!focusId) return;
    const placement = livePlacement.get(focusId);
    if (!placement) return; // Layout hasn't caught up yet — try next render.

    // Frame the new node + EVERY direct child (meta column tiles
    // attached to it) so the user sees not just the page but its
    // summary / gallery / sections too — without them, a freshly
    // spawned page lands centered but the meta column sticks off
    // the right edge of the viewport.
    let minX = placement.x;
    let minY = placement.y;
    let maxX = placement.x + placement.width;
    let maxY = placement.y + placement.height;
    for (const e of rdanEdges) {
      if (e.status !== "active") continue;
      if (e.sourceNode !== focusId) continue;
      const childP = livePlacement.get(e.targetNode);
      if (!childP) continue;
      minX = Math.min(minX, childP.x);
      minY = Math.min(minY, childP.y);
      maxX = Math.max(maxX, childP.x + childP.width);
      maxY = Math.max(maxY, childP.y + childP.height);
    }
    // Padding so tiles don't touch viewport edges.
    const PAD = 80;
    void reactFlow.fitBounds(
      {
        x: minX - PAD,
        y: minY - PAD,
        width: maxX - minX + PAD * 2,
        height: maxY - minY + PAD * 2,
      },
      { duration: 350 },
    );
    pendingFocusIdRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePlacement, rdanEdges, reactFlow]);

  /** Center the viewport on a node id with a small zoom-in. */
  const focusNode = useCallback(
    (nodeId: string) => {
      const live = reactFlow.getNodes();
      const n = live.find((x) => x.id === nodeId);
      if (!n) return;
      const measured = (n as { measured?: { width?: number; height?: number } })
        .measured;
      const w = measured?.width ?? (n as { width?: number }).width ?? NODE_WIDTH;
      const h = measured?.height ?? (n as { height?: number }).height ?? NODE_VERT;
      reactFlow.setCenter(
        n.position.x + w / 2,
        n.position.y + h / 2,
        { duration: 350, zoom: reactFlow.getZoom() },
      );
    },
    [reactFlow],
  );


  // Per-node actions (refetch, change UA, change fetchMode, retry) —
  // owned by useBrowseNodeActions.
  const { refetchNodeWith, setUserAgent, setFetchMode, onRetryNode } =
    useBrowseNodeActions({
      sessionId: initialSession.id,
      nodeUiState,
      setNodeUiState,
      defaultUiFor,
      setRdanNodes,
      bumpPollTick: useCallback(() => setPollTick((t) => t + 1), []),
    });

  // Spawn + close commands — owned by useBrowseSpawnActions. All four
  // optimistic-spawn handlers + closeNode + the postNode HTTP helper
  // live in the hook; they all share rdan-state setters + nodeUiState
  // + sessionDefaults. onSpawned is the seam back into canvas-local
  // pendingFocusIdRef so the camera pan still works.
  const {
    postNode,
    addOptimisticRoot,
    addOptimisticPageChild,
    addOptimisticMediaChild,
    addOptimisticClip,
    closeNode,
  } = useBrowseSpawnActions({
    sessionId: initialSession.id,
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
  });

  const openEndpointDetail = useCallback(
    async (input: { sourceNodeId: string; parentNodeId: string; signatureId: string }) => {
      try {
        const res = await fetch(
          `/api/browse/sessions/${encodeURIComponent(initialSession.id)}/endpoints/detail`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
        );
        const data = await res.json() as {
          node?: BrowseNode;
          edge?: BrowseEdge;
          error?: unknown;
        };
        if (!res.ok || !data.node || !data.edge) {
          throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
        }
        setRdanNodes((curr) => curr.some((n) => n.id === data.node!.id) ? curr : [...curr, data.node!]);
        setRdanEdges((curr) => curr.some((e) => e.id === data.edge!.id) ? curr : [...curr, data.edge!]);
        onSpawned(data.node.id);
      } catch (err) {
        console.error("open endpoint detail failed", err);
      }
    },
    [initialSession.id, setRdanNodes, setRdanEdges, onSpawned],
  );

  const appendReturnedPane = useCallback(
    (node: BrowseNode | undefined, edge: BrowseEdge | undefined) => {
      if (!node || !edge) return;
      setRdanNodes((curr) => curr.some((n) => n.id === node.id) ? curr : [...curr, node]);
      setRdanEdges((curr) => curr.some((e) => e.id === edge.id) ? curr : [...curr, edge]);
      onSpawned(node.id);
    },
    [setRdanNodes, setRdanEdges, onSpawned],
  );

  const runEndpointPlayground = useCallback(
    async (request: EndpointPlaygroundRequest) => {
      const res = await fetch(
        `/api/browse/sessions/${encodeURIComponent(initialSession.id)}/endpoints/playground`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      const data = await res.json() as {
        node?: BrowseNode;
        edge?: BrowseEdge;
        error?: unknown;
      };
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
      }
      appendReturnedPane(data.node, data.edge);
    },
    [initialSession.id, appendReturnedPane],
  );

  const suggestEndpointPlayground = useCallback(
    async (input: { parentNodeId: string; signatureId: string; sourceNodeId: string }) => {
      const res = await fetch(
        `/api/browse/sessions/${encodeURIComponent(initialSession.id)}/endpoints/playground/suggest`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const data = await res.json() as {
        node?: BrowseNode;
        edge?: BrowseEdge;
        error?: unknown;
      };
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
      }
      appendReturnedPane(data.node, data.edge);
    },
    [initialSession.id, appendReturnedPane],
  );

  const runPlaygroundSuggestion = useCallback(
    async (suggestion: PlaygroundSuggestion, sourceNodeId: string) => {
      await runEndpointPlayground({
        method: suggestion.method,
        url: suggestion.url,
        headers: suggestion.headers ?? {},
        body: suggestion.body ?? null,
        credentialMode: "browser-context",
        sourceNodeId,
      });
    },
    [runEndpointPlayground],
  );

  const generateViewFromPlayground = useCallback(
    async (sourceNodeId: string) => {
      const res = await fetch(
        `/api/browse/sessions/${encodeURIComponent(initialSession.id)}/generated-views`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceNodeId }),
        },
      );
      const data = await res.json() as {
        node?: BrowseNode;
        edge?: BrowseEdge;
        error?: unknown;
      };
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
      }
      appendReturnedPane(data.node, data.edge);
    },
    [initialSession.id, appendReturnedPane],
  );

  // Background polling — owned by useBrowsePolling. While any node is
  // pending extraction, polls the session bundle and reconciles
  // rdanNodes/rdanEdges with the server. Position is auto-derived by
  // useBrowseLayout on the next render; the polling hook never touches
  // xyflow state.
  useBrowsePolling({
    sessionId: initialSession.id,
    rdanNodes,
    rdanEdges,
    setRdanNodes,
    setRdanEdges,
    setRdanGroups,
    setRdanGroupMembers,
    pollTick,
  });

  // Galleries (and other auto-spawned siblings) follow the parent's
  // right edge by default. Once the user drags one manually, it sticks
  // wherever they put it. Tracked here, not in node data, so the snap
  // logic doesn't accidentally clobber a user-placed gallery during a
  // poll-driven re-render.
  const manuallyMovedRef = useRef<Set<string>>(new Set());
  // Captures NodeResizer drag-end dimensions so a refresh / poll-driven
  // rebuild doesn't snap the user's resized tile back to its seed size.
  // Client-only (not persisted to the kernel viewport row yet) — a full
  // page reload resets, but per-node refresh + extraction polling do
  // not. xyflow emits `{type: "dimensions", id, dimensions: {width,
  // height}, resizing}` during the drag; we only commit when `resizing`
  // is false (drag-end) so transient mid-drag sizes don't get pinned.
  const [userSizes, setUserSizes] = useState<Map<string, { width: number; height: number }>>(
    () => new Map(),
  );

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      // Mark any node the user actually drags as manually-placed.
      // xyflow sends `position` changes for both drags and programmatic
      // moves; the `dragging` flag is true only during real user input.
      for (const c of changes) {
        if (c.type === "position" && c.dragging === true) {
          manuallyMovedRef.current.add(c.id);
        }
      }
      // Capture user-resized dimensions on drag-end (resizing=false).
      // The same change type also fires on layout-driven dimension
      // updates — those have no `resizing` field so they skip.
      const sizeCommits: Array<[string, { width: number; height: number }]> = [];
      for (const c of changes) {
        if (c.type === "dimensions" && c.resizing === false && c.dimensions) {
          sizeCommits.push([c.id, { width: c.dimensions.width, height: c.dimensions.height }]);
        }
      }
      if (sizeCommits.length > 0) {
        setUserSizes((prev) => {
          const next = new Map(prev);
          for (const [id, dim] of sizeCommits) next.set(id, dim);
          return next;
        });
      }
      // Schedule a viewport save on any position change. Type/select
      // changes also fire here but the debounce coalesces them, so the
      // extra noise is harmless. (The dimension-snap nudge that used to
      // live here is gone — galleries + media + page kids all get their
      // positions from useBrowseLayout, which re-derives on every
      // rdan/placement change. No snap needed.)
      const hasPositionChange = changes.some(
        (c) => c.type === "position",
      );
      if (hasPositionChange) scheduleViewportSave();
    },
    [onNodesChange, scheduleViewportSave],
  );

  // Pan-and-focus helper used by click + history-restore. Centers the
  // viewport on the node and marks it focused (which the tree-nav
  // back/forward buttons + viewport persistence both read).
  const focusAndCenter = useCallback(
    (nodeId: string) => {
      setFocused(nodeId);
      const live = reactFlow.getNodes().find((n) => n.id === nodeId);
      if (live) {
        const w = (live.width as number | undefined) ?? 800;
        const h = (live.height as number | undefined) ?? 800;
        reactFlow.setCenter(
          live.position.x + w / 2,
          live.position.y + h / 2,
          { duration: 350, zoom: reactFlow.getZoom() },
        );
      }
      scheduleViewportSave();
    },
    [setFocused, reactFlow, scheduleViewportSave],
  );

  const handleNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      setFocused(node.id);
      scheduleViewportSave();
      // Push a history entry so browser back/forward navigates
      // between focused panes. URL hash becomes #<nodeId> for
      // shareability — copy the URL and the recipient lands on
      // the same pane.
      if (typeof window !== "undefined") {
        const url = `${window.location.pathname}${window.location.search}#${encodeURIComponent(node.id)}`;
        // Only push if changed — avoids growing history on repeat-clicks.
        if (window.location.hash !== `#${node.id}`) {
          window.history.pushState({ browseFocus: node.id }, "", url);
        }
      }
    },
    [setFocused, scheduleViewportSave],
  );

  // Hold the latest focusAndCenter in a ref so the hash-restore effect
  // below can run mount-ONLY without listing it as a dependency.
  // focusAndCenter changes identity on every `nodes` change (via
  // scheduleViewportSave); if the effect depended on it, every link
  // click (which spawns a node → nodes change) re-ran restoreFromHash
  // and yanked the camera back to whatever pane was in the URL hash —
  // the "keeps zooming back to the first frame" bug.
  const focusAndCenterRef = useRef(focusAndCenter);
  focusAndCenterRef.current = focusAndCenter;

  // Browser back/forward → restore focused pane. Reads the hash on
  // popstate, finds the node, centers on it. On initial mount, if
  // the URL has a #nodeId, focus that pane. Runs ONCE (mount) + on
  // popstate — NOT on every node/layout change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const restoreFromHash = () => {
      const raw = window.location.hash.replace(/^#/, "");
      if (!raw) return;
      const nodeId = decodeURIComponent(raw);
      // Defer so the layout has measured the node before we center.
      requestAnimationFrame(() => focusAndCenterRef.current(nodeId));
    };
    restoreFromHash();
    window.addEventListener("popstate", restoreFromHash);
    return () => window.removeEventListener("popstate", restoreFromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Side-panel state for the → Chat surface. Owned by useChatPanel —
  // see hooks/use-chat-panel.ts.
  const {
    state: chatPanel,
    open: openChatPanel,
    close: closeChatPanel,
    togglePin: toggleChatPanelPin,
  } = useChatPanel();

  // Tree-nav helpers: back = parent of focused, forward = most-recent
  // descendant. Re-derived from rdanNodes/rdanEdges on each invocation so
  // they always reflect the current canvas state.
  const { handleTreeBack, handleTreeForward, canBack, canForward } =
    useBrowseTreeNav({
      rdanNodes,
      rdanEdges,
      getFocused,
      setFocused,
      focusNode,
    });

  // Clear all drag overrides — POSTs an empty nodePositions map to the
  // server. The xyflow node positions get re-derived automatically by
  // the derived-flow useEffect on the next render (livePlacement
  // recomputes with no overrides → setNodes refreshes everything).
  const handleResetLayout = useCallback(async () => {
    // Wipe the "user dragged" set + re-trigger a save with empty
    // nodePositions. clearOverrides() schedules the save itself.
    clearOverrides();

    const vp = reactFlow.getViewport();
    try {
      await fetch(
        `/api/browse/sessions/${encodeURIComponent(initialSession.id)}/viewport`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            zoom: vp.zoom,
            panX: vp.x,
            panY: vp.y,
            focusedNodeId: getFocused(),
            nodePositions: {},
          } as BrowseViewport),
        },
      );
    } catch (err) {
      console.error("reset layout failed", err);
    }
  }, [reactFlow, initialSession.id, clearOverrides, getFocused]);

  // Ctrl+drag pan — owned by useCanvasPan, see hooks/use-canvas-pan.ts.
  // Works even when the cursor is over an iframe inside a page node
  // (which xyflow's default panOnDrag can't handle).
  const handleCanvasMouseDown = useCanvasPan();

  // Derive xyflow's node + edge state from (rdanNodes, rdanEdges,
  // livePlacement). This effect IS the single positioner: it runs on
  // every state change, calls buildFlow with the placement from
  // useBrowseLayout, and pushes the result into useNodesState/
  // useEdgesState. Spawn handlers no longer call setNodes/setEdges
  // — they only update the rdan mirror, and this effect re-derives
  // the flow shape on the next render.
  //
  // Drag interaction is preserved because user drags update xyflow's
  // internal store via onNodesChange. The drag-completed handler
  // (markUserDragged + scheduleViewportSave) eventually persists the
  // new position to viewport.nodePositions, which makes its way into
  // livePlacement on the next round-trip; until then, the rebuilt
  // setNodes call writes the same position the drag just landed at
  // (because livePlacement still reflects the placement-before-drag).
  // The user-drag-Set ref keeps the persisted override locked to
  // user-positioned nodes only.
  useEffect(() => {
    const built = buildFlow(
      rdanNodes,
      rdanEdges,
      livePlacement,
      userSizes,
      rdanGroups,
      rdanGroupMembers,
      collapsedGroups,
    );
    setNodes(built.nodes);
    setEdges(built.edges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rdanNodes, rdanEdges, livePlacement, rdanGroups, rdanGroupMembers, collapsedGroups]);

  // Re-wire every page node's click handlers to the live helpers, AND
  // re-compute the seen-before badge from current canvas state. Doing
  // this in one useMemo means optimistic inserts immediately get the
  // correct badge without waiting for a re-fetch.
  // Build the COMPLETE `data` object for each node id, indexed by id.
  // Recomputed only when rdan graph or handler bindings change — NOT
  // on every drag frame. The merge below uses these objects directly
  // (no spread), so the resulting node.data REFERENCE is stable across
  // drag frames. This is what lets React.memo on PageNode/MediaNode/
  // etc. actually bail out during a drag — previously the merge
  // `{...n.data, ...ov}` created a new object per frame, defeating
  // memoization even when ov was stable. ~10x INP improvement on
  // page-title pointer interactions.
  const dataByNodeId = useMemo(() => {
    const seenMap = computeSeenBefore(rdanNodes, rdanEdges);
    const parentOf = new Map<string, string>();
    const pageDescendantsOf = new Map<string, string[]>();
    const isPage = new Set(rdanNodes.filter((x) => x.kind === "page" && x.status === "active").map((x) => x.id));
    for (const e of rdanEdges) {
      if (e.status !== "active") continue;
      parentOf.set(e.targetNode, e.sourceNode);
      if (isPage.has(e.targetNode)) {
        const list = pageDescendantsOf.get(e.sourceNode) ?? [];
        list.push(e.targetNode);
        pageDescendantsOf.set(e.sourceNode, list);
      }
    }
    const createdAt = new Map(rdanNodes.map((n) => [n.id, n.createdAt] as const));
    const mostRecentPageDescendant = (id: string): string | null => {
      const kids = pageDescendantsOf.get(id);
      if (!kids || kids.length === 0) return null;
      let best = kids[0];
      let bestT = createdAt.get(best) ?? "";
      for (const k of kids) {
        const t = createdAt.get(k) ?? "";
        if (t > bestT) { best = k; bestT = t; }
      }
      return best;
    };
    // Build complete data per node id (not just an override patch).
    // Non-page nodes' base structural data still comes from buildFlow,
    // so we leave them as patch-style overrides; only page nodes get
    // the full-data treatment because they're the heavy renderers.
    const fullPageData = new Map<string, PageNodeData>();
    const nonPagePatch = new Map<string, {
      onClose: () => void;
      onOpenChat: typeof openChatPanel;
      onOpenDetail?: (signatureId: string) => void;
      onRunPlayground?: (request: EndpointPlaygroundRequest) => Promise<void>;
      onSuggestPlayground?: (input: { parentNodeId: string; signatureId: string; sourceNodeId: string }) => Promise<void>;
      onApplySuggestion?: (suggestion: PlaygroundSuggestion, sourceNodeId: string) => Promise<void>;
      onGenerateView?: (sourceNodeId: string) => Promise<void>;
    }>();
    for (const rn of rdanNodes) {
      if (rn.status !== "active") continue;
      const onClose = () => closeNode(rn.id);
      if (rn.kind !== "page") {
        nonPagePatch.set(rn.id, {
          onClose,
          onOpenChat: openChatPanel,
          onOpenDetail: rn.mediaKind === "endpoints"
            ? (signatureId: string) => {
                const parentId = parentOf.get(rn.id);
                if (!parentId) return;
                void openEndpointDetail({
                  sourceNodeId: rn.id,
                  parentNodeId: parentId,
                  signatureId,
                });
              }
            : undefined,
          onRunPlayground: rn.mediaKind === "endpoint-detail"
            ? runEndpointPlayground
            : undefined,
          onSuggestPlayground: rn.mediaKind === "endpoint-detail"
            ? suggestEndpointPlayground
            : undefined,
          onApplySuggestion: rn.mediaKind === "playground-suggestions"
            ? runPlaygroundSuggestion
            : undefined,
          onGenerateView: rn.mediaKind === "playground-result"
            ? generateViewFromPlayground
            : undefined,
        });
        continue;
      }
      const sb = seenMap.get(rn.id);
      const parentId = parentOf.get(rn.id);
      const fwdId = mostRecentPageDescendant(rn.id);
      const stored = nodeUiState.get(rn.id);
      const md = (rn.contentMarkdown ?? "").trim();
      const isEmptyExtraction = rn.extractionStatus === "ok" && md.length < 200;
      // Evicted pages must not default to the proxy 'original' iframe —
      // the content is gone; the evicted state in PageNode will show the
      // "Content expired / Reload" panel instead. Non-evicted pages use
      // the normal isEmptyExtraction heuristic.
      // Evicted → reader (content gone). Empty extraction → original (no
      // markdown to render). Otherwise honour the user's default view mode.
      const initialViewMode = rn.contentEvicted
        ? "reader"
        : (isEmptyExtraction ? "original" : defaultViewMode);
      const ui = stored ?? {
        viewMode: initialViewMode as "reader" | "rich" | "original",
        userAgent: "default",
        fetchMode: rn.fetchMode ?? sessionDefaults.fetchMode,
      };
      fullPageData.set(rn.id, {
        title: rn.title,
        byline: rn.byline,
        url: rn.url,
        contentMarkdown: rn.contentMarkdown,
        links: rn.links ?? [],
        media: rn.media ?? [],
        extractionStatus: rn.extractionStatus,
        extractionError: rn.extractionError,
        contentEvicted: rn.contentEvicted ?? false,
        seenBefore: sb?.seenBefore ?? false,
        seenBeforeBranch: sb?.seenBeforeBranch ?? null,
        onClickLink: (href: string, text: string) =>
          addOptimisticPageChild(rn.id, href, text),
        onClickMedia: (m: BrowseMedia) => addOptimisticMediaChild(rn.id, m),
        onRetry: () => onRetryNode(rn.id),
        onClose,
        onReload: () => onRetryNode(rn.id),
        onBack: () => parentId && focusNode(parentId),
        onForward: () => fwdId && focusNode(fwdId),
        hasBack: Boolean(parentId),
        hasForward: Boolean(fwdId),
        viewMode: ui.viewMode,
        onSetViewMode: (m: "reader" | "rich" | "original") => setViewMode(rn.id, m),
        userAgent: ui.userAgent,
        onSetUserAgent: (ua: string) => setUserAgent(rn.id, ua),
        fetchMode: ui.fetchMode,
        onSetFetchMode: (m: "static" | "headless") => setFetchMode(rn.id, m),
        sessionId: initialSession.id,
        sections: rn.sections,
        nodeId: rn.id,
        rdanNode: rn,
        onOpenChat: openChatPanel,
      });
    }
    return { fullPageData, nonPagePatch };
  }, [
    rdanNodes,
    rdanEdges,
    addOptimisticPageChild,
    addOptimisticMediaChild,
    openEndpointDetail,
    runEndpointPlayground,
    suggestEndpointPlayground,
    runPlaygroundSuggestion,
    generateViewFromPlayground,
    focusNode,
    onRetryNode,
    closeNode,
    nodeUiState,
    setViewMode,
    setUserAgent,
    setFetchMode,
    initialSession.id,
    openChatPanel,
    sessionDefaults.fetchMode,
    defaultViewMode,
  ]);

  // PATCH a group row (rename / recolor) then nudge a refetch so the
  // poll picks up the new label/color and reconciles it into rdanGroups.
  const patchGroup = useCallback(
    async (groupId: string, body: Record<string, unknown>) => {
      await fetch(
        "/api/browse/sessions/" +
          encodeURIComponent(initialSession.id) +
          "/groups/" +
          encodeURIComponent(groupId),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      window.dispatchEvent(new CustomEvent("rdan-browse-refetch"));
    },
    [initialSession.id],
  );

  // Set of node ids that are an active member of some group, so the
  // "Group selected" affordance can exclude already-grouped nodes.
  const memberNodeIds = useMemo(() => {
    const set = new Set<string>();
    for (const list of membersByGroup(rdanGroupMembers).values()) {
      for (const id of list) set.add(id);
    }
    return set;
  }, [rdanGroupMembers]);

  // Selected node ids that are eligible to form a NEW group: not a
  // group frame node, and not already an active member of a group.
  const groupableIds = useMemo(
    () =>
      selectedIds.filter(
        (id) => !id.startsWith("group:") && !memberNodeIds.has(id),
      ),
    [selectedIds, memberNodeIds],
  );

  // Create a group from the current groupable selection, then nudge a
  // refetch so the new frame + membership reconcile into canvas state.
  const groupSelected = useCallback(async () => {
    if (groupableIds.length < 2) return;
    try {
      await fetch(
        "/api/browse/sessions/" +
          encodeURIComponent(initialSession.id) +
          "/groups",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeIds: groupableIds }),
        },
      );
      window.dispatchEvent(new CustomEvent("rdan-browse-refetch"));
      setSelectedIds([]);
    } catch (err) {
      console.error("group-from-selection failed", err);
    }
  }, [groupableIds, initialSession.id]);

  // Selection → selectedIds. MUST be a stable useCallback AND no-op when
  // the id set is unchanged: xyflow re-subscribes onSelectionChange when
  // the handler identity changes, so an inline arrow + unconditional
  // setState recreates the handler every render → xyflow re-fires →
  // setState → re-render → "Maximum update depth exceeded" infinite loop
  // (caught only at runtime — invisible to unit tests / typecheck).
  const handleSelectionChange = useCallback(
    ({ nodes: selNodes }: { nodes: Node[] }) => {
      const ids = selNodes.map((n) => n.id);
      setSelectedIds((prev) =>
        prev.length === ids.length && prev.every((v, i) => v === ids[i])
          ? prev
          : ids,
      );
    },
    [],
  );

  // Map active node id → its current groupId (or undefined). Used by
  // the drag attach/detach handler to decide membership transitions.
  const groupOfNode = useMemo(() => {
    const map = new Map<string, string>();
    for (const [groupId, list] of membersByGroup(rdanGroupMembers)) {
      for (const id of list) map.set(id, groupId);
    }
    return map;
  }, [rdanGroupMembers]);

  // Drag attach/detach: on drag-stop of a non-group node, hit-test its
  // absolute center against live frame rects. If it landed in a
  // different group than its current one, detach from the old (if any)
  // and attach to the new (if any). Single-group membership — the
  // detach precedes the attach. Failures log but don't throw out of
  // the drag handler.
  const attachDetachOnDragStop = useCallback(
    async (node: Node) => {
      if (node.type === "group") return;
      const internal = reactFlow.getInternalNode(node.id);
      const abs = internal?.internals.positionAbsolute ?? node.position;
      const w = (node.width as number) ?? 0;
      const h = (node.height as number) ?? 0;
      const center = { x: abs.x + w / 2, y: abs.y + h / 2 };

      const frameRects = reactFlow
        .getNodes()
        .filter((n) => n.type === "group")
        .map((n) => ({
          groupId: n.id.slice("group:".length),
          x: n.position.x,
          y: n.position.y,
          width: (n.width as number) ?? 0,
          height: (n.height as number) ?? 0,
        }));

      const hit = hitTestGroup(center, frameRects);
      const currentGroup = groupOfNode.get(node.id) ?? null;
      if (hit === currentGroup) return; // no membership change

      try {
        if (currentGroup) {
          await fetch(
            "/api/browse/sessions/" +
              encodeURIComponent(initialSession.id) +
              "/groups/" +
              encodeURIComponent(currentGroup) +
              "/members",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ remove: [node.id] }),
            },
          );
        }
        if (hit) {
          await fetch(
            "/api/browse/sessions/" +
              encodeURIComponent(initialSession.id) +
              "/groups/" +
              encodeURIComponent(hit) +
              "/members",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ add: [node.id] }),
            },
          );
        }
        window.dispatchEvent(new CustomEvent("rdan-browse-refetch"));
      } catch (err) {
        console.error("drag attach/detach failed", err);
      }
    },
    [reactFlow, groupOfNode, initialSession.id],
  );

  // Final merge: combine xyflow's position-bearing node objects with
  // the precomputed stable data. For page nodes, data is REPLACED
  // (stable ref → React.memo bails out on drag). For others, we still
  // spread the patch onto the buildFlow-built data; the patch itself
  // is stable per render so the merged data ref only changes when
  // the patch identity does (rare).
  const wiredNodes = useMemo(
    () =>
      nodes.map((n) => {
        if (n.type === "group") {
          const groupId = n.id.slice("group:".length);
          return {
            ...n,
            data: {
              ...n.data,
              onRename: (label: string) => patchGroup(groupId, { label }),
              onToggleCollapse: () =>
                setCollapsedGroups((s) => toggle(s, groupId)),
            },
          };
        }
        const pageData = dataByNodeId.fullPageData.get(n.id);
        if (pageData) return { ...n, data: pageData };
        const patch = dataByNodeId.nonPagePatch.get(n.id);
        if (patch) return { ...n, data: { ...n.data, ...patch } };
        return n;
      }),
    [nodes, dataByNodeId, patchGroup],
  );

  // Aggregate cache footprint across active nodes — surfaces in the
  // URL bar header so the user can see how much they've accumulated
  // and decide when to close stale branches. Counts the JSON blobs
  // + markdown body, which is what actually grows; node-row overhead
  // is small and per-row the same.
  const cacheStats = useMemo(() => {
    let bytes = 0;
    let count = 0;
    for (const n of rdanNodes) {
      if (n.status !== "active") continue;
      count++;
      if (n.contentMarkdown) bytes += n.contentMarkdown.length;
      // links/media are deserialised on the BrowseNode shape, so reflect
      // their JSON size instead of in-memory object size for fairness
      // with the storage column lengths.
      if (n.links?.length) bytes += JSON.stringify(n.links).length;
      if (n.media?.length) bytes += JSON.stringify(n.media).length;
    }
    return { bytes, count };
  }, [rdanNodes]);

  // Listen for postMessage from any proxied iframe — the kernel
  // injects a capture script that fires on every link click + form
  // submit + history.pushState inside the iframe and posts back here
  // with the originating nodeId so we can spawn the right child.
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data as
        | {
            type?: string;
            nodeId?: string;
            href?: string;
            text?: string;
            payload?: DragExtract;
          }
        | null;
      if (!data || (data.type !== "rdan-link-click" && data.type !== "rdan-drag-start")) return;
      if (data.type === "rdan-drag-start") {
        if (!data.nodeId || !data.payload) return;
        const node = rdanNodes.find((x) => x.id === data.nodeId);
        if (!node || node.status !== "active") return;
        dragSourceRef.current = {
          sourceNodeId: data.nodeId,
          sourceUrl: node.url,
        };
        iframeDragPayloadRef.current = data.payload;
        return;
      }
      if (!data.nodeId || !data.href) return;
      // Sanity-check the source nodeId is one we know about — drops
      // stale messages from iframes that have since been closed.
      if (!nodes.some((x) => x.id === data.nodeId)) return;
      addOptimisticPageChild(data.nodeId, data.href, data.text ?? "");
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [nodes, rdanNodes, addOptimisticPageChild]);

  // Listen for "rdan-browse-refetch" events dispatched by SummaryChip
  // (and any other surface that mutates server state without going
  // through our spawn handlers). Bumps pollTick → useBrowsePolling
  // re-runs its effect → one immediate fetch picks up the new
  // server-side node/edge rows.
  useEffect(() => {
    const handler = () => setPollTick((t) => t + 1);
    window.addEventListener("rdan-browse-refetch", handler);
    return () => window.removeEventListener("rdan-browse-refetch", handler);
  }, []);

  // Drag-extract source capture: on dragstart anywhere in the canvas,
  // resolve the originating node from the DOM — every xyflow node wrapper
  // carries `data-id`. This makes extract work from ANY node body (page
  // reader, clip, summary, section, media image) without per-component
  // wiring. Capture-phase on the flow wrapper so it fires before the
  // browser starts the native drag. The ref is read by the drop handler
  // and cleared after the drop settles.
  const handleDragSourceCapture = useCallback(
    (e: React.DragEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(
        ".react-flow__node",
      );
      const id = el?.getAttribute("data-id");
      if (!id) return;
      const node = rdanNodes.find((n) => n.id === id);
      dragSourceRef.current = { sourceNodeId: id, sourceUrl: node?.url ?? "" };
      iframeDragPayloadRef.current = null;
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = "copy";

      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (anchor?.href) {
        writeDragExtractData(e.dataTransfer, { kind: "link", href: anchor.href });
        return;
      }

      const img = target?.closest?.("img[src]") as HTMLImageElement | null;
      const src = img?.currentSrc || img?.src;
      if (src) {
        writeDragExtractData(e.dataTransfer, { kind: "image", src });
        return;
      }

      const selection = window.getSelection()?.toString().trim();
      if (selection) {
        writeDragExtractData(e.dataTransfer, { kind: "text", text: selection });
      }
    },
    [rdanNodes],
  );

  // Drop a dragged selection / image / link onto the canvas → spawn the
  // matching pane LINKED to its source. The drop POINT is used for group
  // hit-testing regardless of where the pane finally lands.
  const extractFromDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const data = classifyDragData(e.dataTransfer) ?? iframeDragPayloadRef.current;
      if (!data) {
        dragSourceRef.current = null;
        iframeDragPayloadRef.current = null;
        return;
      }

      const src = dragSourceRef.current;
      const sourceId = src?.sourceNodeId ?? getFocused();
      const sourceUrl = src?.sourceUrl ?? "";
      if (!sourceId) {
        // No source node (drag came from outside a reader body and no
        // node is focused) — nothing to link the new pane to.
        dragSourceRef.current = null;
        return;
      }

      // Flow-space drop point — used for group membership hit-testing.
      const pos = reactFlow.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      let newId: string | undefined;
      if (data.kind === "text") {
        newId = await addOptimisticClip(sourceId, data.text, sourceUrl);
      } else if (data.kind === "image") {
        newId = await addOptimisticMediaChild(sourceId, {
          kind: "image",
          src: data.src,
          alt: null,
          position: 0,
        });
      } else {
        // link
        newId = await addOptimisticPageChild(sourceId, data.href, "");
      }

      // Group membership: if the drop point landed inside a group frame,
      // add the new pane to that group. The pane itself still lands in
      // its normal auto-layout slot (see FOLLOW-UP on drop-point
      // placement below).
      if (newId) {
        const frames = reactFlow
          .getNodes()
          .filter((n) => n.type === "group")
          .map((n) => ({
            groupId: n.id.slice("group:".length),
            x: n.position.x,
            y: n.position.y,
            width: (n.width as number) ?? 0,
            height: (n.height as number) ?? 0,
          }));
        const gid = hitTestGroup(pos, frames);
        if (gid) {
          try {
            await fetch(
              "/api/browse/sessions/" +
                encodeURIComponent(initialSession.id) +
                "/groups/" +
                encodeURIComponent(gid) +
                "/members",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ add: [newId] }),
              },
            );
            window.dispatchEvent(new CustomEvent("rdan-browse-refetch"));
          } catch (err) {
            console.error("drag-extract group attach failed", err);
          }
        }
      }

      // Land the pane where it was dropped: register a drop-position
      // override (top-left at the cursor's flow point) that useBrowseLayout
      // merges into the placement so it wins over the columnar slot, and
      // mark it user-dragged so the position persists to the kernel
      // viewport (survives reload). markUserDragged also schedules the save.
      if (newId) {
        const id = newId;
        setDropOverrides((prev) => {
          const next = new Map(prev);
          next.set(id, { x: pos.x, y: pos.y });
          return next;
        });
        markUserDragged(id);
      }
      dragSourceRef.current = null;
      iframeDragPayloadRef.current = null;
    },
    [
      reactFlow,
      getFocused,
      addOptimisticClip,
      addOptimisticMediaChild,
      addOptimisticPageChild,
      initialSession.id,
      markUserDragged,
    ],
  );

  // Auto-summarize: when the session toggle is on, every fresh page
  // node with completed extraction + no existing summary child gets a
  // POST to the summarize endpoint. Tracks "already fired for" by id
  // so a single page only triggers one summarize even across re-renders.
  // The kernel's summarizeNode is idempotent — it returns the existing
  // summary row if one was created concurrently — so a race here is
  // harmless beyond an extra network hop.
  const autoSummarizedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!sessionDefaults.autoSummarize) return;
    // Build a parent→summary-child lookup so we can skip pages that
    // already have a summary tile attached.
    const pagesWithSummary = new Set<string>();
    for (const n of rdanNodes) {
      if (n.kind === "media" && n.mediaKind === "summary" && n.status === "active") {
        const e = rdanEdges.find((x) => x.targetNode === n.id && x.status === "active");
        if (e) pagesWithSummary.add(e.sourceNode);
      }
    }
    for (const n of rdanNodes) {
      if (n.kind !== "page" || n.status !== "active") continue;
      if (n.extractionStatus !== "ok") continue;
      if (pagesWithSummary.has(n.id)) continue;
      if (autoSummarizedRef.current.has(n.id)) continue;
      autoSummarizedRef.current.add(n.id);

      // OPTIMISTIC PLACEHOLDER: insert a pending summary tile + edge
      // immediately so the meta column reserves the slot. Without
      // this, sections render at the top of the meta stack for the
      // 1-3s the LLM is generating; the real summary then pops in
      // ABOVE them and shoves everything down — the "delayed appear"
      // jank the user flagged. The tmp_ ids are removed by the
      // post-poll reconciliation effect once the kernel writes the
      // real summary row.
      const tmpSummaryId = `tmp_summary_${n.id}`;
      const tmpEdgeId = `tmp_summary_edge_${n.id}`;
      const optimisticSummary: BrowseNode = {
        id: tmpSummaryId,
        version: 1,
        sessionId: n.sessionId,
        kind: "media",
        url: n.url,
        title: "Summary",
        byline: null,
        contentMarkdown: null,
        lang: null,
        links: [],
        media: [],
        mediaKind: "summary",
        mediaSrc: null,
        mediaAlt: null,
        summaryText: null,
        summaryStatus: "pending",
        summaryModel: null,
        extractionStatus: "ok",
        extractionError: null,
        status: "active",
        createdBy: "local",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const optimisticEdge: BrowseEdge = {
        id: tmpEdgeId,
        version: 1,
        sessionId: n.sessionId,
        sourceNode: n.id,
        targetNode: tmpSummaryId,
        kind: "media",
        linkText: "summary",
        status: "active",
        createdBy: "local",
        createdAt: new Date().toISOString(),
      };
      setRdanNodes((curr) =>
        curr.some((x) => x.id === tmpSummaryId) ? curr : [...curr, optimisticSummary],
      );
      setRdanEdges((curr) =>
        curr.some((x) => x.id === tmpEdgeId) ? curr : [...curr, optimisticEdge],
      );

      // Fire-and-forget; the kernel writes the real summary node
      // (status='pending' then ='ok' after the LLM) which the next
      // poll picks up. The placeholder above is dropped by the
      // tmp-reconcile effect once the real one arrives.
      void fetch(
        `/api/browse/nodes/${encodeURIComponent(n.id)}/summarize`,
        { method: "POST" },
      )
        .then(() => {
          window.dispatchEvent(new CustomEvent("rdan-browse-refetch"));
        })
        .catch((err) => console.error("auto-summarize failed", err));
    }
  }, [rdanNodes, rdanEdges, sessionDefaults.autoSummarize, setRdanNodes, setRdanEdges]);

  // Drop optimistic summary placeholders once the kernel's real
  // summary node has arrived via polling. Matches by parent (the
  // page id is encoded in `tmp_summary_<pageId>`). Idempotent.
  useEffect(() => {
    const parentsWithRealSummary = new Set<string>();
    for (const n of rdanNodes) {
      if (n.kind === "media" && n.mediaKind === "summary"
        && n.status === "active" && !n.id.startsWith("tmp_")) {
        const e = rdanEdges.find(
          (x) => x.targetNode === n.id && x.status === "active",
        );
        if (e) parentsWithRealSummary.add(e.sourceNode);
      }
    }
    if (parentsWithRealSummary.size === 0) return;
    const tmpIdsToDrop = new Set<string>();
    for (const parentId of parentsWithRealSummary) {
      tmpIdsToDrop.add(`tmp_summary_${parentId}`);
    }
    const tmpEdgeIdsToDrop = new Set<string>();
    for (const parentId of parentsWithRealSummary) {
      tmpEdgeIdsToDrop.add(`tmp_summary_edge_${parentId}`);
    }
    setRdanNodes((curr) => {
      const filtered = curr.filter((n) => !tmpIdsToDrop.has(n.id));
      return filtered.length === curr.length ? curr : filtered;
    });
    setRdanEdges((curr) => {
      const filtered = curr.filter((e) => !tmpEdgeIdsToDrop.has(e.id));
      return filtered.length === curr.length ? curr : filtered;
    });
  }, [rdanNodes, rdanEdges, setRdanNodes, setRdanEdges]);

  // Auto-expire the Undo bar after the timeout window — without this
  // the bar would linger forever after a hide and stale node IDs would
  // get re-restored on click. The 30s window matches Slack/Gmail
  // conventions for "Undo Send"-style affordances.
  useEffect(() => {
    if (!lastHide) return;
    const ms = Math.max(0, lastHide.expiresAt - Date.now());
    const t = setTimeout(() => setLastHide(null), ms);
    return () => clearTimeout(t);
  }, [lastHide]);

  const undoHide = useCallback(async () => {
    if (!lastHide) return;
    const { nodeIds, edgeIds } = lastHide;
    setLastHide(null);
    try {
      const res = await fetch(
        `/api/browse/sessions/${encodeURIComponent(initialSession.id)}/nodes/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeIds, edgeIds }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Force a refresh by re-fetching the session — the polling effect
      // does this on its own cadence but we want the restored nodes
      // back on screen immediately.
      const detail = await fetch(
        `/api/browse/sessions/${encodeURIComponent(initialSession.id)}`,
      );
      if (detail.ok) {
        const data = (await detail.json()) as {
          nodes: BrowseNode[];
          edges: BrowseEdge[];
        };
        setRdanNodes(data.nodes);
        setRdanEdges(data.edges);
        // Rebuild xyflow nodes synchronously with a fresh placement
        // (no overrides) so the restore is visible immediately rather
        // than waiting for the next render cycle.
        const rebuiltPlacement = computeColumnarLayout(data.nodes, data.edges, new Map());
        const rebuilt = buildFlow(data.nodes, data.edges, rebuiltPlacement, userSizes);
        setNodes(rebuilt.nodes);
        setEdges(rebuilt.edges);
      }
    } catch (err) {
      console.error("undo hide failed", err);
      // Re-stash so the user can try again.
      setLastHide({ nodeIds, edgeIds, expiresAt: Date.now() + 30_000 });
    }
  }, [
    initialSession.id,
    lastHide,
    setNodes,
    setEdges,
    setRdanNodes,
    setRdanEdges,
  ]);

  const { theme: browseTheme, toggle: toggleBrowseTheme, className: browseThemeClass } = useBrowseTheme();
  const [perfOverlayOn, setPerfOverlayOn] = useState(false);

  // ── Canvas assistant: context, action-applier, send ───────────────────────
  // The current canvas as the LLM needs to see it: active page cards + groups +
  // selection. Sent with every turn (the endpoint is stateless).
  const gatherBrowseContext = useCallback(() => {
    const nodes = rdanNodes
      .filter((n) => n.status === "active" && !n.id.startsWith("group:"))
      .map((n) => ({ id: n.id, title: n.title ?? undefined, url: n.url, kind: n.kind }));
    const groups = rdanGroups
      .filter((g) => g.status === "active")
      .map((g) => ({ id: g.id, label: g.label, color: g.color }));
    return { nodes, groups, selectedIds };
  }, [rdanNodes, rdanGroups, selectedIds]);

  // Align/distribute the page cards by writing drop-position overrides computed
  // from their current on-canvas geometry (group frames excluded).
  const arrangeBrowse = useCallback(
    (op: string) => {
      const live = reactFlow
        .getNodes()
        .filter((n) => !n.id.startsWith("group:") && n.type !== "group");
      if (live.length === 0) return;
      const geo = live.map((n) => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        w: (n.width as number | undefined) ?? 640,
        h: (n.height as number | undefined) ?? 360,
      }));
      const minX = Math.min(...geo.map((g) => g.x));
      const minY = Math.min(...geo.map((g) => g.y));
      const maxR = Math.max(...geo.map((g) => g.x + g.w));
      const maxB = Math.max(...geo.map((g) => g.y + g.h));
      setDropOverrides((prev) => {
        const next = new Map(prev);
        if (op === "alignTop") geo.forEach((g) => next.set(g.id, { x: g.x, y: minY }));
        else if (op === "alignBottom") geo.forEach((g) => next.set(g.id, { x: g.x, y: maxB - g.h }));
        else if (op === "alignLeft") geo.forEach((g) => next.set(g.id, { x: minX, y: g.y }));
        else if (op === "alignRight") geo.forEach((g) => next.set(g.id, { x: maxR - g.w, y: g.y }));
        else if (op === "distributeHorizontal") {
          let x = minX;
          [...geo].sort((a, b) => a.x - b.x).forEach((g) => {
            next.set(g.id, { x, y: g.y });
            x += g.w + 60;
          });
        } else if (op === "distributeVertical") {
          let y = minY;
          [...geo].sort((a, b) => a.y - b.y).forEach((g) => {
            next.set(g.id, { x: g.x, y });
            y += g.h + 60;
          });
        }
        return next;
      });
    },
    [reactFlow, setDropOverrides],
  );

  const applyBrowseAction = useCallback(
    (a: BrowseChatAction) => {
      if (a.type === "hideNodes") {
        // closeNode cascades to descendants (browse's existing close semantics)
        // and keeps a single-slot undo buffer, so showNodes restores the LAST
        // hidden batch — matching the manual close-button UX.
        for (const id of a.nodeIds) void closeNode(id);
      } else if (a.type === "showNodes") {
        void undoHide();
      } else if (a.type === "createGroup") {
        void fetch(
          `/api/browse/sessions/${encodeURIComponent(initialSession.id)}/groups`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nodeIds: a.nodeIds,
              label: a.label,
              ...(a.color ? { color: a.color } : {}),
            }),
          },
        )
          .then(() => window.dispatchEvent(new CustomEvent("rdan-browse-refetch")))
          .catch((err) => console.error("createGroup failed", err));
      } else if (a.type === "updateGroup") {
        const body: Record<string, unknown> = {};
        if (a.label != null) body.label = a.label;
        if (a.color != null) body.color = a.color;
        void patchGroup(a.groupId, body);
      } else if (a.type === "collapseGroups") {
        setCollapsedGroups((prev) => {
          const next = new Set(prev);
          for (const id of a.groupIds) {
            if (a.collapsed) next.add(id);
            else next.delete(id);
          }
          return next;
        });
      } else if (a.type === "relayout") {
        void handleResetLayout();
      } else if (a.type === "arrange") {
        arrangeBrowse(a.op);
      } else if (a.type === "highlight") {
        setFocused(a.nodeId);
        focusNode(a.nodeId);
      }
    },
    [
      closeNode,
      undoHide,
      initialSession.id,
      patchGroup,
      handleResetLayout,
      arrangeBrowse,
      focusNode,
      setFocused,
    ],
  );

  const handleAssistantSend = useCallback(
    async (text: string) => {
      const next: AssistantMessage[] = [...assistantMessages, { role: "user", content: text }];
      setAssistantMessages(next);
      setAssistantBusy(true);
      try {
        const { nodes, groups, selectedIds: sel } = gatherBrowseContext();
        const res = await fetch(
          `/api/browse/sessions/${encodeURIComponent(initialSession.id)}/chat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: next,
              nodes,
              groups,
              selectedIds: sel,
              context: `${nodes.length} cards, ${groups.length} groups`,
            }),
          },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          reply?: string;
          actions?: BrowseChatAction[];
        };
        setAssistantMessages((m) => [
          ...m,
          { role: "assistant", content: data.reply ?? "(no response)" },
        ]);
        for (const act of data.actions ?? []) applyBrowseAction(act);
      } catch (err) {
        setAssistantMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: `Sorry — that failed (${err instanceof Error ? err.message : String(err)}).`,
          },
        ]);
      } finally {
        setAssistantBusy(false);
      }
    },
    [assistantMessages, gatherBrowseContext, initialSession.id, applyBrowseAction],
  );

  return (
    <div
      className={`flex flex-col flex-1 h-full min-w-0 relative transition-[padding-right] duration-200 ${browseThemeClass}`.trim()}
      style={{
        paddingRight: "var(--browse-chat-panel-width, 0px)",
        // Light/dark vars cascade via the className. The class also
        // sets the BACKGROUND on the wrapper itself so xyflow's default
        // backdrop picks up the right colour.
        background: browseTheme !== "auto" ? "var(--background)" : undefined,
      }}
    >
      <UrlBar
        onSubmit={addOptimisticRoot}
        cacheBytes={cacheStats.bytes}
        nodeCount={cacheStats.count}
        defaultFetchMode={sessionDefaults.fetchMode}
        onSetDefaultFetchMode={(m) =>
          setSessionDefaults((s) => ({ ...s, fetchMode: m }))
        }
        autoSummarize={sessionDefaults.autoSummarize}
        onSetAutoSummarize={(on) =>
          setSessionDefaults((s) => ({ ...s, autoSummarize: on }))
        }
        defaultViewMode={defaultViewMode}
        onSetDefaultViewMode={setDefaultViewMode}
        onResetLayout={handleResetLayout}
        onTreeBack={handleTreeBack}
        onTreeForward={handleTreeForward}
        canTreeBack={canBack()}
        canTreeForward={canForward()}
        browseTheme={browseTheme}
        onToggleBrowseTheme={toggleBrowseTheme}
        perfOverlayOn={perfOverlayOn}
        onTogglePerfOverlay={() => setPerfOverlayOn((v) => !v)}
        onCustomise={() => {
          const focusedId = getFocused();
          const focused = focusedId ? rdanNodes.find((n) => n.id === focusedId) : null;
          const hosts = Array.from(
            new Set(
              rdanNodes
                .filter((n) => n.kind === "page" && n.status === "active")
                .map((n) => {
                  try {
                    return new URL(n.url).hostname;
                  } catch {
                    return "";
                  }
                })
                .filter(Boolean),
            ),
          );
          openChatPanel(
            buildCanvasPrefill({
              sessionId: initialSession.id,
              nodeCount: rdanNodes.filter((n) => n.status === "active").length,
              hosts,
              focusedNodeId: focusedId,
              focusedNodeTitle: focused?.title ?? null,
              focusedNodeUrl: focused?.url ?? null,
            }),
            { agent: "pi-coder", labelPrefix: "customise" },
          );
        }}
      />
      <div className="flex-1 flex min-h-0">
      <div
        className="flex-1 min-w-0 relative"
        onMouseDownCapture={handleCanvasMouseDown}
        onDragStartCapture={handleDragSourceCapture}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={extractFromDrop}
      >
        <ReactFlow
          nodes={wiredNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onMove={scheduleViewportSave}
          onSelectionChange={handleSelectionChange}
          onNodeDragStop={(_e, node) => {
            // Mark this node as user-dragged so its position gets persisted.
            // Nodes placed by the columnar layout are NOT in the set and
            // therefore don't write overrides — they reflow cleanly on
            // the next session load.
            markUserDragged(node.id);
            // Attach/detach the dragged node to/from a group frame based
            // on where it landed. No-op for group frame drags.
            void attachDetachOnDragStop(node);
          }}
          onNodeClick={handleNodeClick}
          fitView={!initialViewport}
          // Open up the zoom range so users can pull way out for the
          // big-picture view (xyflow defaults to 0.5 / 2). 0.05 lets
          // the whole sprawling tree fit on screen; 4 zooms in tight
          // for image-heavy pages.
          minZoom={0.05}
          maxZoom={4}
          // Multi-select: plain left-drag on empty canvas draws a
          // selection rectangle. Shift-click adds individual nodes
          // to / removes from the selection. Dragging any selected
          // node moves the whole group as a unit. Panning moved to:
          // hold Space+drag, or use middle/right mouse drag —
          // frees the primary mouse for selection, matching Figma /
          // Miro / draw.io conventions.
          //
          // selectionMode="partial" means a node is selected as soon
          // as the rectangle TOUCHES it; default 'full' requires the
          // rectangle to fully enclose the node, which feels broken
          // on the large page tiles.
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={[1, 2]}
          panActivationKeyCode="Space"
          multiSelectionKeyCode="Shift"
          selectNodesOnDrag={false}
        >
          <Background />
          {/* Wheel-over the +/- buttons should zoom the canvas. xyflow
              Controls otherwise swallow wheel events. Intercept here:
              deltaY > 0 → zoomOut, < 0 → zoomIn. */}
          <div
            onWheelCapture={(e) => {
              e.preventDefault();
              if (e.deltaY > 0) reactFlow.zoomOut({ duration: 100 });
              else if (e.deltaY < 0) reactFlow.zoomIn({ duration: 100 });
            }}
          >
            <Controls />
          </div>
        </ReactFlow>
      </div>
      {assistantOpen && (
        <BrowseAssistantPanel
          onClose={() => setAssistantOpen(false)}
          messages={assistantMessages}
          busy={assistantBusy}
          onSend={handleAssistantSend}
        />
      )}
      {endpointsOpen && (
        <EndpointsPanel
          sessionId={initialSession.id}
          nodes={rdanNodes}
          onClose={() => setEndpointsOpen(false)}
        />
      )}
      </div>
      {lastHide && lastHide.nodeIds.length > 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-card border border-card-border rounded shadow-lg px-3 py-2 flex items-center gap-3 text-sm z-50">
          <span>
            Closed {lastHide.nodeIds.length} node{lastHide.nodeIds.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={undoHide}
            className="text-primary hover:underline cursor-pointer font-semibold"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => setLastHide(null)}
            aria-label="dismiss"
            className="text-muted-foreground hover:text-foreground cursor-pointer leading-none w-4 h-4"
          >
            ×
          </button>
        </div>
      )}
      {groupableIds.length >= 2 && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-card border border-card-border rounded shadow-lg px-3 py-2 flex items-center gap-3 text-sm z-50">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void groupSelected()}
          >
            ▣ Group {groupableIds.length}
          </Button>
        </div>
      )}
      {perfOverlayOn && (
        <PerfOverlay nodeCount={wiredNodes.length} edgeCount={edges.length} />
      )}
      <div className="absolute top-3 right-3 z-50 flex items-center gap-2">
        {!endpointsOpen && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEndpointsOpen(true)}
            title="Show endpoint metadata captured from headless page loads"
            className="shadow-lg"
          >
            Endpoints
          </Button>
        )}
        {!assistantOpen && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setAssistantOpen(true)}
            title="Canvas assistant — tell it to hide, group, recolour, tidy, or highlight pages"
            className="shadow-lg"
          >
            ✦ Assistant
          </Button>
        )}
      </div>
      <ChatPanel
        state={chatPanel}
        onClose={closeChatPanel}
        onTogglePinned={toggleChatPanelPin}
      />
    </div>
  );
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
