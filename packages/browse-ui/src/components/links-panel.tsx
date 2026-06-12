"use client";

// Footer panel pinned at the bottom of every page node. Splits links into
// three regions (content / nav / other) based on the extractor's region
// classification (semantic-tag ancestor walk overlaid with Readability-
// content membership). Media is no longer rendered here — the page's
// content images get auto-spawned into a paired gallery node by
// browse-service.maybeSpawnGalleryNode, which is a much better surface
// than burying thumbnails in a collapsed footer accordion.

import { useMemo, useState } from "react";
import type { BrowseLink } from "../lib/browse-types";

interface Props {
  links: BrowseLink[];
  onClickLink: (href: string, text: string) => void;
}

type Region = "content" | "nav" | "other";

export function LinksPanel({ links, onClickLink }: Props) {
  // Default open — the panel is the primary affordance for moving between
  // pages and burying it behind a click adds friction. Users still toggle
  // it shut via the ▼/▶ caret if they want more body real estate.
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Region>("content");

  const grouped = useMemo(() => {
    const out: Record<Region, BrowseLink[]> = { content: [], nav: [], other: [] };
    for (const l of links) {
      const r: Region = l.region === "content" || l.region === "nav" ? l.region : "other";
      out[r].push(l);
    }
    return out;
  }, [links]);

  const total = links.length;
  const showing = grouped[tab];

  return (
    <div className="border-t border-card-border text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-2 hover:bg-card-border/30 cursor-pointer"
      >
        {open ? "▼" : "▶"} Links — Content ({grouped.content.length}) · Nav (
        {grouped.nav.length}) · Other ({grouped.other.length})
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto">
          <div className="flex gap-1 px-3 pt-2 sticky top-0 bg-card border-b border-card-border/50">
            <TabButton active={tab === "content"} count={grouped.content.length} onClick={() => setTab("content")}>
              Content
            </TabButton>
            <TabButton active={tab === "nav"} count={grouped.nav.length} onClick={() => setTab("nav")}>
              Nav
            </TabButton>
            <TabButton active={tab === "other"} count={grouped.other.length} onClick={() => setTab("other")}>
              Other
            </TabButton>
          </div>
          <div className="p-3">
            {total === 0 && <div className="text-muted-foreground italic">No links extracted.</div>}
            {total > 0 && showing.length === 0 && (
              <div className="text-muted-foreground italic">
                No {tab} links on this page.
              </div>
            )}
            {showing.length > 0 && (
              <ol className="list-decimal pl-5 space-y-1">
                {showing.map((l, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => onClickLink(l.href, l.text)}
                      className="text-left hover:underline cursor-pointer"
                    >
                      {l.text || l.href}{" "}
                      <span className="text-muted-foreground text-xs">({l.kind})</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  count,
  children,
  onClick,
}: {
  active: boolean;
  count: number;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 text-xs rounded-t cursor-pointer ${
        active
          ? "bg-card-border/50 font-semibold"
          : "text-muted-foreground hover:bg-card-border/30"
      }`}
    >
      {children}
      <span className="ml-1 text-muted-foreground/70">({count})</span>
    </button>
  );
}
