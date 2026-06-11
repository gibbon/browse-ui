// Pure function: rdan node graph + placement Map → xyflow Node[]/Edge[].
//
// Handlers on each node's `data` are PLACEHOLDERS — the wiredNodes
// useMemo in canvas.tsx re-binds them to the live optimistic helpers
// on every render. Keeping the shape stable here means xyflow can
// re-render without React-warning about changed object identity.

import type { Node, Edge } from "@xyflow/react";
import type {
  BrowseNode,
  BrowseEdge,
  BrowseGroup,
  BrowseGroupMember,
} from "@/lib/browse-types";
import type { PageNodeData } from "./page-node";
import type { MediaNodeData } from "./media-node";
import type { GalleryNodeData } from "./gallery-node";
import type { GroupNodeData } from "./group-node";
import type { ClipNodeData } from "./clip-node";
import type { EndpointsNodeData } from "./endpoints-node";
import type { EndpointDetailNodeData } from "./endpoint-detail-node";
import { parsePlaygroundPayload, type PlaygroundNodeData } from "./playground-node";
import { parseGeneratedViewPayload, type GeneratedViewNodeData } from "./generated-view-node";
import { membersByGroup } from "./group-utils";
import { PAGE_HEIGHT, type NodePlacement } from "./columnar-layout";

