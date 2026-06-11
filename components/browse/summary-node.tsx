"use client";

// xyflow node renderer for an AI summary tile. Body shows the
// LLM-generated 3-5 bullet TL;DR + short prose. Pending state renders
// a shimmer skeleton; failed state shows a Retry button. The summary
// itself lives on the kernel-side browse_nodes row as summary_text /
// summary_status / summary_model — this component just renders them.

import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { ChatTriggerButton } from "./chat-trigger-button";
import type { BrowseNode } from "@/lib/browse-types";

export interface SummaryNodeData extends Record<string, unknown> {
  /** Source page node id — needed by the Retry path. */
  parentNodeId: string;
  summaryText: string | null;
  summaryStatus: "pending" | "ok" | "failed" | null;
  summaryModel: string | null;
  /** True when this tile is the detailed summary (separate node,
   *  mediaKind="summary-detailed"). Used for the header label and
   *  to hide the "Detailed summary" button on the detailed tile
   *  itself. */
  detailed?: boolean;
  onClose: () => void;
  /** Called after a successful retry so the canvas can refresh. */
  onRetried?: () => void;
  /** Full BrowseNode and chat-open callback for the → Chat button. */
  rdanNode?: BrowseNode;
  onOpenChat?: (prefill: string) => void;
}

export type SummaryFlowNode = Node<SummaryNodeData, "summary">;

export const SummaryNode = memo(SummaryNodeImpl, (prev, next) =>
  prev.id === next.id && prev.data === next.data && prev.selected === next.selected,
);
function SummaryNodeImpl({ data }: NodeProps<SummaryFlowNode>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [deepening, setDeepening] = useState(false);

  async function summarize(mode: "basic" | "detailed") {
    const setBusy = mode === "detailed" ? setDeepening : setRetrying;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/browse/nodes/${encodeURIComponent(data.parentNodeId)}/summarize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        },
      );
      if (!res.ok) throw new Error(`POST returned ${res.status}`);
      data.onRetried?.();
      // Tell the canvas to refetch — the kernel just wrote a new
      // summary-detailed child node, but the polling loop only kicks
      // in when something is pending, so we have to nudge it.
      window.dispatchEvent(new CustomEvent("rdan-browse-refetch"));
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(
        `${mode === "detailed" ? "Detailed summary" : "Retry"} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className="rounded border border-card-border bg-card overflow-hidden flex flex-col h-full"
    >
      <Handle type="target" position={Position.Left} />
      <NodeResizer minWidth={320} minHeight={300} />
      <div className="flex items-center justify-between px-2 py-1 border-b border-card-border bg-card-border/30 text-xs">
        <div className="flex items-center gap-2 truncate">
          <span className="font-mono uppercase tracking-wide text-[10px] text-muted-foreground">
            {data.detailed ? "✨ detailed summary" : "✨ summary"}
          </span>
          {data.summaryModel && (
            <span className="text-[10px] text-muted-foreground/70 truncate" title={data.summaryModel}>
              {data.summaryModel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data.rdanNode && data.onOpenChat && (
            <ChatTriggerButton node={data.rdanNode} rootRef={rootRef} onOpenChat={data.onOpenChat} />
          )}
          <button
            type="button"
            onClick={data.onClose}
            className="text-[10px] px-1.5 py-0.5 rounded bg-card-border/60 hover:bg-card-border"
            title="Close this summary tile"
          >
            ×
          </button>
        </div>
      </div>
      <div className="nodrag nowheel select-text flex-1 overflow-auto p-2 text-sm">
        {data.summaryStatus === "pending" && (
          <div className="space-y-2 animate-pulse">
            <div className="h-3 bg-card-border/50 rounded w-3/4" />
            <div className="h-3 bg-card-border/50 rounded w-5/6" />
            <div className="h-3 bg-card-border/50 rounded w-2/3" />
            <div className="h-3 bg-card-border/50 rounded w-3/4" />
          </div>
        )}
        {data.summaryStatus === "failed" && (
          <div className="text-destructive flex flex-col items-start gap-2">
            <span>Couldn&apos;t summarize this page.</span>
            <button
              type="button"
              disabled={retrying}
              onClick={() => summarize("basic")}
              className="text-xs px-2 py-0.5 rounded bg-card-border/60 hover:bg-card-border"
            >
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}
        {data.summaryStatus === "ok" && data.summaryText && (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkBreaks]}>{data.summaryText}</ReactMarkdown>
          </div>
        )}
        {data.summaryStatus === "ok" && !data.summaryText && (
          <span className="text-muted-foreground italic">Empty summary.</span>
        )}
        {data.summaryStatus === "ok" && !data.detailed && (
          <div className="mt-3 pt-2 border-t border-card-border/40">
            <button
              type="button"
              disabled={deepening}
              onClick={() => summarize("detailed")}
              className="text-[11px] px-2 py-0.5 rounded bg-card-border/60 hover:bg-card-border text-muted-foreground"
              title="Generate a comprehensive summary in a new tile — uses the full page (incl. comments)."
            >
              {deepening ? "Generating detailed summary…" : "↓ Detailed summary →"}
            </button>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
