import { KERNEL_URL } from "@/lib/kernel";

// Pass-through proxy that streams stored image bytes from the kernel's
// GET /api/browse/media/:nodeId endpoint. Uses streaming rather than
// buffering so large images are forwarded efficiently.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ nodeId: string }> },
) {
  const { nodeId } = await ctx.params;

  const upstream = await fetch(
    `${KERNEL_URL}/api/browse/media/${encodeURIComponent(nodeId)}`,
    { cache: "no-store" },
  );

  if (!upstream.ok) return new Response(null, { status: upstream.status });

  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  const cc = upstream.headers.get("cache-control");
  if (cc) headers.set("cache-control", cc);

  return new Response(upstream.body, { status: 200, headers });
}
