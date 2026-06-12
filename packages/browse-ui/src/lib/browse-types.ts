// All browse wire-types inlined — no @rdan/browse-service or @rdan/browse-core
// deps required. Kept field-identical with browse-dtos.ts in the monorepo.

export interface BrowseLink {
  href: string;
  text: string;
  position: number;
  kind: "internal" | "external";
  region?: "nav" | "content" | "other";
}

export interface BrowseMedia {
  kind: "image" | "video" | "iframe";
  src: string;
  alt: string | null;
  position: number;
  width?: number | null;
  height?: number | null;
  inContent?: boolean;
  isLikelyIcon?: boolean;
}

export interface DetectedSection {
  landmark: string;
  selector: string;
  textPreview: string;
  position: number;
}

export interface BrowseViewport {
  zoom: number;
  panX: number;
  panY: number;
  focusedNodeId: string | null;
  nodePositions: Record<string, { x: number; y: number }>;
}

export interface BrowseSession {
  id: string;
  version: number;
  userId: string;
  name: string;
  seedUrl: string | null;
  status: "active" | "deleted" | "archived";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  nodeCount?: number;
}

export interface BrowseSectionPin {
  id: string;
  version: number;
  userId: string;
  domain: string;
  landmark: string;
  selector: string;
  status: "active" | "retired";
  createdAt: string;
}

export interface BrowseNode {
  id: string;
  version: number;
  sessionId: string;
  kind: "page" | "media" | "gallery" | "clip";
  url: string;
  title: string | null;
  byline: string | null;
  contentMarkdown: string | null;
  lang: string | null;
  links: BrowseLink[];
  media: BrowseMedia[];
  mediaKind:
    | "image"
    | "video"
    | "iframe"
    | "section"
    | "summary"
    | "summary-detailed"
    | "endpoints"
    | "endpoint-detail"
    | "playground-result"
    | "playground-suggestions"
    | "generated-view"
    | null;
  mediaSrc: string | null;
  mediaAlt: string | null;
  fetchMode?: "static" | "headless" | null;
  sections?: DetectedSection[];
  sectionLandmark?: string | null;
  sectionSelector?: string | null;
  summaryText?: string | null;
  summaryStatus?: "pending" | "ok" | "failed" | null;
  summaryModel?: string | null;
  extractionStatus: "ok" | "failed" | "pending";
  extractionError: string | null;
  contentEvicted?: boolean;
  status: "active" | "deleted";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrowseEdge {
  id: string;
  version: number;
  sessionId: string;
  sourceNode: string;
  targetNode: string;
  kind: "link" | "media" | "gallery" | "derived";
  linkText: string | null;
  status: "active" | "deleted";
  createdBy: string;
  createdAt: string;
}

export type BrowseEndpointKind =
  | "content"
  | "search"
  | "graphql"
  | "config"
  | "document"
  | "analytics"
  | "media"
  | "noise"
  | "unknown";

export interface BrowseEndpointSignature {
  id: string;
  sessionId: string;
  nodeId: string;
  method: string;
  origin: string;
  pathPattern: string;
  queryKeys: string[];
  resourceTypes: string[];
  observationCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  statuses: number[];
  contentTypes: string[];
  avgDurationMs: number | null;
  maxEncodedBodySize: number | null;
  deterministicKind: BrowseEndpointKind;
  importanceScore: number;
  sampleObservationIds: string[];
}

export interface BrowseEndpointObservation {
  id: string;
  sessionId: string;
  nodeId: string;
  requestId: string;
  observedAt: number;
  method: string;
  url: string;
  origin: string;
  path: string;
  queryKeys: string[];
  resourceType: string;
  status: number | null;
  contentType: string | null;
  durationMs: number | null;
  encodedBodySize: number | null;
  fromCache: boolean;
  initiatorType: string | null;
  requestHeaders?: Record<string, string> | null;
  requestBodySample?: string | null;
  responseHeaders?: Record<string, string> | null;
  responseBodySample?: string | null;
  responseBodyTruncated?: boolean;
  createdAt: string;
}

export interface BrowseEndpointAnalysis {
  signatureId: string;
  summary: string;
  inferredPurpose: string;
  importance: "high" | "medium" | "low" | "noise";
  confidence: number;
  usefulParameters: string[];
  suggestedUses: string[];
  risks: string[];
}

export interface BrowseGroup {
  id: string;
  version: number;
  sessionId: string;
  label: string;
  color: string;
  status: "active" | "deleted";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrowseGroupMember {
  id: string;
  version: number;
  sessionId: string;
  groupId: string;
  nodeId: string;
  status: "active" | "retired";
  createdBy: string;
  createdAt: string;
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function rowToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[snakeToCamel(k)] = v;
  return out;
}

export function sessionFromRow(r: Record<string, unknown>): BrowseSession {
  const out = rowToCamel(r) as Record<string, unknown>;
  if (out.nodeCountComputed !== undefined) {
    out.nodeCount = out.nodeCountComputed;
    delete out.nodeCountComputed;
  }
  return out as unknown as BrowseSession;
}

export function nodeFromRow(r: Record<string, unknown>): BrowseNode {
  const out = rowToCamel(r) as Record<string, unknown>;
  const linksJson = (r as { links_json?: string | null }).links_json;
  const mediaJson = (r as { media_json?: string | null }).media_json;
  const sectionsJson = (r as { sections_json?: string | null }).sections_json;
  const parsedLinks = linksJson ? JSON.parse(linksJson) : [];
  const parsedMedia = mediaJson ? JSON.parse(mediaJson) : [];
  const parsedSections = sectionsJson ? JSON.parse(sectionsJson) : [];
  out.links = Array.isArray(parsedLinks) ? parsedLinks : [];
  out.media = Array.isArray(parsedMedia) ? parsedMedia : [];
  out.sections = Array.isArray(parsedSections) ? parsedSections : [];
  delete out.linksJson;
  delete out.mediaJson;
  delete out.sectionsJson;
  return out as unknown as BrowseNode;
}

export function edgeFromRow(r: Record<string, unknown>): BrowseEdge {
  return rowToCamel(r) as unknown as BrowseEdge;
}

export function groupFromRow(r: Record<string, unknown>): BrowseGroup {
  return rowToCamel(r) as unknown as BrowseGroup;
}

export function groupMemberFromRow(r: Record<string, unknown>): BrowseGroupMember {
  return rowToCamel(r) as unknown as BrowseGroupMember;
}
