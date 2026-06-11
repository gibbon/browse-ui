// Pass-through for proxied subresource requests made by Original-mode
// browse iframes. The kernel validates session ownership, SSRF safety,
// and page-origin scope.
import { KERNEL_URL } from "@/lib/kernel";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const kernelUrl = `${KERNEL_URL}/api/browse/subresource${url.search}`;

  const headers = new Headers();
  headers.set("Accept", request.headers.get("Accept") ?? "*/*");
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const targetMethod = request.headers.get("x-rdan-target-method");
  if (targetMethod) headers.set("x-rdan-target-method", targetMethod);
  const targetHeaders = request.headers.get("x-rdan-target-headers");
  if (targetHeaders) headers.set("x-rdan-target-headers", targetHeaders);

  const upstream = await fetch(kernelUrl, {
    method: "POST",
    headers,
    body: request.body,
    duplex: "half",
  } as RequestInit);

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-encoding") return;
    if (key.toLowerCase() === "transfer-encoding") return;
    outHeaders.set(key, value);
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: outHeaders,
  });
}
