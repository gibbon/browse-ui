import { groupFromRow } from "@/lib/browse-types";
import { proxyPost } from "@/lib/kernel";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const data = await proxyPost(
      `/api/browse/sessions/${encodeURIComponent(id)}/groups`,
      body,
    ) as { group: Record<string, unknown> };
    return Response.json({ group: groupFromRow(data.group) });
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
