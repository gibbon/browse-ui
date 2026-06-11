import { proxyGet } from "@/lib/kernel";

export async function GET() {
  try {
    const data = await proxyGet("/api/browse/pool");
    return Response.json(data);
  } catch {
    return Response.json({ active: 0, max: 0, browserAlive: false });
  }
}
