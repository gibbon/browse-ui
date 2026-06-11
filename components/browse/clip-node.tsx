"use client";

// Custom xyflow node for browse-canvas clip tiles (kind: "clip"). Renders
// an extracted text excerpt with a draggable header (grab handle + close),
// a scrollable full-text body (no truncation — long clips scroll), and a
// source-host footer link. Resizable via NodeResizer like the other tiles.
// Created when the user drag-selects text on a page node and drops it on
// the canvas.

import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo } from "react";

export interface ClipNodeData extends Record<string, unknown> {
  contentMarkdown: string | null;
  url: string;
  onClose: () => void;
  onOpenChat?: (...args: unknown[]) => void;
}

export type ClipFlowNode = Node<ClipNodeData, "clip">;

export const ClipNode = memo(ClipNodeImpl, (prev, next) =>
  prev.id === next.id && prev.data === next.data && prev.selected === next.selected,
);

function ClipNodeImpl({ data }: NodeProps<ClipFlowNode>) {
  let hostname = "";
  try {
    hostname = new URL(data.url).hostname;
  } catch {
    // url may be relative or malformed — fall back to empty string
  }

  return (
    <div
      className="bg-card border border-card-border rounded shadow flex flex-col text-sm relative w-full h-full overflow-hidden"
      style={{ minWidth: 200, minHeight: 110 }}
    >
      <NodeResizer
        minWidth={200}
        minHeight={110}
        lineClassName="!border-primary/50"
        handleClassName="!bg-primary !border-card !w-2 !h-2"
      />
      <Handle type="target" position={Position.Left} />

      {/* Header = drag handle (NOT nodrag) so the tile can be grabbed even
          though the body below is nodrag for text selection. Taller + a
          grip cue + hover tint so it's an easy, obvious drag target. */}
      <div className="flex items-center justify-between gap-1 px-2 py-2 border-b border-card-border shrink-0 cursor-move bg-card-border/20 hover:bg-card-border/40 transition-colors">
        <span className="text-xs text-muted-foreground truncate flex items-center gap-1.5" title={data.url}>
          <span className="opacity-50 tracking-tighter" aria-hidden>⠿</span>
          clip{hostname ? ` · ${hostname}` : ""}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onClose();
          }}
          aria-label="close"
          title="Close"
          className="w-5 h-5 rounded text-muted-foreground hover:text-foreground hover:bg-card-border/50 cursor-pointer leading-none text-base shrink-0"
        >
          ×
        </button>
      </div>

      {/* Body: full excerpt, scrollable + selectable. No line-clamp — long
          clips scroll rather than truncate. nowheel/nodrag so scroll-wheel
          and text-selection work without xyflow eating the events. */}
      <div className="nowheel nodrag select-text cursor-text flex-1 min-h-0 overflow-y-auto px-3 py-2 border-l-4 border-primary/40">
        <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
          {data.contentMarkdown ?? ""}
        </p>
      </div>

      {/* Source footer */}
      {hostname && (
        <div className="px-2 py-1 text-xs text-muted-foreground border-t border-card-border shrink-0 truncate">
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {hostname}
          </a>
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