export function buildFlow(
  rdanNodes: BrowseNode[],
  rdanEdges: BrowseEdge[],
  placement: Map<string, NodePlacement>,
  /** Per-node width/height overrides captured from xyflow NodeResizer
   *  drag-end events. When a user resizes a node, the new dimensions
   *  win over the placement-computed defaults so a node refresh or a
   *  layout recompute doesn't snap the tile back to its seed size.
   *  Position overrides live separately on viewport.nodePositions —
   *  this map ONLY carries width/height. */
  userSizes: Map<string, { width: number; height: number }> = new Map(),
  groups: BrowseGroup[] = [],
  groupMembers: BrowseGroupMember[] = [],
  collapsed: Set<string> = new Set(),
): { nodes: Node[]; edges: Edge[] } {
  const activeNodes = rdanNodes.filter((n) => n.status === "active");
  const placementFor = (id: string): NodePlacement => {
    const base = placement.get(id) ?? { x: 0, y: 0, width: 640, height: PAGE_HEIGHT };
    const sized = userSizes.get(id);
    return sized ? { ...base, width: sized.width, height: sized.height } : base;
  };

  const pageNodes: Node[] = activeNodes
    .filter((n) => n.kind === "page")
    .map((n) => {
      const data: PageNodeData = {
        title: n.title,
        byline: n.byline,
        url: n.url,
        contentMarkdown: n.contentMarkdown,
        links: n.links,
        media: n.media,
        extractionStatus: n.extractionStatus,
        extractionError: n.extractionError,
        // seenBefore recomputed by wiredNodes from canvas state.
        seenBefore: false,
        seenBeforeBranch: null,
        onClickLink: () => {},
        onClickMedia: () => {},
        onRetry: () => {},
        onClose: () => {},
        onReload: () => {},
        onBack: () => {},
        onForward: () => {},
        hasBack: false,
        hasForward: false,
        viewMode: "reader",
        onSetViewMode: () => {},
        userAgent: "default",
        onSetUserAgent: () => {},
        fetchMode: "static",
        onSetFetchMode: () => {},
        sessionId: "",
        sections: n.sections,
        nodeId: n.id,
        rdanNode: n,
        onOpenChat: undefined,
      };
      const p = placementFor(n.id);
      return {
        id: n.id,
        type: "page",
        data,
        position: { x: p.x, y: p.y },
        width: p.width,
        height: p.height,
        style: { width: p.width, height: p.height },
      };
    });

  // Parent lookup for summary nodes (they need their source page id to
  // POST a retry).
  const parentOfMediaKind = new Map<string, string>();
  for (const e of rdanEdges) {
    if (e.status !== "active") continue;
    parentOfMediaKind.set(e.targetNode, e.sourceNode);
  }

  // Map media-kind nodes to their xyflow node type. 'section' and 'summary'
  // are routed to their dedicated SectionNode/SummaryNode renderers; the
  // remaining kinds (image/video/iframe) keep the generic MediaNode.
  const mediaNodes: Node[] = activeNodes
    .filter((n) => n.kind === "media")
    .map((n) => {
      const p = placementFor(n.id);
      if (n.mediaKind === "section") {
        let domain = "";
        try { domain = new URL(n.url).hostname; } catch {}
        return {
          id: n.id,
          type: "section",
          data: {
            landmark: n.sectionLandmark ?? "section",
            selector: n.sectionSelector ?? "",
            body: n.mediaSrc ?? n.mediaAlt ?? "",
            domain,
            onClose: () => {},
            rdanNode: n,
            onOpenChat: undefined,
          },
          position: { x: p.x, y: p.y },
          width: p.width,
          height: p.height,
          style: { width: p.width, height: p.height },
        };
      }
      if (n.mediaKind === "summary" || n.mediaKind === "summary-detailed") {
        const parentId = parentOfMediaKind.get(n.id) ?? n.id;
        const detailed = n.mediaKind === "summary-detailed";
        return {
          id: n.id,
          type: "summary",
          data: {
            parentNodeId: parentId,
            summaryText: n.summaryText ?? null,
            summaryStatus: n.summaryStatus ?? null,
            summaryModel: n.summaryModel ?? null,
            detailed,
            rdanNode: n,
            onOpenChat: undefined,
            onClose: () => {},
          },
          position: { x: p.x, y: p.y },
          width: p.width,
          height: p.height,
          style: { width: p.width, height: p.height },
        };
      }
      if (n.mediaKind === "endpoints") {
        const parentId = parentOfMediaKind.get(n.id) ?? n.id;
        const parsed = parseEndpointPayload(n.mediaSrc);
        const data: EndpointsNodeData = {
          endpointNodeId: n.id,
          sessionId: n.sessionId,
          parentNodeId: parsed.parentNodeId ?? parentId,
          parentTitle: parsed.parentTitle ?? n.title,
          signatures: parsed.signatures,
          onClose: () => {},
          onOpenDetail: () => {},
        };
        return {
          id: n.id,
          type: "endpoints",
          data,
          position: { x: p.x, y: p.y },
          width: p.width,
          height: p.height,
          style: { width: p.width, height: p.height },
        };
      }
      if (n.mediaKind === "endpoint-detail") {
        const parsed = parseEndpointDetailPayload(n.mediaSrc);
        const data: EndpointDetailNodeData = {
          detailNodeId: n.id,
          signature: parsed.signature,
          observations: parsed.observations,
          onClose: () => {},
          onRunPlayground: async () => {},
          onSuggestPlayground: async () => {},
        };
        return {
          id: n.id,
          type: "endpointDetail",
          data,
          position: { x: p.x, y: p.y },
          width: p.width,
          height: p.height,
          style: { width: p.width, height: p.height },
        };
      }
      if (n.mediaKind === "playground-result" || n.mediaKind === "playground-suggestions") {
        const data: PlaygroundNodeData = {
          ...parsePlaygroundPayload(n.mediaSrc),
          onClose: () => {},
          onApplySuggestion: async () => {},
          onGenerateView: async () => {},
        };
        return {
          id: n.id,
          type: "playground",
          data,
          position: { x: p.x, y: p.y },
          width: p.width,
          height: p.height,
          style: { width: p.width, height: p.height },
        };
      }
      if (n.mediaKind === "generated-view") {
        const data: GeneratedViewNodeData = {
          payload: parseGeneratedViewPayload(n.mediaSrc),
          onClose: () => {},
        };
        return {
          id: n.id,
          type: "generatedView",
          data,
          position: { x: p.x, y: p.y },
          width: p.width,
          height: p.height,
          style: { width: p.width, height: p.height },
        };
      }
      const data: MediaNodeData = {
        mediaKind: n.mediaKind ?? "image",
        mediaSrc: n.mediaSrc ?? n.url,
        mediaAlt: n.mediaAlt,
        url: n.url,
        nodeId: n.id,
        onClose: () => {},
      };
      return {
        id: n.id,
        type: "media",
        data,
        position: { x: p.x, y: p.y },
        width: p.width,
        height: p.height,
        style: { width: p.width, height: p.height },
      };
    });

  const galleryNodes: Node[] = activeNodes
    .filter((n) => n.kind === "gallery")
    .map((n) => {
      const data: GalleryNodeData = {
        parentUrl: n.url,
        parentTitle: n.title,
        media: n.media ?? [],
        onClose: () => {},
      };
      const p = placementFor(n.id);
      return {
        id: n.id,
        type: "gallery",
        data,
        position: { x: p.x, y: p.y },
        width: p.width,
        height: p.height,
        style: { width: p.width, height: p.height },
      };
    });

  const clipNodes: Node[] = activeNodes
    .filter((n) => n.kind === "clip")
    .map((n) => {
      const data: ClipNodeData = {
        contentMarkdown: n.contentMarkdown,
        url: n.url,
        onClose: () => {},
      };
      const p = placementFor(n.id);
      // Clips get a compact default (the columnar meta-tile size is too
      // tall for a short excerpt); the user resizes from there and the
      // dimensions persist via userSizes like every other tile.
      const sized = userSizes.get(n.id);
      const width = sized?.width ?? 340;
      const height = sized?.height ?? 200;
      return {
        id: n.id,
        type: "clip",
        data,
        position: { x: p.x, y: p.y },
        width,
        height,
        style: { width, height },
      };
    });

  // Group frames as xyflow parent nodes. A frame node carries the
  // bounding-box position/size from `placement` under the 'group:<id>'
  // key. Member nodes are reparented (parentId) and their positions
  // rewritten to be RELATIVE to the frame, which is how xyflow moves a
  // group + children together when the frame is dragged. xyflow requires
  // every parent node to appear BEFORE its children in the node array.
  const byGroup = membersByGroup(groupMembers);
  const groupNodes: Node[] = [];
  // node id → { groupNodeId, frame } for each member of an active,
  // frame-having group, so member nodes can be reparented below.
  const nodeIdToGroupFrame = new Map<
    string,
    { groupNodeId: string; frame: NodePlacement }
  >();
  // Union of member ids belonging to any COLLAPSED group. Their member
  // nodes are filtered out of the final array (the frame shrinks to a
  // compact tile and the members are hidden).
  const collapsedMemberIds = new Set<string>();
  const COLLAPSED_WIDTH = 220;
  const COLLAPSED_HEIGHT = 48;
  for (const g of groups) {
    if (g.status !== "active") continue;
    const frame = placement.get("group:" + g.id);
    if (!frame) continue;
    const groupNodeId = "group:" + g.id;
    const isCollapsed = collapsed.has(g.id);
    const data: GroupNodeData = {
      label: g.label,
      color: g.color,
      count: (byGroup.get(g.id) ?? []).length,
      collapsed: isCollapsed,
      onRename: () => {},
      onToggleCollapse: () => {},
    };
    const w = isCollapsed ? COLLAPSED_WIDTH : frame.width;
    const h = isCollapsed ? COLLAPSED_HEIGHT : frame.height;
    groupNodes.push({
      id: groupNodeId,
      type: "group",
      position: { x: frame.x, y: frame.y },
      width: w,
      height: h,
      data,
      style: { width: w, height: h },
      draggable: true,
      selectable: true,
      zIndex: 0,
    });
    if (isCollapsed) {
      for (const memberId of byGroup.get(g.id) ?? []) {
        collapsedMemberIds.add(memberId);
      }
      // Collapsed groups hide their members — don't reparent them.
      continue;
    }
    for (const memberId of byGroup.get(g.id) ?? []) {
      nodeIdToGroupFrame.set(memberId, { groupNodeId, frame });
    }
  }

  // Reparent any member node onto its group frame, rewriting its
  // position to frame-relative coordinates (xyflow expects child
  // positions relative to the parent's origin).
  const reparent = (n: Node): Node => {
    const grp = nodeIdToGroupFrame.get(n.id);
    if (!grp) return n;
    return {
      ...n,
      parentId: grp.groupNodeId,
      position: {
        x: n.position.x - grp.frame.x,
        y: n.position.y - grp.frame.y,
      },
    };
  };

  // Members of a collapsed group are hidden entirely. A member of a
  // NON-collapsed group is not in this set and renders + reparents
  // normally.
  const visible = (n: Node): boolean => !collapsedMemberIds.has(n.id);

  const nodes: Node[] = [
    ...groupNodes,
    ...pageNodes.filter(visible).map(reparent),
    ...mediaNodes.filter(visible).map(reparent),
    ...galleryNodes.filter(visible).map(reparent),
    ...clipNodes.filter(visible).map(reparent),
  ];

  const edges: Edge[] = rdanEdges
    .filter((e) => e.status === "active")
    .map((e) => ({
      id: e.id,
      source: e.sourceNode,
      target: e.targetNode,
      style:
        e.kind === "derived"
          ? { strokeDasharray: "4 3", stroke: "#6a9" }
          : e.kind === "media"
          ? { strokeDasharray: "5,5", stroke: "#94a3b8" }
          : undefined,
    }));

  return { nodes, edges };
}

