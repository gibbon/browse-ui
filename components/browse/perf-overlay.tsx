"use client";

import { useEffect, useState } from "react";

// Tiny corner overlay showing live perf numbers for the browse canvas:
//   - JS heap (MB)   from performance.memory (Chromium only)
//   - FPS            sampled from requestAnimationFrame deltas
//   - Nodes / Edges  reactive props from the canvas
//   - Pool active    Playwright browser pool active context count,
//                    polled every 5s from /api/rdan/api/browse/pool
//                    (kernel route below)
//
// Toggled via the URL-bar button. Position is absolute bottom-left
// so it stays out of the way of the chat panel (right) and the
// undo-snackbar (bottom-center).

interface Props {
  nodeCount: number;
  edgeCount: number;
}

function readHeapMb(): number | null {
  const p = performance as unknown as { memory?: { usedJSHeapSize: number } };
  if (!p.memory) return null;
  return Math.round(p.memory.usedJSHeapSize / 1024 / 1024);
}

export function PerfOverlay({ nodeCount, edgeCount }: Props) {
  const [fps, setFps] = useState(0);
  const [heapMb, setHeapMb] = useState<number | null>(null);
  const [poolActive, setPoolActive] = useState<number | null>(null);

  // FPS sampling: count rAF frames in a 1-second window, then reset.
  useEffect(() => {
    let frames = 0;
    let windowStart = performance.now();
    let raf = 0;
    const tick = () => {
      frames += 1;
      const now = performance.now();
      const elapsed = now - windowStart;
      if (elapsed >= 1000) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        windowStart = now;
        setHeapMb(readHeapMb());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Browser-pool active count: polled every 5s. Optional — the kernel
  // route returns 404 in environments where the browse plugin isn't
  // loaded (in which case poolActive stays null and the row hides).
  useEffect(() => {
    let cancelled = false;
    const fetchPool = async () => {
      try {
        const res = await fetch("/api/rdan/api/browse/pool", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { active?: number };
        if (!cancelled && typeof data.active === "number") setPoolActive(data.active);
      } catch {
        // ignore — network errors leave poolActive at null
      }
    };
    fetchPool();
    const id = window.setInterval(fetchPool, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <div
      className="absolute bottom-4 left-4 z-40 rounded border border-card-border bg-card/80 backdrop-blur px-2.5 py-1.5 text-[10px] font-mono tabular-nums text-muted-foreground pointer-events-none select-none space-y-0.5 shadow-md"
      aria-label="browse perf overlay"
    >
      <div>
        <span className="text-foreground">FPS</span>{" "}
        <span className={fps < 30 ? "text-warning" : ""}>{fps}</span>
      </div>
      {heapMb !== null && (
        <div>
          <span className="text-foreground">HEAP</span>{" "}
          <span className={heapMb > 500 ? "text-warning" : ""}>{heapMb} MB</span>
        </div>
      )}
      <div>
        <span className="text-foreground">NODES</span> {nodeCount}
      </div>
      <div>
        <span className="text-foreground">EDGES</span> {edgeCount}
      </div>
      {poolActive !== null && (
        <div>
          <span className="text-foreground">POOL</span> {poolActive}
        </div>
      )}
    </div>
  );
}
