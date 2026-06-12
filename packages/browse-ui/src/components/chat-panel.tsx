"use client";

// Slide-out drawer at the right edge of the browse workspace. Hosts the
// existing /chat page via iframe with ?session=<new>&prefill=<text>,
// so all chat features (sub-agents, delegation, streaming, RichText,
// session-sidebar, etc.) come for free without re-implementing them.
//
// Per spec: new chat session per → Chat click, pinnable, side panel.

import { useCallback, useEffect, useState } from "react";
import { Button } from "../ui/button";

const MIN_WIDTH = 360;
const MAX_WIDTH = 1200;
const DEFAULT_WIDTH = 520;
const WIDTH_STORAGE_KEY = "browse:chat-panel-width";

export interface ChatPanelState {
  open: boolean;
  chatSessionId: string | null;
  prefill: string;
  pinned: boolean;
  /** Which agent owns this session (e.g. "r.dan", "pi-coder").
   *  Surfaces as a chip in the panel header so the user knows
   *  who they're talking to. */
  agent?: string;
}

export const CLOSED_PANEL: ChatPanelState = {
  open: false,
  chatSessionId: null,
  prefill: "",
  pinned: false,
};

interface Props {
  state: ChatPanelState;
  onClose: () => void;
  onTogglePinned: () => void;
}

export function ChatPanel({ state, onClose, onTogglePinned }: Props) {
  const { open, chatSessionId, prefill, pinned, agent } = state;

  // User-resizable: drag the left edge to widen/narrow the drawer.
  // Width persists to localStorage so it survives a reload. Clamped
  // [MIN_WIDTH, MAX_WIDTH] so the drawer can't disappear or fill
  // the whole viewport.
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return DEFAULT_WIDTH;
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    return DEFAULT_WIDTH;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
    // Publish to a CSS variable so canvas.tsx's pinned-padding can read
    // the live width without prop-drilling. Cleared when the panel is
    // closed/unpinned (set to 0px).
    const v = open && pinned ? `${width}px` : "0px";
    document.documentElement.style.setProperty("--browse-chat-panel-width", v);
  }, [width, open, pinned]);

  // On unmount, clear the CSS variable so unmounted panel state doesn't
  // leak padding to the canvas.
  useEffect(() => {
    return () => {
      document.documentElement.style.setProperty("--browse-chat-panel-width", "0px");
    };
  }, []);

  const onResizeStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    document.body.style.cursor = "col-resize";
    const onMove = (mv: MouseEvent) => {
      // Drawer is anchored to the right edge; moving the handle LEFT
      // increases width, RIGHT decreases.
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + (startX - mv.clientX)));
      setWidth(next);
    };
    const onUp = () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width]);

  // Don't render the iframe until the panel is actually opening — the
  // iframe URL needs both session id and prefill query string in place.
  // ?embed=1 → middleware sets x-rdan-embed header → root layout
  // skips Sidebar + Topbar so the iframe shows JUST the chat, no
  // nested dashboard chrome inside our drawer.
  // ?agent=<name> binds the iframe's chat to a specific agent directly,
  // bypassing r.dan's routing layer. Used by the ✦ Customise button to
  // talk to pi-coder without depending on r.dan to delegate (which
  // can silently fail when r.dan's model is in fallback mode).
  const iframeUrl =
    open && chatSessionId
      ? `/chat?session=${encodeURIComponent(chatSessionId)}&prefill=${encodeURIComponent(prefill)}&embed=1`
        + (agent ? `&agent=${encodeURIComponent(agent)}` : "")
      : null;

  return (
    <aside
      data-state={open ? "open" : "closed"}
      style={{ width }}
      className="fixed right-0 top-0 h-full bg-card border-l border-card-border
                 transform transition-transform duration-200
                 data-[state=closed]:translate-x-full data-[state=open]:translate-x-0
                 z-40 flex flex-col shadow-xl"
    >
      {/* Drag handle on the LEFT edge — 6px wide, full height, cursor
          col-resize. Slightly inset so it's grabbable but doesn't
          collide with iframe content. */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize chat panel"
        onMouseDown={onResizeStart}
        className="absolute left-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-accent/30 z-50"
      />
      <header className="flex items-center justify-between px-3 h-10 border-b border-card-border shrink-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-foreground">Chat</span>
          {chatSessionId && (
            <code className="text-[10px] text-muted-foreground truncate max-w-[200px]" title={chatSessionId}>
              {chatSessionId.split(":").slice(-1)[0]}
            </code>
          )}
        </div>
        <div className="flex items-center gap-1">
          {chatSessionId && (
            <a
              href={`/chat?session=${encodeURIComponent(chatSessionId)}`}
              target="_blank"
              rel="noopener"
              className="text-[10px] text-accent hover:underline px-1.5 py-0.5"
              title="Open this chat in a full /chat tab"
            >
              ↗ full
            </a>
          )}
          <Button
            type="button"
            variant="ghost"
            size="iconXs"
            onClick={onTogglePinned}
            title={pinned ? "Unpin — drawer floats over canvas" : "Pin — canvas reserves space for the drawer"}
            aria-pressed={pinned}
          >
            {pinned ? "📌" : "📍"}
          </Button>
          <Button type="button" variant="ghost" size="iconXs" onClick={onClose} title="Close chat panel">
            ×
          </Button>
        </div>
      </header>
      <div className="flex-1 min-h-0">
        {iframeUrl ? (
          <iframe
            // Re-mount whenever the session id changes (new → Chat click =
            // new session = fresh iframe = fresh chat-page mount). Without
            // the key the iframe's src changes but the chat page's state
            // (input, messages, polling) persists from the prior session.
            key={chatSessionId}
            src={iframeUrl}
            className="w-full h-full border-0"
            title="Chat with r.dan"
          />
        ) : (
          <div className="p-4 text-sm text-muted-foreground">No chat open.</div>
        )}
      </div>
    </aside>
  );
}
