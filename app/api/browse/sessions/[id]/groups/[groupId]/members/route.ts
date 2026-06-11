import { proxyPost } from "@/lib/kernel";

export async function POST(request: Request, context: { params: Promise<{ id: string; groupId: string }> }) {
  try {
    const { id, groupId } = await context.params;
    const body = await request.json();
    const data = await proxyPost(
      `/api/browse/sessions/${encodeURIComponent(id)}/groups/${encodeURIComponent(groupId)}/members`,
      body,
    );
    return Response.json(data);
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
