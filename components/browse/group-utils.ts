import type { BrowseGroupMember } from "@/lib/browse-types";
export function membersByGroup(members: BrowseGroupMember[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const m of members) {
    if (m.status !== "active") continue;
    const list = map.get(m.groupId) ?? [];
    list.push(m.nodeId);
    map.set(m.groupId, list);
  }
  return map;
}
export interface Bounds { x: number; y: number; width: number; height: number; }
export function computeFrameBounds(
  nodeIds: string[],
  placement: Map<string, { x: number; y: number; width: number; height: number }>,
  pad = 24,
): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of nodeIds) {
    const p = placement.get(id);
    if (!p) continue;
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width); maxY = Math.max(maxY, p.y + p.height);
  }
  if (minX === Infinity) return null;
  return { x: minX - pad, y: minY - pad, width: (maxX - minX) + pad * 2, height: (maxY - minY) + pad * 2 };
}
export function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
export interface GroupFrameRect { groupId: string; x: number; y: number; width: number; height: number; }
export function hitTestGroup(
  point: { x: number; y: number },
  frames: GroupFrameRect[],
): string | null {
  for (const f of frames) {
    if (point.x >= f.x && point.x <= f.x + f.width && point.y >= f.y && point.y <= f.y + f.height) {
      return f.groupId;
    }
  }
  return null;
}
