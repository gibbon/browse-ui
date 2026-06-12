"use client";

import { memo, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import type { BrowseEndpointObservation, BrowseEndpointSignature } from "../lib/browse-types";
import { Button } from "../ui/button";
import { writeDragExtractData } from "./drag-extract";

export interface EndpointDetailNodeData extends Record<string, unknown> {
  detailNodeId: string;
  signature: BrowseEndpointSignature | null;
  observations: BrowseEndpointObservation[];
  onClose: () => void;
  onRunPlayground?: (request: EndpointPlaygroundRequest) => Promise<void>;
  onSuggestPlayground?: (input: { parentNodeId: string; signatureId: string; sourceNodeId: string }) => Promise<void>;
}

export type EndpointDetailFlowNode = Node<EndpointDetailNodeData, "endpointDetail">;

export interface EndpointPlaygroundRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  credentialMode: "anonymous" | "browser-context";
  sourceNodeId: string;
}

export const EndpointDetailNode = memo(EndpointDetailNodeImpl, (prev, next) =>
  prev.id === next.id && prev.data === next.data && prev.selected === next.selected,
);

function EndpointDetailNodeImpl({ data }: NodeProps<EndpointDetailFlowNode>) {
  const sig = data.signature;
  const first = data.observations[0];
  const initialUrl = first?.url ?? (sig ? `${sig.origin}${sig.pathPattern}` : "");
  const [method, setMethod] = useState(() => safePlaygroundMethod(sig?.method ?? first?.method));
  const [url, setUrl] = useState(initialUrl);
  const [headersText, setHeadersText] = useState(() => formatJsonBody(JSON.stringify(first?.requestHeaders ?? {}, null, 2)));
  const [bodyText, setBodyText] = useState(first?.requestBodySample ?? "");
  const [credentialMode, setCredentialMode] = useState<"anonymous" | "browser-context">("browser-context");
  const [running, setRunning] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  useEffect(() => {
    setMethod(safePlaygroundMethod(sig?.method ?? first?.method));
    setUrl(first?.url ?? (sig ? `${sig.origin}${sig.pathPattern}` : ""));
    setHeadersText(formatJsonBody(JSON.stringify(first?.requestHeaders ?? {}, null, 2)));
    setBodyText(first?.requestBodySample ?? "");
    setRunError(null);
    setSuggestError(null);
  }, [sig, first]);

  const canHaveBody = method === "POST";

  async function runPlayground() {
    setRunning(true);
    setRunError(null);
    try {
      let headers: Record<string, string> = {};
      if (headersText.trim()) {
        headers = JSON.parse(headersText) as Record<string, string>;
      }
      if (!data.onRunPlayground) throw new Error("playground unavailable");
      await data.onRunPlayground({
        method,
        url,
        headers,
        body: canHaveBody ? bodyText : null,
        credentialMode,
        sourceNodeId: data.detailNodeId,
      });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function suggestCalls() {
    if (!sig) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      if (!data.onSuggestPlayground) throw new Error("playground suggestions unavailable");
      await data.onSuggestPlayground({
        parentNodeId: sig.nodeId,
        signatureId: sig.id,
        sourceNodeId: data.detailNodeId,
      });
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : String(err));
    } finally {
      setSuggesting(false);
    }
  }
  return (
    <div
      className="bg-card border border-card-border rounded shadow flex flex-col text-sm w-full h-full"
      style={{ minWidth: 420, minHeight: 420 }}
    >
      <NodeResizer
        minWidth={420}
        minHeight={420}
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
        <div className="text-xs text-muted-foreground truncate pr-6" title={sig?.origin ?? first?.origin ?? ""}>
          {sig?.origin ?? first?.origin ?? "endpoint"}
        </div>
        <div className="text-base font-semibold leading-tight pr-6 truncate" title={sig ? `${sig.method} ${sig.pathPattern}` : undefined}>
          {sig ? <><span className="text-accent">{sig.method}</span> {sig.pathPattern}</> : "Endpoint Detail"}
        </div>
        {sig && (
          <div className="text-[11px] text-muted-foreground">
            {sig.deterministicKind} · score {sig.importanceScore} · {sig.observationCount} call{sig.observationCount === 1 ? "" : "s"}
          </div>
        )}
      </div>

      <div className="nowheel nodrag select-text cursor-text flex-1 min-h-0 overflow-auto p-3 space-y-3 text-xs">
        {sig && (
          <Section title="Signature">
            <KV label="Resource" value={sig.resourceTypes.join(", ")} />
            <KV label="Statuses" value={sig.statuses.join(", ") || "n/a"} />
            <KV label="Content" value={sig.contentTypes.join(", ") || "n/a"} />
            <KV label="Query keys" value={sig.queryKeys.join(", ") || "none"} />
            <KV label="Average" value={sig.avgDurationMs !== null ? `${sig.avgDurationMs}ms` : "n/a"} />
            <KV label="Max size" value={sig.maxEncodedBodySize !== null ? formatBytes(sig.maxEncodedBodySize) : "n/a"} />
          </Section>
        )}

        {data.observations.map((obs, idx) => (
          <Section key={obs.id} title={`Observation ${idx + 1}`}>
            <KV label="URL" value={obs.url} />
            <KV label="Status" value={obs.status !== null ? String(obs.status) : "n/a"} />
            <KV label="Duration" value={obs.durationMs !== null ? `${obs.durationMs}ms` : "n/a"} />
            <KV label="Size" value={obs.encodedBodySize !== null ? formatBytes(obs.encodedBodySize) : "n/a"} />
            <HeaderBlock title="Request headers" headers={obs.requestHeaders} />
            {obs.requestBodySample && <CodeBlock title="Request body" body={obs.requestBodySample} />}
            <HeaderBlock title="Response headers" headers={obs.responseHeaders} />
            {obs.responseBodySample ? (
              <CodeBlock
                title={`Response preview${obs.responseBodyTruncated ? " (truncated)" : ""}`}
                body={obs.responseBodySample}
              />
            ) : (
              <div className="text-muted-foreground italic">No response preview captured for this request.</div>
            )}
          </Section>
        ))}

        {sig && (
          <Section title="Playground">
            <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
              <select
                value={method}
                onChange={(e) => setMethod(safePlaygroundMethod(e.target.value))}
                className="bg-card border border-card-border rounded px-2 py-1"
              >
                {["GET", "POST"].map((m) => <option key={m}>{m}</option>)}
              </select>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="min-w-0 bg-card border border-card-border rounded px-2 py-1 font-mono text-[11px]"
              />
            </div>
            <label className="block mt-2">
              <div className="mb-1 text-muted-foreground">Credentials</div>
              <select
                value={credentialMode}
                onChange={(e) => setCredentialMode(e.target.value === "anonymous" ? "anonymous" : "browser-context")}
                className="w-full bg-card border border-card-border rounded px-2 py-1"
              >
                <option value="browser-context">Current browse session</option>
                <option value="anonymous">Anonymous</option>
              </select>
            </label>
            <TextAreaBlock title="Headers JSON" value={headersText} onChange={setHeadersText} />
            {canHaveBody && (
              <TextAreaBlock title="Body" value={bodyText} onChange={setBodyText} />
            )}
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void runPlayground()} disabled={running || !url.trim()}>
                {running ? "Running" : "Run"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void suggestCalls()} disabled={suggesting}>
                {suggesting ? "Suggesting" : "Suggest"}
              </Button>
              {runError && <span className="text-[11px] text-destructive">{runError}</span>}
              {suggestError && <span className="text-[11px] text-destructive">{suggestError}</span>}
            </div>
          </Section>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded border border-card-border bg-background/40 p-2">
      <div className="mb-1 font-semibold text-foreground">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words">{value}</div>
    </div>
  );
}

function HeaderBlock({ title, headers }: { title: string; headers?: Record<string, string> | null }) {
  if (!headers || Object.keys(headers).length === 0) return null;
  return <CodeBlock title={title} body={JSON.stringify(headers, null, 2)} />;
}

function CodeBlock({ title, body }: { title: string; body: string }) {
  const formatted = formatJsonBody(body);
  const highlighted = highlightJson(formatted);
  return (
    <div>
      <div className="mt-2 mb-1 text-muted-foreground">{title}</div>
      <pre
        className="nowheel nodrag select-text cursor-text max-h-64 overflow-auto rounded bg-black/30 p-2 text-[11px] leading-snug whitespace-pre-wrap break-words"
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          const selection = window.getSelection()?.toString().trim();
          writeDragExtractData(e.dataTransfer, { kind: "text", text: selection || formatted });
        }}
      >
        {highlighted ?? formatted}
      </pre>
    </div>
  );
}

function TextAreaBlock({
  title,
  value,
  onChange,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block mt-2">
      <div className="mb-1 text-muted-foreground">{title}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="nowheel nodrag select-text min-h-28 w-full resize-y rounded border border-card-border bg-black/30 p-2 font-mono text-[11px] leading-snug"
      />
    </label>
  );
}

function safePlaygroundMethod(method: string | undefined): "GET" | "POST" {
  return method?.toUpperCase() === "POST" ? "POST" : "GET";
}

function formatJsonBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return body;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return body;
  }
}

function highlightJson(body: string): ReactNode | null {
  const trimmed = body.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return null;
  const parts: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*"(?=\s*:))|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let last = 0;
  let idx = 0;
  for (const match of body.matchAll(re)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(body.slice(last, start));
    const token = match[0];
    const cls = match[1]
      ? "text-sky-300"
      : match[2]
        ? "text-emerald-300"
        : match[3]
          ? "text-purple-300"
          : "text-amber-300";
    parts.push(<span key={idx++} className={cls}>{token}</span>);
    last = start + token.length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts.length ? parts : null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
