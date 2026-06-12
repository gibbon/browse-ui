// Classify the payload of a native HTML5 drag-and-drop gesture dropped
// on the browse canvas into one of three extract kinds.
//
//   - link:  a dragged anchor (incl. a LINKED image — an <a> wrapping an
//            <img>). Detected by an `<a href>` in the dragged `text/html`,
//            else a bare `text/uri-list` / http `text/plain` URL.
//   - image: a dragged BARE <img>. The browser sets `text/html` to the
//            element's outerHTML AND (Chromium) sets `text/uri-list` to the
//            image's src. We want the IMAGE, not a link to it.
//   - text:  a plain text selection. Non-empty `text/plain`.
//
// Discrimination (the subtle part):
//   * A linked image vs a bare image: a linked image's html has an
//     `<a href>`; a bare image's html has only the `<img>`. Anchor → link.
//   * A bare-image drag vs a text selection that happens to contain an
//     <img>: the image drag sets `text/uri-list` (to the src); a text
//     selection does NOT populate uri-list. So `<img>` + uri-list = image;
//     `<img>` without uri-list = text. (This is what makes dragging an
//     image create an image pane, not a link/page from the image URL.)

export type DragExtract =
  | { kind: "link"; href: string }
  | { kind: "image"; src: string }
  | { kind: "text"; text: string };

export const RDAN_DRAG_MIME = "application/x-rdan-browse-drag";

interface DragDataSource {
  getData(type: string): string;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** First non-comment, non-blank line of an RFC-2483 uri-list. */
function firstUriListEntry(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return null;
}

/** Pull the `src="..."` (or `src='...'`) value out of an <img> tag. */
function imgSrcFromHtml(html: string): string | null {
  // Match the first <img ... src=...> in the dragged HTML fragment.
  const m = html.match(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : null;
}

/** Pull the first `<a ... href="...">` value out of an HTML fragment. */
function anchorHrefFromHtml(html: string): string | null {
  const m = html.match(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : null;
}

export function classifyDragData(dt: DragDataSource): DragExtract | null {
  const encoded = dt.getData(RDAN_DRAG_MIME);
  if (encoded) {
    try {
      const parsed = JSON.parse(encoded) as Partial<DragExtract>;
      if (parsed.kind === "link" && typeof parsed.href === "string" && isHttpUrl(parsed.href)) {
        return { kind: "link", href: parsed.href };
      }
      if (parsed.kind === "image" && typeof parsed.src === "string" && isHttpUrl(parsed.src)) {
        return { kind: "image", src: parsed.src };
      }
      if (parsed.kind === "text" && typeof parsed.text === "string" && parsed.text.trim()) {
        return { kind: "text", text: parsed.text.trim() };
      }
    } catch {
      // Fall through to browser-native drag formats.
    }
  }

  const html = dt.getData("text/html") || "";
  const firstUri = firstUriListEntry(dt.getData("text/uri-list") || "");
  const plain = (dt.getData("text/plain") || "").trim();

  // 1) Linked anchor (incl. a linked image: <a><img></a>) → link.
  const anchorHref = anchorHrefFromHtml(html);
  if (anchorHref && isHttpUrl(anchorHref)) {
    return { kind: "link", href: anchorHref };
  }

  // 2) Bare image — an <img> in the html that ALSO carries a uri-list
  //    (image drags set uri-list to the src; text selections don't). Prefer
  //    the uri-list src (the browser's absolute-resolved URL); fall back to
  //    the parsed img src for a relative/non-http src.
  const imgSrc = imgSrcFromHtml(html);
  if (imgSrc && firstUri) {
    return { kind: "image", src: isHttpUrl(firstUri) ? firstUri : imgSrc };
  }

  // 3) Plain link — a bare URL with no image.
  if (firstUri && isHttpUrl(firstUri)) {
    return { kind: "link", href: firstUri };
  }
  if (plain && isHttpUrl(plain)) {
    return { kind: "link", href: plain };
  }

  // 4) Text — any non-empty plain text selection.
  if (plain.length > 0) {
    return { kind: "text", text: plain };
  }

  return null;
}

export function writeDragExtractData(dt: DataTransfer, data: DragExtract): void {
  dt.effectAllowed = "copy";
  dt.setData(RDAN_DRAG_MIME, JSON.stringify(data));
  if (data.kind === "link") {
    dt.setData("text/uri-list", data.href);
    dt.setData("text/plain", data.href);
    dt.setData("text/html", `<a href="${escapeHtmlAttr(data.href)}">${escapeHtml(data.href)}</a>`);
    return;
  }
  if (data.kind === "image") {
    dt.setData("text/uri-list", data.src);
    dt.setData("text/plain", data.src);
    dt.setData("text/html", `<img src="${escapeHtmlAttr(data.src)}">`);
    return;
  }
  dt.setData("text/plain", data.text);
  dt.setData("text/html", escapeHtml(data.text));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
