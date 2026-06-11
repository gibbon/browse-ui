"use client";

// Row of clickable chips for each detected DOM landmark on a page node.
// Click → POSTs to the kernel to spawn a section pop-out node + edge.
// Empty / undefined sections array → renders nothing.

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { DetectedSection } from "@/lib/browse-types";

interface Props {
  sections?: DetectedSection[];
  sessionId: string;
  nodeId: string;
  /** Called after a successful pop-out so the canvas can show optimistic
   *  state or trigger a refresh. */
  onPopped?: () => void;
}

export function SectionChips({ sections, sessionId, nodeId, onPopped }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!sections || sections.length === 0) return null;

  async function popOut(s: DetectedSection) {
    setBusy(s.landmark);
    try {
      const res = await fetch(
        `/api/browse/sessions/${encodeURIComponent(sessionId)}/nodes/${encodeURIComponent(nodeId)}/sections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ landmark: s.landmark, selector: s.selector }),
        },
      );
      if (!res.ok) throw new Error(`POST returned ${res.status}`);
      onPopped?.();
      // Bump the canvas's poll-tick so the new section pop-out node
      // appears immediately. Without this, the request succeeds
      // server-side but rdanNodes only catches up on the next
      // background poll — which only fires if something's pending.
      window.dispatchEvent(new CustomEvent("rdan-browse-refetch"));
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(`Pop-out failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-1 px-2 py-1">
      {sections.map((s) => (
        <button
          key={s.landmark}
          type="button"
          disabled={busy === s.landmark}
          onClick={(e) => {
            e.stopPropagation();
            void popOut(s);
          }}
          title={s.textPreview}
        >
          <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-card-border/60">
            {busy === s.landmark ? `${s.landmark}…` : s.landmark}
          </Badge>
        </button>
      ))}
    </div>
  );
}
