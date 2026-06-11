"use client";

// Right-docked "Assistant" panel for the browse canvas. A focused chat: ask
// questions about the open pages, or instruct it to act on the canvas — hide/
// show cards, group + recolour, relayout/arrange, highlight. The assistant
// replies in prose and may emit validated actions the canvas applies.
//
// Presentational only: the canvas owns chat state + the send/apply wiring.
// This is SEPARATE from the general r.dan chat drawer (which delegates to
// agents); this one drives the canvas directly.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Canvas actions a chat reply can carry. Mirrors the kernel's BrowseChatAction;
 *  the canvas applies each. Server-validated. */
export type BrowseChatAction =
  | { type: "hideNodes"; nodeIds: string[] }
  | { type: "showNodes" }
  | { type: "createGroup"; nodeIds: string[]; label: string; color?: string }
  | { type: "updateGroup"; groupId: string; label?: string; color?: string }
  | { type: "collapseGroups"; groupIds: string[]; collapsed: boolean }
  | { type: "relayout" }
  | { type: "arrange"; op: string }
  | { type: "highlight"; nodeId: string };

interface BrowseAssistantPanelProps {
  onClose: () => void;
  messages: ChatMessage[];
  busy: boolean;
  onSend: (text: string) => void;
}

export function BrowseAssistantPanel({
  onClose,
  messages,
  busy,
  onSend,
}: BrowseAssistantPanelProps) {
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, busy]);

  const submit = () => {
    const t = draft.trim();
    if (!t || busy) return;
    onSend(t);
    setDraft("");
  };

  return (
    <div className="flex flex-col h-full w-[340px] border-l border-card-border bg-card/95 backdrop-blur shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border">
        <span className="text-sm font-bold text-accent">✦ Canvas assistant</span>
        <Button size="iconXs" variant="ghost" onClick={onClose} title="Close">
          ✕
        </Button>
      </div>

      <div ref={threadRef} className="flex-1 overflow-auto p-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground/70">
            Ask about the open pages, or tell me to tidy the canvas — e.g.
            &ldquo;hide the pricing page&rdquo;, &ldquo;group the news sites into
            a Reading cluster&rdquo;, &ldquo;make that group blue&rdquo;,
            &ldquo;tidy the layout&rdquo;, &ldquo;highlight the docs page&rdquo;.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-6 rounded bg-primary/15 border border-primary/30 px-2.5 py-1.5 text-xs"
                : "mr-6 rounded bg-card-border/30 border border-card-border px-2.5 py-1.5 text-xs whitespace-pre-wrap"
            }
          >
            {m.content}
          </div>
        ))}
        {busy && (
          <div className="mr-6 text-xs text-muted-foreground animate-pulse">
            thinking…
          </div>
        )}
      </div>

      <form
        className="flex items-center gap-1 p-2 border-t border-card-border"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask or instruct…"
          className="h-8 text-xs"
          disabled={busy}
        />
        <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
