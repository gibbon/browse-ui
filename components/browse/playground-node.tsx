"use client";

import { memo } from "react";
import type { ReactNode } from "react";
import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { writeDragExtractData } from "./drag-extract";

export interface PlaygroundSuggestion {
  name: string;
  description: string;
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface PlaygroundResult {
  status: number;
  statusText: string;
  durationMs: number;
  finalUrl: string;
  headers: Record<string, string>;
  bodySample: string;
  bodyTruncated: boolean;
  contentType: string | null;
}

export interface PlaygroundNodeData extends Record<string, unknown> {
  kind: "result" | "suggestions";
  request?: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
    credentialMode?: "anonymous" | "browser-context";
  };
  result?: PlaygroundResult;
  suggestions?: PlaygroundSuggestion[];
  model?: string | null;
  onClose: () => void;
  onApplySuggestion?: (suggestion: PlaygroundSuggestion, sourceNodeId: string) => void;
  onGenerateView?: (sourceNodeId: string) => void | Promise<void>;
}

export type PlaygroundFlowNode = Node<PlaygroundNodeData, "playground">;

export const PlaygroundNode = memo(PlaygroundNodeImpl, (prev, next) =>
  prev.id === next.id && prev.data === next.data && prev.selected === next.selected,
);

function PlaygroundNodeImpl({ id, data }: NodeProps<PlaygroundFlowNode>) {
  return (
    <div
      className="bg-card border border-card-border rounded shadow flex flex-col text-sm w-full h-full"
      style={{ minWidth: 420, minHeight: 360 }}
    >
      <NodeResizer minWidth={420} minHeight={360} />
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
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {data.kind === "result" ? "playground result" : "playground suggestions"}
        </div>
        <div className="text-base font-semibold leading-tight pr-6 truncate">
          {data.kind === "result" && data.result ? `${data.result.status} ${data.result.statusText}` : `${data.suggestions?.length ?? 0} suggestions`}
        </div>
        {data.model && <div className="text-[11px] text-muted-foreground truncate">{data.model}</div>}
      </div>

      <div className="nowheel nodrag select-text cursor-text flex-1 min-h-0 overflow-auto p-3 space-y-3 text-xs">
        {data.kind === "result" && data.result && (
          <>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => data.onGenerateView?.(id)}
              >
                Generate view
              </Button>
            </div>
            {data.request && (
              <Section title="Request">
                <KV label="Method" value={data.request.method} />
                <KV label="Mode" value={data.request.credentialMode === "anonymous" ? "Anonymous" : "Current browse session"} />
                <KV label="URL" value={data.request.url} />
                <HeaderBlock title="Headers" headers={data.request.headers} />
                {data.request.body && <CodeBlock title="Body" body={data.request.body} />}
              </Section>
            )}
            <Section title="Response">
              <KV label="Status" value={`${data.result.status} ${data.result.statusText}`} />
              <KV label="Time" value={`${data.result.durationMs}ms`} />
              <KV label="Final URL" value={data.result.finalUrl} />
              <KV label="Content" value={data.result.contentType ?? "n/a"} />
              <HeaderBlock title="Headers" headers={data.result.headers} />
              <CodeBlock
                title={`Body${data.result.bodyTruncated ? " (truncated)" : ""}`}
                body={data.result.bodySample}
              />
            </Section>
          </>
        )}

        {data.kind === "suggestions" && (
          <div className="space-y-2">
            {(data.suggestions ?? []).map((suggestion, idx) => (
              <div key={`${suggestion.name}-${idx}`} className="rounded border border-card-border bg-background/40 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground">{suggestion.name}</div>
                    <div className="text-muted-foreground">{suggestion.description}</div>
                    <div className="mt-1 font-mono text-[10px] text-muted-foreground break-words">
                      {suggestion.method} {suggestion.url}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => data.onApplySuggestion?.(suggestion, id)}
                  >
                    Apply
                  </Button>
                </div>
                {suggestion.body && <CodeBlock title="Body" body={suggestion.body} />}
              </div>
            ))}
          </div>
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

export function parsePlaygroundPayload(raw: string | null): PlaygroundNodeData {
  if (!raw) return { kind: "result", onClose: () => {} };
  try {
    const parsed = JSON.parse(raw) as {
      request?: PlaygroundNodeData["request"];
      result?: PlaygroundResult;
      suggestions?: PlaygroundSuggestion[];
      model?: string | null;
    };
    if (Array.isArray(parsed.suggestions)) {
      return {
        kind: "suggestions",
        suggestions: parsed.suggestions,
        model: parsed.model ?? null,
        onClose: () => {},
      };
    }
    return {
      kind: "result",
      request: parsed.request,
      result: parsed.result,
      onClose: () => {},
    };
  } catch {
    return { kind: "result", onClose: () => {} };
  }
}
