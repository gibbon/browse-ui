import { groupFromRow } from "@/lib/browse-types";
import { proxyPatch } from "@/lib/kernel";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; groupId: string }> }) {
  try {
    const { id, groupId } = await context.params;
    const body = await request.json();
    const result = await proxyPatch(
      `/api/browse/sessions/${encodeURIComponent(id)}/groups/${encodeURIComponent(groupId)}`,
      body,
    );
    const data = result.data as { group: Record<string, unknown> };
    return Response.json({ group: groupFromRow(data.group) });
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
