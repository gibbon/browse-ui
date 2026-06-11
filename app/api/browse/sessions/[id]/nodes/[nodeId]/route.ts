import { proxyDelete } from "@/lib/kernel";

// Pass-through for closing/deleting a single browse node. The kernel
// cascades to all descendants reachable through active edges and
// returns { deletedNodeIds, deletedEdgeIds } so the canvas can update
// its optimistic state without a full session refetch.

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; nodeId: string }> },
) {
  try {
    const { id, nodeId } = await ctx.params;
    const data = await proxyDelete(
      `/api/browse/sessions/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}`,
    );
    return Response.json(data);
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
