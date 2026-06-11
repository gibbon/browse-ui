import { edgeFromRow, nodeFromRow } from "@/lib/browse-types";
import { proxyPost } from "@/lib/kernel";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const data = await proxyPost(
      `/api/browse/sessions/${encodeURIComponent(id)}/endpoints/detail`,
      body,
    ) as {
      node: Record<string, unknown>;
      edge: Record<string, unknown>;
    };
    return Response.json({
      node: nodeFromRow(data.node),
      edge: edgeFromRow(data.edge),
    });
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
