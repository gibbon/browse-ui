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
      `/api/browse/sessions/${encodeURIComponent(id)}/generated-views`,
      body,
    ) as Record<string, unknown> & {
      node?: Record<string, unknown>;
      edge?: Record<string, unknown>;
    };
    return Response.json({
      ...data,
      node: data.node ? nodeFromRow(data.node) : undefined,
      edge: data.edge ? edgeFromRow(data.edge) : undefined,
    });
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
