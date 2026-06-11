const KERNEL_URL = process.env.KERNEL_URL ?? "http://localhost:3002";

export async function proxyGet(path: string): Promise<unknown> {
  const res = await fetch(`${KERNEL_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`kernel ${path} → ${res.status}`);
  return res.json();
}

export async function proxyPost(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${KERNEL_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`kernel POST ${path} → ${res.status}`);
  return res.json();
}

export async function proxyDelete(path: string): Promise<unknown> {
  const res = await fetch(`${KERNEL_URL}${path}`, {
    method: "DELETE",
    cache: "no-store",
  });
  if (!res.ok && res.status !== 204) throw new Error(`kernel DELETE ${path} → ${res.status}`);
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

export async function proxyPut(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${KERNEL_URL}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`kernel PUT ${path} → ${res.status}`);
  return res.json();
}

export async function proxyPatch(path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${KERNEL_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok && res.status !== 204) throw new Error(`kernel PATCH ${path} → ${res.status}`);
  return { status: res.status, data };
}

/** Stream bytes from the kernel — used for media and proxy pass-through routes. */
export async function proxyStream(
  path: string,
  options?: { method?: string; headers?: Record<string, string>; body?: BodyInit },
): Promise<Response> {
  const res = await fetch(`${KERNEL_URL}${path}`, {
    method: options?.method ?? "GET",
    headers: options?.headers,
    body: options?.body,
    cache: "no-store",
  });
  return res;
}

export { KERNEL_URL };