function parseEndpointDetailPayload(raw: string | null): {
  signature: EndpointDetailNodeData["signature"];
  observations: EndpointDetailNodeData["observations"];
} {
  if (!raw) return { signature: null, observations: [] };
  try {
    const parsed = JSON.parse(raw) as {
      signature?: unknown;
      observations?: unknown;
    };
    return {
      signature: parsed.signature && typeof parsed.signature === "object"
        ? parsed.signature as EndpointDetailNodeData["signature"]
        : null,
      observations: Array.isArray(parsed.observations)
        ? parsed.observations as EndpointDetailNodeData["observations"]
        : [],
    };
  } catch {
    return { signature: null, observations: [] };
  }
}

function parseEndpointPayload(raw: string | null): {
  parentNodeId?: string;
  parentTitle?: string | null;
  signatures: EndpointsNodeData["signatures"];
} {
  if (!raw) return { signatures: [] };
  try {
    const parsed = JSON.parse(raw) as {
      parentNodeId?: unknown;
      parentTitle?: unknown;
      signatures?: unknown;
    };
    return {
      parentNodeId: typeof parsed.parentNodeId === "string" ? parsed.parentNodeId : undefined,
      parentTitle: typeof parsed.parentTitle === "string" || parsed.parentTitle === null ? parsed.parentTitle : undefined,
      signatures: Array.isArray(parsed.signatures) ? parsed.signatures as EndpointsNodeData["signatures"] : [],
    };
  } catch {
    return { signatures: [] };
  }
}
