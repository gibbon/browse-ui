// Dashboard proxy for POST /api/browse/sessions/:id/chat.
// Forwards a chat turn (message history + canvas context) to the kernel's
// browse assistant; returns {reply, actions[]}. Stateless; persists nothing.
import { proxyPost } from "@/lib/kernel";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data = await proxyPost(`/api/browse/sessions/${id}/chat`, body);
    return Response.json(data);
  } catch (err: unknown) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
