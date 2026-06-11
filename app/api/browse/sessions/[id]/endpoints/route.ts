import { proxyGet, proxyPost } from "@/lib/kernel";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const nodeId = url.searchParams.get("nodeId");
    const qs = nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : "";
    const data = await proxyGet(
      `/api/browse/sessions/${encodeURIComponent(id)}/endpoints${qs}`,
    );
    return Response.json(data);
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { nodeId?: string };
    const data = await proxyPost(
      `/api/browse/sessions/${encodeURIComponent(id)}/endpoints/analyze`,
      {
        ...(typeof body.nodeId === "string" && body.nodeId ? { nodeId: body.nodeId } : {}),
      },
    );
    return Response.json(data);
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
