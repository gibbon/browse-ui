import { nodeFromRow, sessionFromRow } from "@/lib/browse-types";
import { proxyGet, proxyPost } from "@/lib/kernel";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "all" ? "?scope=all" : "";
    const data = await proxyGet(`/api/browse/sessions${scope}`) as { sessions: Record<string, unknown>[] };
    return Response.json({ sessions: (data.sessions ?? []).map(sessionFromRow) });
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await proxyPost("/api/browse/sessions", body) as {
      session: Record<string, unknown>;
      rootNode?: Record<string, unknown>;
    };
    return Response.json({
      session: sessionFromRow(data.session),
      rootNode: data.rootNode ? nodeFromRow(data.rootNode) : undefined,
    });
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
