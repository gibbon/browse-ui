"use client";

// Gallery node — auto-spawned by the kernel as a sibling of every page
// node that has at least one non-icon content image. Renders the page's
// images as a slideshow with a thumbnail strip below; click main image
// for a fullscreen overlay, click thumbnail to switch, arrow keys (when
// focused) navigate.

import { memo, useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, type Node, type NodeProps } from "@xyflow/react";
import type { BrowseMedia } from "@/lib/browse-types";
import { writeDragExtractData } from "./drag-extract";

export interface GalleryNodeData extends Record<string, unknown> {
  parentUrl: string;
  parentTitle: string | null;
  /** Pre-filtered list (inContent && !isLikelyIcon, image kind only). */
  media: BrowseMedia[];
  onClose: () => void;
}

export type GalleryFlowNode = Node<GalleryNodeData, "gallery">;

export const GalleryNode = memo(GalleryNodeImpl, (prev, next) =>
  prev.id === next.id && prev.data === next.data && prev.selected === next.selected,
);
function GalleryNodeImpl({ data }: NodeProps<GalleryFlowNode>) {
  const [index, setIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const items = data.media;
  const safeIndex = items.length === 0 ? 0 : Math.min(index, items.length - 1);
  const current = items[safeIndex];

  useEffect(() => {
    // Keep the active thumbnail visible as the user clicks left/right.
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>(`[data-idx="${safeIndex}"]`);
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [safeIndex]);

  if (items.length === 0) {
    return (
      <div className="bg-card border border-card-border rounded shadow w-[440px] p-3 text-sm text-muted-foreground">
        Gallery is empty.
      </div>
    );
  }

  function go(delta: number) {
    setIndex((i) => {
      const next = (i + delta + items.length) % items.length;
      return next;
    });
  }

  return (
    <div
      className="bg-card border border-card-border rounded shadow flex flex-col text-sm w-full h-full"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
        if (e.key === "Escape") setFullscreen(false);
      }}
      tabIndex={0}
      style={{ minWidth: 320, minHeight: 380 }}
    >
      <NodeResizer
        minWidth={320}
        minHeight={380}
        lineClassName="!border-primary/50"
        handleClassName="!bg-primary !border-card !w-2 !h-2"
      />
      <Handle type="target" position={Position.Left} />
      <div className="px-3 py-2 border-b border-card-border shrink-0 relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onClose();
          }}
          aria-label="close"
          title="Close"
          className="absolute top-1 right-1 w-5 h-5 rounded text-muted-foreground hover:text-foreground hover:bg-card-border/50 cursor-pointer leading-none text-base"
        >
          ×
        </button>
        <div className="text-xs text-muted-foreground truncate pr-6" title={data.parentUrl}>
          {data.parentUrl}
        </div>
        <div className="text-base font-semibold leading-tight pr-6">
          {data.parentTitle ? `Gallery: ${data.parentTitle}` : "Gallery"}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {safeIndex + 1} / {items.length}
        </div>
      </div>

      <div className="relative bg-black/30 flex items-center justify-center min-h-[260px] max-h-[360px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.src}
          alt={current.alt ?? ""}
          className="max-h-[360px] max-w-full object-contain cursor-zoom-in"
          onClick={() => setFullscreen(true)}
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            writeDragExtractData(e.dataTransfer, { kind: "image", src: current.src });
          }}
          loading="lazy"
        />
        {items.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                go(-1);
              }}
              aria-label="previous"
              className="absolute left-1 top-1/2 -translate-y-1/2 bg-card/80 border border-card-border rounded-full w-7 h-7 cursor-pointer hover:bg-card"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                go(1);
              }}
              aria-label="next"
              className="absolute right-1 top-1/2 -translate-y-1/2 bg-card/80 border border-card-border rounded-full w-7 h-7 cursor-pointer hover:bg-card"
            >
              ›
            </button>
          </>
        )}
      </div>

      {current.alt && (
        <div className="px-3 py-1 text-[11px] italic text-muted-foreground border-t border-card-border shrink-0 truncate">
          {current.alt}
        </div>
      )}

      <div
        ref={stripRef}
        className="nowheel nodrag flex gap-1 p-2 overflow-x-auto border-t border-card-border shrink-0 max-h-[88px]"
      >
        {items.map((m, i) => (
          <button
            key={`${m.src}-${i}`}
            type="button"
            data-idx={i}
            onClick={() => setIndex(i)}
            className={`shrink-0 border rounded overflow-hidden cursor-pointer ${
              i === safeIndex ? "border-primary" : "border-card-border"
            }`}
            title={m.alt ?? m.src}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={m.src}
              alt={m.alt ?? ""}
              className="h-16 w-20 object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>

      {fullscreen && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center cursor-zoom-out"
          onClick={() => setFullscreen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={current.src}
            alt={current.alt ?? ""}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              writeDragExtractData(e.dataTransfer, { kind: "image", src: current.src });
            }}
          />
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
