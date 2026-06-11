import { nodeFromRow } from "@/lib/browse-types";
import { proxyPatch } from "@/lib/kernel";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; nodeId: string }> },
) {
  try {
    const { id, nodeId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const result = await proxyPatch(
      `/api/browse/sessions/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}/refetch`,
      body,
    );
    return Response.json(nodeFromRow(result.data as Record<string, unknown>));
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
