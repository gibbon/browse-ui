// Proxy POST /api/browse/nodes/:id/summarize through to the kernel.
import { proxyPost } from "@/lib/kernel";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    let body: { mode?: "basic" | "detailed" } = {};
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text);
    } catch {
      // Empty / malformed body — fall back to {}.
    }
    const data = await proxyPost(
      `/api/browse/nodes/${encodeURIComponent(id)}/summarize`,
      body,
    );
    return Response.json(data);
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
