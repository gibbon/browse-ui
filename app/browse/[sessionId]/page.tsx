// Server component wrapper — required for static export. generateStaticParams
// must live in a server component (no "use client"), while the actual canvas
// UI lives in browse-canvas-client.tsx (a client component).

import BrowseCanvasClient from "./browse-canvas-client";

export const dynamicParams = false;
// Return a placeholder so Next.js static export treats this as a valid
// pre-rendered shell. The browse-server will serve this shell for any
// /browse/<sessionId> path; the actual session data is loaded client-side.
export function generateStaticParams() {
  return [{ sessionId: "__placeholder__" }];
}

export default function BrowseSessionPage() {
  return <BrowseCanvasClient />;
}
