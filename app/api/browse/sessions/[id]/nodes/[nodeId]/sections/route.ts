// Proxy POST /api/browse/sessions/:id/nodes/:nodeId/sections to the
// kernel — the section-chip click path in PageNode hits this URL to
// pop out a DOM landmark as a media-kind=section child node.
import { proxyPost } from "@/lib/kernel";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; nodeId: string }> },
) {
  try {
    const { id, nodeId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const data = await proxyPost(
      `/api/browse/sessions/${encodeURIComponent(id)}/nodes/${encodeURIComponent(nodeId)}/sections`,
      body,
    );
    return Response.json(data);
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
