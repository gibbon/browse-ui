import { proxyGet, proxyPatch } from "@/lib/kernel";

// Viewport is already camelCase end-to-end (BrowseViewport in the kernel
// service mirrors the dashboard interface), so no row→DTO transform is
// needed — straight pass-through.

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const data = await proxyGet(
      `/api/browse/sessions/${encodeURIComponent(id)}/viewport`,
    );
    return Response.json(data);
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
    const body = await request.json();
    const result = await proxyPatch(
      `/api/browse/sessions/${encodeURIComponent(id)}/viewport`,
      body,
    );
    return new Response(null, { status: result.status === 204 ? 204 : result.status });
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
