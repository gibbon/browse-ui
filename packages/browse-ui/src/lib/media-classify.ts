// Classify a clicked link as a media URL we'd rather spawn into a media
// node (iframe / video / image) than try to fetch + readability. Covers
// the common video hosts (YouTube, Vimeo, Twitch, SoundCloud, etc.)
// plus direct media file extensions. Pure URL parsing — no network.
//
// Returns null when the URL is just a normal web page, in which case
// the caller falls through to the normal page-spawn path.

export type ClassifiedMedia = {
  kind: "video" | "iframe" | "image";
  /** URL to actually render — usually the embed/player URL, not the
   *  user-facing watch URL. For YouTube, transforms /watch?v=X into
   *  /embed/X so the iframe works without a page-shell. */
  embedUrl: string;
};

function tryParse(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/**
 * Normalize a user-typed URL: assume https:// when no scheme is given,
 * trim whitespace, strip leading/trailing dots. Returns the input
 * unchanged when it already has a scheme. Used by the URL bar + the
 * new-session form so users can paste `wikipedia.org` and have it
 * Just Work.
 */
export function normalizeUrl(input: string): string {
  let s = (input ?? "").trim();
  if (!s) return s;
  // Already has a scheme.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  // Strip a leading // for protocol-relative — same default.
  if (s.startsWith("//")) s = s.slice(2);
  return `https://${s}`;
}

function host(u: URL): string {
  return u.hostname.replace(/^www\./, "");
}

export function classifyContentUrl(href: string): ClassifiedMedia | null {
  const u = tryParse(href);
  if (!u) return null;
  const h = host(u);

  // ── Video hosts ──────────────────────────────────────────────────
  if (h === "youtube.com") {
    if (u.pathname === "/watch") {
      const id = u.searchParams.get("v");
      if (id) return { kind: "iframe", embedUrl: `https://www.youtube.com/embed/${id}` };
    }
    if (u.pathname.startsWith("/embed/")) {
      return { kind: "iframe", embedUrl: href };
    }
    if (u.pathname.startsWith("/shorts/")) {
      const id = u.pathname.slice("/shorts/".length).split("/")[0];
      if (id) return { kind: "iframe", embedUrl: `https://www.youtube.com/embed/${id}` };
    }
  }
  if (h === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    if (id) return { kind: "iframe", embedUrl: `https://www.youtube.com/embed/${id}` };
  }

  if (h === "vimeo.com") {
    const m = u.pathname.match(/^\/(\d+)/);
    if (m) return { kind: "iframe", embedUrl: `https://player.vimeo.com/video/${m[1]}` };
  }
  if (h === "player.vimeo.com" && u.pathname.startsWith("/video/")) {
    return { kind: "iframe", embedUrl: href };
  }

  if (h === "twitch.tv") {
    const vm = u.pathname.match(/^\/videos\/(\d+)/);
    if (vm) {
      // Twitch's player needs the parent= origin; we don't know it
      // statically (could be localhost / production / preview). Best
      // effort: pass the current location at render time instead of
      // a hardcoded one — handled in MediaNode by the iframe.
      return {
        kind: "iframe",
        embedUrl: `https://player.twitch.tv/?video=${vm[1]}&autoplay=false&parent=__BROWSE_HOST__`,
      };
    }
    const cm = u.pathname.match(/^\/([^/]+)\/clip\/([^/?]+)/);
    if (cm) {
      return {
        kind: "iframe",
        embedUrl: `https://clips.twitch.tv/embed?clip=${cm[2]}&parent=__BROWSE_HOST__`,
      };
    }
  }

  if (h === "soundcloud.com") {
    return {
      kind: "iframe",
      embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(href)}&auto_play=false&hide_related=true&visual=true`,
    };
  }

  if (h === "dailymotion.com") {
    const m = u.pathname.match(/^\/video\/([^/?#]+)/);
    if (m) return { kind: "iframe", embedUrl: `https://www.dailymotion.com/embed/video/${m[1]}` };
  }
  if (h === "dai.ly") {
    const id = u.pathname.slice(1).split("/")[0];
    if (id) return { kind: "iframe", embedUrl: `https://www.dailymotion.com/embed/video/${id}` };
  }

  // ── Direct media file extensions ─────────────────────────────────
  const direct = classifyDirectMedia(href);
  if (direct) return direct;

  return null;
}

/**
 * Classify ONLY direct media file URLs (mp4, jpg, pdf, etc.) — does
 * NOT match embed-host page URLs like youtube.com/watch?v=X (those
 * are real pages with title / description / comments and should
 * spawn as page nodes; the kernel's auto-extract pulls the embed
 * iframe into the meta column on extraction).
 *
 * Used by the click-spawn-child path to decide between "spawn as
 * media tile directly" vs "spawn as page so user can navigate it".
 */
export function classifyDirectMedia(href: string): ClassifiedMedia | null {
  const u = tryParse(href);
  if (!u) return null;
  const path = u.pathname.toLowerCase();
  if (/\.(mp4|webm|mov|m4v|ogv)(?:$|\?)/.test(path)) {
    return { kind: "video", embedUrl: href };
  }
  if (/\.(mp3|wav|flac|aac|m4a|ogg|opus)(?:$|\?)/.test(path)) {
    return { kind: "video", embedUrl: href };
  }
  if (/\.(jpe?g|png|gif|webp|avif|bmp|svg)(?:$|\?)/.test(path)) {
    return { kind: "image", embedUrl: href };
  }
  if (/\.pdf(?:$|\?)/.test(path)) {
    return { kind: "iframe", embedUrl: href };
  }
  return null;
}

/**
 * URL hostname / path patterns that indicate an authentication flow.
 * The browse stack can't follow these (no JS, no cookies, OAuth
 * redirects break) — we open them in the user's real browser via
 * window.open() instead of spawning a node that would fail silently.
 */
export function isLoginUrl(href: string): boolean {
  const u = tryParse(href);
  if (!u) return false;
  const h = host(u);
  const p = u.pathname.toLowerCase();

  // Anchored — only match when the login segment is the first path
  // component, optionally preceded by a user/account namespace.
  // Avoids false positives on Wikipedia-style article paths like
  // /wiki/Login (where "Login" is a content noun, not an auth route).
  // Pattern handles:
  //   /login, /signin, /auth          ← top-level
  //   /users/sign_in, /account/login  ← single-namespace prefix
  if (/^\/(?:(?:users?|accounts?|profile)\/)?(login|signin|sign-in|sign_in|signup|sign-up|register|auth)(\/|$)/.test(p)) {
    return true;
  }
  // Common OAuth provider hosts.
  if (
    h === "accounts.google.com" ||
    h === "appleid.apple.com" ||
    (h === "github.com" && p.startsWith("/login"))
  ) {
    return true;
  }
  return false;
}
