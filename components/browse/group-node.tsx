"use client";
import { memo, useState } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
export interface GroupNodeData {
  label: string; color: string; count: number; collapsed: boolean;
  onRename: (label: string) => void; onToggleCollapse: () => void;
  [key: string]: unknown;
}
export type GroupFlowNode = Node<GroupNodeData, "group">;
export const GroupNode = memo(function GroupNode({ data }: NodeProps<GroupFlowNode>) {
  const [editing, setEditing] = useState(false);
  const color = data.color || "#c9a227";
  return (
    <div className="w-full h-full rounded-lg pointer-events-none" style={{ border: `2px solid ${color}`, background: `${color}10` }}>
      <div className="flex items-center gap-2 px-2 py-1 text-xs pointer-events-auto cursor-move" style={{ color }}>
        <button type="button" onClick={data.onToggleCollapse} title={data.collapsed ? "Expand" : "Collapse"}>
          {data.collapsed ? "▸" : "▾"}
        </button>
        {editing ? (
          <input autoFocus defaultValue={data.label} className="bg-transparent border-b outline-none text-xs"
            onBlur={(e) => { data.onRename(e.target.value); setEditing(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        ) : (
          <span onDoubleClick={() => setEditing(true)} className="font-semibold">
            {data.label || "Group"} <span className="opacity-60">· {data.count}</span>
          </span>
        )}
      </div>
    </div>
  );
});
