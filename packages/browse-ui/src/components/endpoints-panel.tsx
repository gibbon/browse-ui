"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "../ui/button";
import type {
  BrowseEndpointAnalysis,
  BrowseEndpointObservation,
  BrowseEndpointSignature,
  BrowseNode,
} from "../lib/browse-types";

interface EndpointsPanelProps {
  sessionId: string;
  nodes: BrowseNode[];
  onClose: () => void;
}

export function EndpointsPanel({ sessionId, nodes, onClose }: EndpointsPanelProps) {
  const [signatures, setSignatures] = useState<BrowseEndpointSignature[]>([]);
  const [observations, setObservations] = useState<BrowseEndpointObservation[]>([]);
  const [filter, setFilter] = useState<"useful" | "all" | "noise">("useful");
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisModel, setAnalysisModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, BrowseEndpointAnalysis>>({});

  const nodeTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) {
      m.set(n.id, n.title || hostOf(n.url) || n.url);
    }
    return m;
  }, [nodes]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/browse/sessions/${encodeURIComponent(sessionId)}/endpoints`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        signatures?: BrowseEndpointSignature[];
        observations?: BrowseEndpointObservation[];
      };
      setSignatures(data.signatures ?? []);
      setObservations(data.observations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const analyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`/api/browse/sessions/${encodeURIComponent(sessionId)}/endpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json() as {
        analyses?: BrowseEndpointAnalysis[];
        model?: string | null;
        error?: unknown;
      };
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
      const next: Record<string, BrowseEndpointAnalysis> = {};
      for (const item of data.analyses ?? []) next[item.signatureId] = item;
      setAnalyses(next);
      setAnalysisModel(data.model ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onEndpointRefresh = () => void load();
    window.addEventListener("rdan-browse-endpoints-refresh", onEndpointRefresh);
    return () => window.removeEventListener("rdan-browse-endpoints-refresh", onEndpointRefresh);
  }, [load]);

  const visible = signatures.filter((sig) => {
    const isNoise = sig.deterministicKind === "analytics" || sig.deterministicKind === "noise" || sig.deterministicKind === "media";
    if (filter === "noise") return isNoise;
    if (filter === "useful") return !isNoise;
    return true;
  });
  const usefulCount = signatures.filter((s) => !["analytics", "noise", "media"].includes(s.deterministicKind)).length;
  const noiseCount = signatures.length - usefulCount;

  return (
    <aside className="flex flex-col h-full w-[420px] border-l border-card-border bg-card/95 backdrop-blur shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-accent">Endpoints</div>
          <div className="text-[11px] text-muted-foreground">
            {signatures.length} signatures · {observations.length} requests
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => void analyze()} disabled={analyzing || signatures.length === 0}>
            {analyzing ? "Analyzing" : "Analyze"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? "..." : "Refresh"}
          </Button>
          <Button size="iconXs" variant="ghost" onClick={onClose} title="Close">
            x
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 px-3 py-2 border-b border-card-border text-xs">
        <FilterButton active={filter === "useful"} onClick={() => setFilter("useful")}>
          Useful {usefulCount}
        </FilterButton>
        <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
          All {signatures.length}
        </FilterButton>
        <FilterButton active={filter === "noise"} onClick={() => setFilter("noise")}>
          Noise {noiseCount}
        </FilterButton>
        {analysisModel && (
          <span className="ml-auto truncate text-[11px] text-muted-foreground" title={analysisModel}>
            model: {analysisModel}
          </span>
        )}
      </div>

      {error && (
        <div className="m-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-3 space-y-2">
        {!loading && signatures.length === 0 && (
          <div className="text-xs text-muted-foreground leading-relaxed">
            No endpoint metadata captured yet. Switch a page to Headless or press its refresh button; this panel updates automatically after capture.
          </div>
        )}
        {visible.map((sig) => (
          <EndpointCard
            key={sig.id}
            sig={sig}
            analysis={analyses[sig.id]}
            nodeTitle={nodeTitles.get(sig.nodeId) ?? sig.nodeId}
          />
        ))}
      </div>
    </aside>
  );
}

function EndpointCard({
  sig,
  analysis,
  nodeTitle,
}: {
  sig: BrowseEndpointSignature;
  analysis?: BrowseEndpointAnalysis;
  nodeTitle: string;
}) {
  return (
    <div className="rounded border border-card-border bg-background/50 px-3 py-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold truncate" title={`${sig.method} ${sig.origin}${sig.pathPattern}`}>
            <span className="text-accent">{sig.method}</span> {sig.pathPattern}
          </div>
          <div className="text-[11px] text-muted-foreground truncate" title={sig.origin}>
            {sig.origin}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-semibold">{sig.importanceScore}</div>
          <div className="text-[10px] text-muted-foreground">score</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge>{sig.deterministicKind}</Badge>
        {sig.resourceTypes.map((t) => <Badge key={t}>{t}</Badge>)}
        {sig.statuses.slice(0, 4).map((s) => <Badge key={s}>{s}</Badge>)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <div title={nodeTitle} className="truncate">node: {nodeTitle}</div>
        <div>{sig.observationCount} calls</div>
        <div>{sig.avgDurationMs !== null ? `${sig.avgDurationMs}ms avg` : "duration n/a"}</div>
        <div>{sig.maxEncodedBodySize !== null ? formatBytes(sig.maxEncodedBodySize) : "size n/a"}</div>
      </div>
      {sig.queryKeys.length > 0 && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          query: {sig.queryKeys.join(", ")}
        </div>
      )}
      {sig.contentTypes.length > 0 && (
        <div className="mt-1 text-[11px] text-muted-foreground truncate" title={sig.contentTypes.join(", ")}>
          content: {sig.contentTypes.join(", ")}
        </div>
      )}
      {analysis && (
        <div className="mt-2 border-t border-card-border pt-2 text-[11px] leading-relaxed">
          <div className="flex items-center gap-1">
            <Badge>{analysis.importance}</Badge>
            <span className="text-muted-foreground">
              {Math.round(analysis.confidence * 100)}% confidence
            </span>
          </div>
          <div className="mt-1 text-foreground">{analysis.summary}</div>
          <div className="mt-1 text-muted-foreground">{analysis.inferredPurpose}</div>
          {analysis.suggestedUses.length > 0 && (
            <div className="mt-1 text-muted-foreground">
              uses: {analysis.suggestedUses.join("; ")}
            </div>
          )}
          {analysis.risks.length > 0 && (
            <div className="mt-1 text-muted-foreground">
              risks: {analysis.risks.join("; ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2 py-1 ${active ? "border-primary bg-primary/15 text-foreground" : "border-card-border text-muted-foreground hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-card-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
