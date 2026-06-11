import { edgeFromRow, groupFromRow, groupMemberFromRow, nodeFromRow, sessionFromRow } from "@/lib/browse-types";
import { proxyDelete, proxyGet, proxyPatch } from "@/lib/kernel";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const data = await proxyGet(`/api/browse/sessions/${encodeURIComponent(id)}`) as {
      session: Record<string, unknown>;
      nodes: Record<string, unknown>[];
      edges: Record<string, unknown>[];
      groups?: Record<string, unknown>[];
      groupMembers?: Record<string, unknown>[];
    };
    return Response.json({
      session: sessionFromRow(data.session),
      nodes: (data.nodes ?? []).map(nodeFromRow),
      edges: (data.edges ?? []).map(edgeFromRow),
      groups: (data.groups ?? []).map(groupFromRow),
      groupMembers: (data.groupMembers ?? []).map(groupMemberFromRow),
    });
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { status?: string };
    if (body.status !== "active" && body.status !== "archived") {
      return Response.json({ error: "status must be 'active' or 'archived'" }, { status: 400 });
    }
    const result = await proxyPatch(`/api/browse/sessions/${encodeURIComponent(id)}`, {
      status: body.status,
    });
    const data = result.data as { session: Record<string, unknown> };
    return Response.json({ session: sessionFromRow(data.session) });
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await proxyDelete(`/api/browse/sessions/${encodeURIComponent(id)}`);
    return new Response(null, { status: 204 });
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
