"use client";

import { memo } from "react";
import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";

export interface GeneratedViewPayload {
  kind: "table" | "json-explorer" | "html";
  sourceNodeId: string;
  request?: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
    credentialMode?: "anonymous" | "browser-context";
  };
  result?: {
    status: number;
    statusText: string;
    durationMs: number;
    finalUrl: string;
    headers: Record<string, string>;
    bodySample: string;
    bodyTruncated: boolean;
    contentType: string | null;
  };
  table?: {
    path: string[];
    columns: { key: string; label: string; path: string[] }[];
    rows: Record<string, string>[];
    totalRows: number;
    truncated: boolean;
  };
  json?: unknown;
  html?: string;
}

export interface GeneratedViewNodeData extends Record<string, unknown> {
  payload: GeneratedViewPayload;
  onClose: () => void;
}

export type GeneratedViewFlowNode = Node<GeneratedViewNodeData, "generatedView">;

export const GeneratedViewNode = memo(GeneratedViewNodeImpl, (prev, next) =>
  prev.id === next.id && prev.data === next.data && prev.selected === next.selected,
);

function GeneratedViewNodeImpl({ data }: NodeProps<GeneratedViewFlowNode>) {
  const payload = data.payload;
  const title = payload.kind === "table"
    ? "generated table"
    : payload.kind === "json-explorer"
      ? "generated json"
      : "generated html";
  return (
    <div
      className="bg-card border border-card-border rounded shadow flex flex-col text-sm w-full h-full"
      style={{ minWidth: 520, minHeight: 360 }}
    >
      <NodeResizer minWidth={520} minHeight={360} />
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
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
        <div className="text-base font-semibold leading-tight pr-6 truncate">
          {payload.request ? `${payload.request.method} ${statusLabel(payload)}` : statusLabel(payload)}
        </div>
        {payload.request?.url && (
          <div className="text-[11px] text-muted-foreground truncate">{payload.request.url}</div>
        )}
      </div>

      <div className="nowheel nodrag select-text cursor-text flex-1 min-h-0 overflow-auto p-3 text-xs">
        {payload.kind === "table" && payload.table && <GeneratedTable table={payload.table} />}
        {payload.kind === "json-explorer" && (
          <pre className="min-h-full rounded bg-black/30 p-2 text-[11px] leading-snug whitespace-pre-wrap break-words">
            {JSON.stringify(payload.json ?? null, null, 2)}
          </pre>
        )}
        {payload.kind === "html" && (
          <iframe
            title="generated html"
            sandbox=""
            srcDoc={payload.html ?? ""}
            className="h-full min-h-[280px] w-full rounded border border-card-border bg-white"
          />
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function GeneratedTable({ table }: { table: NonNullable<GeneratedViewPayload["table"]> }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span>{table.path.length ? table.path.join(".") : "root"}</span>
        <span>{table.rows.length}/{table.totalRows} rows{table.truncated ? " shown" : ""}</span>
      </div>
      <div className="overflow-auto rounded border border-card-border">
        <table className="w-full border-collapse text-left text-[11px]">
          <thead className="bg-background/80 text-muted-foreground">
            <tr>
              {table.columns.map((column) => (
                <th key={column.key} className="border-b border-card-border px-2 py-1 font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, idx) => (
              <tr key={idx} className="odd:bg-background/30">
                {table.columns.map((column) => (
                  <td key={column.key} className="max-w-64 border-b border-card-border/60 px-2 py-1 align-top">
                    <span className="block max-h-24 overflow-auto whitespace-pre-wrap break-words">
                      {row[column.key] ?? ""}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function statusLabel(payload: GeneratedViewPayload): string {
  if (!payload.result) return "view";
  return `${payload.result.status} ${payload.result.statusText}`;
}

export function parseGeneratedViewPayload(raw: string | null): GeneratedViewPayload {
  if (!raw) return { kind: "json-explorer", sourceNodeId: "", json: null };
  try {
    const parsed = JSON.parse(raw) as GeneratedViewPayload;
    if (parsed.kind === "table" || parsed.kind === "json-explorer" || parsed.kind === "html") {
      return parsed;
    }
  } catch {}
  return { kind: "json-explorer", sourceNodeId: "", json: null };
}
