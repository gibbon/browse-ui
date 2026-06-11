"use client";

// Ctrl+drag pan handler for the browse canvas. Lets the user pan over
// areas of the canvas that are otherwise grabbed by iframe content
// (page-node bodies, gallery thumbnails) — those would normally
// swallow mousedown and prevent xyflow's default empty-canvas pan
// from kicking in.
//
// Returns a single onMouseDown handler the caller wires onto the
// canvas viewport's wrapper div with onMouseDownCapture (so it sees
// the event before any iframe handler).

import { useCallback } from "react";
import type React from "react";
import { useReactFlow } from "@xyflow/react";

export function useCanvasPan() {
  const reactFlow = useReactFlow();

  return useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startVp = reactFlow.getViewport();
      document.body.style.cursor = "grabbing";

      const onMove = (mv: MouseEvent) => {
        const dx = mv.clientX - startX;
        const dy = mv.clientY - startY;
        reactFlow.setViewport({
          x: startVp.x + dx,
          y: startVp.y + dy,
          zoom: startVp.zoom,
        });
      };
      const onUp = () => {
        document.body.style.cursor = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [reactFlow],
  );
}
