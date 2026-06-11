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
  if (!res.ok) throw new Error(`kernel DELETE ${path} → ${res.status}`);
  return res.json();
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
