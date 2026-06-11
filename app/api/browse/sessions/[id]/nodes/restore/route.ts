// Pass-through for the Undo-Hide affordance. Posts the captured node
// + edge IDs from the most recent hide back to the kernel, which
// re-emits a fresh active version of each.
import { proxyPost } from "@/lib/kernel";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = await request.json();
    const data = await proxyPost(
      `/api/browse/sessions/${encodeURIComponent(id)}/nodes/restore`,
      body,
    );
    return Response.json(data);
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
