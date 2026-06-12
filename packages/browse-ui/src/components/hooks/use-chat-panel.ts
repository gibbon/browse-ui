"use client";

// Chat-panel state for the browse canvas's → Chat surface. Each open
// creates a fresh r.dan chat session and points the embedded iframe at
// it with a `?prefill=` query carrying the quoted reference block.
// Returns the current panel state + open/close/pin commands.

import { useCallback, useState } from "react";
import { CLOSED_PANEL, type ChatPanelState } from "../chat-panel";

export function useChatPanel() {
  const [state, setState] = useState<ChatPanelState>(CLOSED_PANEL);

  const open = useCallback(async (prefill: string, opts?: { agent?: string; labelPrefix?: string }) => {
    // Direct-route to a specific agent (default r.dan). Use case:
    // ✦ Customise → pi-coder so the chat doesn't depend on r.dan
    // deciding to delegate (which can fail under fallback models
    // that emit delegation prose without firing the tool).
    const agent = opts?.agent ?? "r.dan";
    const labelPrefix = opts?.labelPrefix ?? "browse";
    // Time-stamped label keeps the new session sortable in the chat
    // sidebar without colliding with same-second siblings (the kernel
    // returns 409 on duplicate label and we'd lose the prefill).
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const label = `${labelPrefix} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    try {
      const res = await fetch(`/api/rdan/agents/${encodeURIComponent(agent)}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "dashboard", label }),
      });
      if (!res.ok) throw new Error(`session create returned ${res.status}`);
      const { sessionId } = (await res.json()) as { sessionId: string };
      setState((prev) => ({
        open: true,
        chatSessionId: sessionId,
        prefill,
        pinned: prev.pinned,
        agent,
      }));
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(`Couldn't open chat: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...CLOSED_PANEL, pinned: prev.pinned }));
  }, []);

  const togglePin = useCallback(() => {
    setState((prev) => ({ ...prev, pinned: !prev.pinned }));
  }, []);

  return { state, open, close, togglePin };
}
