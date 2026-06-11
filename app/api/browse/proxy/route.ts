// Streaming pass-through for the browse-canvas iframe proxy.
// Forwards bytes (HTML, images, JSON, whatever) from the kernel
// /api/browse/proxy endpoint without re-buffering. The kernel does the
// SSRF guard, X-Frame-Options stripping, and HTML capture-script injection.
import { KERNEL_URL } from "@/lib/kernel";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kernelUrl = `${KERNEL_URL}/api/browse/proxy${url.search}`;

  const upstream = await fetch(kernelUrl, {
    method: "GET",
    cache: "no-store",
  });

  const headers = new Headers();
  upstream.headers.forEach((v, k) => {
    if (k.toLowerCase() === "content-encoding") return;
    if (k.toLowerCase() === "transfer-encoding") return;
    headers.set(k, v);
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
