"use client";

// /browse/<sessionId> — canvas page for a single browse session. Loads
// the session bundle (session + nodes + edges), the persisted viewport,
// and the caller's session list in parallel, then hands them to the
// xyflow Canvas + SessionSidebar. No auth checks needed in standalone mode.

import { useEffect, useState } from "react";
import { useParams, notFound } from "next/navigation";
import { Canvas } from "@/components/browse/canvas";
import { SessionSidebar } from "@/components/browse/session-sidebar";
import type {
  BrowseSession,
  BrowseNode,
  BrowseEdge,
  BrowseViewport,
  BrowseGroup,
  BrowseGroupMember,
} from "@/lib/browse-types";

interface SessionBundle {
  session: BrowseSession;
  nodes: BrowseNode[];
  edges: BrowseEdge[];
  groups: BrowseGroup[];
  groupMembers: BrowseGroupMember[];
}

export default function BrowseCanvasPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [viewport, setViewport] = useState<BrowseViewport | null>(null);
  const [sessionsList, setSessionsList] = useState<BrowseSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFoundFlag, setNotFoundFlag] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [sessRes, vpRes, listRes] = await Promise.all([
          fetch(`/api/browse/sessions/${sessionId}`),
          fetch(`/api/browse/sessions/${sessionId}/viewport`),
          fetch(`/api/browse/sessions`),
        ]);

        if (sessRes.status === 404) {
          if (!cancelled) {
            setNotFoundFlag(true);
            setLoading(false);
          }
          return;
        }
        if (!sessRes.ok) {
          throw new Error((await sessRes.text()) || `HTTP ${sessRes.status}`);
        }

        const sessJson = (await sessRes.json()) as SessionBundle;
        const vp = vpRes.ok ? ((await vpRes.json()) as BrowseViewport) : null;
        const list = listRes.ok
          ? ((await listRes.json()) as { sessions?: BrowseSession[] }).sessions ?? []
          : [];

        if (!cancelled) {
          setBundle(sessJson);
          setViewport(vp);
          setSessionsList(list);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (notFoundFlag) notFound();
  if (loading) {
    return (
      <div className="text-muted-foreground text-sm">Loading session…</div>
    );
  }
  if (error) {
    return <div className="text-destructive text-sm">{error}</div>;
  }
  if (!bundle) {
    return <div className="text-muted-foreground text-sm">No data.</div>;
  }

  return (
    <div className="flex h-full -m-6 min-h-0">
      <SessionSidebar sessions={sessionsList} currentId={sessionId} />
      <div className="flex flex-col flex-1 min-w-0">
        {bundle.session.status === "archived" && (
          <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-600 text-xs px-3 py-1.5 flex items-center gap-2">
            <span>This session is archived.</span>
            <button
              type="button"
              onClick={async () => {
                try {
                  await fetch(`/api/browse/sessions/${encodeURIComponent(sessionId)}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "active" }),
                  });
                  window.location.reload();
                } catch (err) {
                  // eslint-disable-next-line no-alert
                  window.alert(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              }}
              className="underline hover:no-underline"
            >
              Restore
            </button>
          </div>
        )}
        <Canvas
          initialSession={bundle.session}
          initialNodes={bundle.nodes}
          initialEdges={bundle.edges}
          initialViewport={viewport}
          initialGroups={bundle.groups ?? []}
          initialGroupMembers={bundle.groupMembers ?? []}
        />
      </div>
    </div>
  );
}
