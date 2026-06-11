"use client";

// Custom xyflow node for browse-canvas media rows (kind: "media"). Renders
// the embedded asset directly — image/video inline, iframe sandboxed —
// with a small caption strip underneath. Sandbox flags are intentionally
// minimal (allow-scripts + allow-same-origin) so most embeds (YouTube,
// codepens, etc.) work without granting the iframe top-level redirects
// or popup access.

import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useMemo, useState } from "react";
import { writeDragExtractData } from "./drag-extract";

export interface MediaNodeData extends Record<string, unknown> {
  // 'section' and 'summary' are routed to SectionNode/SummaryNode via
  // separate xyflow node types in T13/T14; this union keeps MediaNode
  // type-safe while sharing the BrowseNode.mediaKind discriminator.
  mediaKind: "image" | "video" | "iframe" | "section" | "summary";
  mediaSrc: string;
  mediaAlt: string | null;
  url: string;
  /** rdan browse node id — used to load the saved image bytes via
   *  /api/browse/media/:nodeId; falls back to the original URL on error. */
  nodeId: string;
  onClose: () => void;
}

export type MediaFlowNode = Node<MediaNodeData, "media">;

export const MediaNode = memo(MediaNodeImpl, (prev, next) =>
  prev.id === next.id && prev.data === next.data && prev.selected === next.selected,
);
function MediaNodeImpl({ data }: NodeProps<MediaFlowNode>) {
  // Twitch's player iframe demands a parent= query param matching the
  // embedding origin; we don't know that statically (could be
  // localhost / production / a staging preview). Substitute the placeholder
  // at render time. Same trick for any other embed that needs the host.
  const resolvedSrc = useMemo(() => {
    if (typeof window === "undefined") return data.mediaSrc;
    return data.mediaSrc.replace(/__BROWSE_HOST__/g, window.location.hostname);
  }, [data.mediaSrc]);

  // For images only: try the stored copy first; fall back to the original
  // URL (resolvedSrc) if the kernel route returns an error or the node
  // has no saved bytes yet. The fallback is local state so it doesn't
  // affect memo stability — the memo equality fn only checks id/data/selected.
  const [imgFailed, setImgFailed] = useState(false);
  const imageSrc = imgFailed
    ? resolvedSrc
    : `/api/browse/media/${encodeURIComponent(data.nodeId)}`;

  return (
    <div
      className="bg-card border border-card-border rounded shadow flex flex-col text-sm relative w-full h-full"
      style={{ minWidth: 280, minHeight: 200 }}
    >
      <NodeResizer
        minWidth={280}
        minHeight={200}
        lineClassName="!border-primary/50"
        handleClassName="!bg-primary !border-card !w-2 !h-2"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          data.onClose();
        }}
        aria-label="close"
        title="Close"
        className="absolute top-0.5 right-0.5 w-5 h-5 rounded text-muted-foreground hover:text-foreground hover:bg-card-border/50 cursor-pointer leading-none text-base z-10"
      >
        ×
      </button>
      <Handle type="target" position={Position.Left} />
      <div className="nowheel nodrag flex-1 min-h-0 flex items-center justify-center bg-black/30 overflow-hidden">
        {data.mediaKind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt={data.mediaAlt ?? ""}
            className="max-w-full max-h-full object-contain"
            loading="lazy"
            onError={() => setImgFailed(true)}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              writeDragExtractData(e.dataTransfer, { kind: "image", src: resolvedSrc });
            }}
          />
        )}
        {data.mediaKind === "video" && (
          <video
            src={resolvedSrc}
            controls
            className="max-w-full max-h-full block"
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              writeDragExtractData(e.dataTransfer, { kind: "link", href: resolvedSrc });
            }}
          />
        )}
        {data.mediaKind === "iframe" && (
          <iframe
            src={resolvedSrc}
            title={data.mediaAlt ?? "embedded media"}
            className="w-full h-full block"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        )}
      </div>
      <div
        className="px-2 py-1 text-xs text-muted-foreground truncate border-t border-card-border shrink-0"
        title={data.mediaSrc}
      >
        {data.mediaAlt ?? data.mediaSrc}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
