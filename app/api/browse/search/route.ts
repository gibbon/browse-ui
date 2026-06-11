// Proxy for the kernel's /api/browse/search route. Used by
// the chat composer's @-mention typeahead picker.
import { proxyGet } from "@/lib/kernel";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const limit = url.searchParams.get("limit") ?? "";
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (limit) qs.set("limit", limit);
    const data = await proxyGet(`/api/browse/search?${qs.toString()}`);
    return Response.json(data);
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
