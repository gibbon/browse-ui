"use client";

// → Chat button — mounted in PageNode / SectionNode / SummaryNode
// toolbars. Captures selection at click time, builds the quoted prefill
// block, and hands off to the ChatPanel via the openChat callback that
// canvas.tsx threads down through node data.

import { useCallback, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import type { BrowseNode } from "@/lib/browse-types";
import { buildPrefill, captureSelection } from "./chat-prefill";

interface Props {
  node: BrowseNode;
  /** Element ref into the node's outer DOM — selection-capture only
   *  accepts text whose range sits inside this element. Without it,
   *  the button would pick up unrelated selections elsewhere. */
  rootRef?: RefObject<HTMLElement | null>;
  /** For page nodes, the same-origin proxy iframe. Selection inside
   *  the iframe wins over selection outside (most page content lives
   *  in the iframe). Pass null/undefined for section / summary tiles. */
  iframeRef?: RefObject<HTMLIFrameElement | null>;
  onOpenChat: (prefill: string) => void;
}

export function ChatTriggerButton({ node, rootRef, iframeRef, onOpenChat }: Props) {
  const onClick = useCallback(() => {
    const selection = captureSelection(rootRef?.current ?? null, iframeRef?.current);
    const prefill = buildPrefill(node, selection);
    onOpenChat(prefill);
  }, [node, rootRef, iframeRef, onOpenChat]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick}
      className="text-[11px]"
      title="Ask r.dan about this (uses selected text if any)"
    >
      → Chat
    </Button>
  );
}
