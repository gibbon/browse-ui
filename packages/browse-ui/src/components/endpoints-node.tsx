"use client";

import { memo, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import { Button } from "../ui/button";
import type { BrowseEndpointAnalysis, BrowseEndpointSignature } from "../lib/browse-types";

export interface EndpointsNodeData extends Record<string, unknown> {
  endpointNodeId: string;
  sessionId: string;
  parentNodeId: string;
  parentTitle: string | null;
  signatures: BrowseEndpointSignature[];
  onClose: () => void;
  onOpenDetail: (signatureId: string) => void;
}

export type EndpointsFlowNode = Node<EndpointsNodeData, "endpoints">;

export const EndpointsNode = memo(EndpointsNodeImpl, (prev, next) =>
  prev.id === next.id && prev.data === next.data && prev.selected === next.selected,
);

function EndpointsNodeImpl({ data }: NodeProps<EndpointsFlowNode>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, BrowseEndpointAnalysis>>({});

  const usefulCount = useMemo(
    () => data.signatures.filter((s) => !["analytics", "noise", "media"].includes(s.deterministicKind)).length,
    [data.signatures],
  );

  async function analyze() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/browse/sessions/${encodeURIComponent(data.sessionId)}/endpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: data.parentNodeId }),
      });
      const json = await res.json() as { analyses?: BrowseEndpointAnalysis[]; error?: unknown };
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : `HTTP ${res.status}`);
      const next: Record<string, BrowseEndpointAnalysis> = {};
      for (const item of json.analyses ?? []) next[item.signatureId] = item;
      setAnalyses(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="bg-card border border-card-border rounded shadow flex flex-col text-sm w-full h-full"
      style={{ minWidth: 360, minHeight: 280 }}
    >
      <NodeResizer
        minWidth={360}
        minHeight={280}
        lineClassName="!border-primary/50"
        handleClassName="!bg-primary !border-card !w-2 !h-2"
      />
      <Handle type="target" position={Position.Left} />
      <div className="px-3 py-2 border-b border-card-border shrink-0 relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onClose();
          }}
          aria-label="close"
          title="Close"
          className="absolute top-1 right-1 w-5 h-5 rounded text-muted-foreground hover:text-foreground hover:bg-card-border/50 cursor-pointer leading-none text-base"
        >
          x
        </button>
        <div className="text-xs text-muted-foreground truncate pr-6" title={data.parentTitle ?? data.parentNodeId}>
          {data.parentTitle ?? "Page"}
        </div>
        <div className="text-base font-semibold leading-tight pr-6">Endpoints</div>
        <div className="text-[11px] text-muted-foreground">
          {usefulCount} useful / {data.signatures.length} captured
        </div>
      </div>

      <div className="px-3 py-2 border-b border-card-border shrink-0 flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void analyze()} disabled={busy || data.signatures.length === 0}>
          {busy ? "Analyzing" : "Analyze"}
        </Button>
        {error && <span className="text-[11px] text-destructive truncate">{error}</span>}
      </div>

      <div className="nowheel nodrag flex-1 min-h-0 overflow-auto p-2 space-y-2">
        {data.signatures.slice(0, 12).map((sig) => (
          <EndpointRow
            key={sig.id}
            sig={sig}
            analysis={analyses[sig.id]}
            onOpen={() => data.onOpenDetail(sig.id)}
          />
        ))}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function EndpointRow({
  sig,
  analysis,
  onOpen,
}: {
  sig: BrowseEndpointSignature;
  analysis?: BrowseEndpointAnalysis;
  onOpen: () => void;
}) {
  const muted = sig.deterministicKind === "analytics" || sig.deterministicKind === "noise" || sig.deterministicKind === "media";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className={`block w-full text-left rounded border border-card-border px-2 py-1.5 text-xs cursor-pointer hover:border-primary/60 ${muted ? "bg-background/25 opacity-75" : "bg-background/50"}`}
      title="Open endpoint detail pane"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate" title={`${sig.method} ${sig.origin}${sig.pathPattern}`}>
            <span className="text-accent">{sig.method}</span> {sig.pathPattern}
          </div>
          <div className="text-[10px] text-muted-foreground truncate" title={sig.origin}>
            {sig.origin}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-semibold">{sig.importanceScore}</div>
          <div className="text-[9px] text-muted-foreground">score</div>
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
        <Badge>{analysis?.importance ?? sig.deterministicKind}</Badge>
        {sig.resourceTypes.slice(0, 2).map((t) => <Badge key={t}>{t}</Badge>)}
        {sig.statuses.slice(0, 2).map((s) => <Badge key={s}>{s}</Badge>)}
        <Badge>{sig.observationCount}x</Badge>
      </div>
      {analysis && (
        <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
          <div className="text-foreground">{analysis.summary}</div>
          {analysis.suggestedUses.length > 0 && (
            <div>uses: {analysis.suggestedUses.slice(0, 2).join("; ")}</div>
          )}
        </div>
      )}
    </button>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-card-border bg-card-border/25 px-1 py-0.5 text-muted-foreground">
      {children}
    </span>
  );
}
