"use client";

// xyflow node renderer for a popped-out DOM-landmark section. Body shows
// the kernel-supplied text preview / HTML snippet. Header has a pin
// button that POSTs to /api/browse/pins so the same landmark auto-applies
// on every future visit to this domain.

import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import { memo, useMemo, useRef, useState } from "react";
import { ChatTriggerButton } from "./chat-trigger-button";
import type { BrowseNode } from "@/lib/browse-types";

export interface SectionNodeData extends Record<string, unknown> {
  landmark: string;
  selector: string;
  /** HTML or text preview of the landmark's content. Pre-sanitized
   *  kernel-side when it's HTML. */
  body: string;
  /** Hostname of the source page; used to scope the pin. */
  domain: string;
  onClose: () => void;
  onPinned?: () => void;
  /** Full BrowseNode and chat-open callback for the → Chat button. */
  rdanNode?: BrowseNode;
  onOpenChat?: (prefill: string) => void;
}

export type SectionFlowNode = Node<SectionNodeData, "section">;

export const SectionNode = memo(SectionNodeImpl, (prev, next) =>
  prev.id === next.id && prev.data === next.data && prev.selected === next.selected,
);
function SectionNodeImpl({ data }: NodeProps<SectionFlowNode>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [pinning, setPinning] = useState(false);
  const [pinned, setPinned] = useState(false);

  // Treat the body as HTML when it contains a tag; otherwise plain text.
  const looksLikeHtml = useMemo(() => /<[a-z][\s\S]*>/i.test(data.body ?? ""), [data.body]);

  async function pin() {
    setPinning(true);
    try {
      const res = await fetch("/api/browse/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: data.domain,
          landmark: data.landmark,
          selector: data.selector,
          action: "pin",
        }),
      });
      if (!res.ok) throw new Error(`pin returned ${res.status}`);
      setPinned(true);
      data.onPinned?.();
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(`Pin failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPinning(false);
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
            section
          </span>
          <span className="truncate" title={data.selector}>
            {data.landmark}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {data.rdanNode && data.onOpenChat && (
            <ChatTriggerButton node={data.rdanNode} rootRef={rootRef} onOpenChat={data.onOpenChat} />
          )}
          <button
            type="button"
            disabled={pinning || pinned}
            onClick={pin}
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              pinned ? "bg-emerald-500/20 text-emerald-300" : "bg-card-border/60 hover:bg-card-border"
            }`}
            title={`Pin '${data.landmark}' on ${data.domain} so it auto-appears on every future page from this site`}
          >
            {pinning ? "…" : pinned ? "Pinned" : "Pin"}
          </button>
          <button
            type="button"
            onClick={data.onClose}
            className="text-[10px] px-1.5 py-0.5 rounded bg-card-border/60 hover:bg-card-border"
            title="Close this section pop-out"
          >
            ×
          </button>
        </div>
      </div>
      <div className="nodrag nowheel select-text flex-1 overflow-auto p-2 text-sm [&_a]:underline [&_a]:text-primary [&_a]:break-words [&_a:hover]:no-underline">
        {looksLikeHtml ? (
          // The body has been DOMPurify-sanitised kernel-side (T5 added
          // isomorphic-dompurify as a dep). Safe to render directly.
          <div dangerouslySetInnerHTML={{ __html: data.body }} />
        ) : (
          <div className="whitespace-pre-wrap text-muted-foreground">{data.body}</div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
