import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Business } from '../types.js';
import type { RawBrand } from '../sources/brand-profile.js';
import { studioDocs } from '../store.js';

/**
 * The source snapshot: everything Roger fetched for one business, saved before anything is concluded from it. The
 * inventory and the brief are built from this alone (src/studio/brief.ts), so building them again from the same
 * snapshot gives the same result, and a rerun can be checked against what was actually read.
 *
 * Page and stylesheet bodies are stored once each, content-addressed by sha256 ("studio-bodies"); the snapshot holds
 * their hashes. The snapshot's id is the sha256 of its content without timings, so the same content read twice is
 * the same snapshot.
 */
export const SNAPSHOT_VERSION = 1;

export type PageFetchStatus = 'read' | 'rendered' | 'failed' | 'skipped';
export interface SnapshotPage {
  url: string;
  finalUrl?: string;
  status: PageFetchStatus;
  httpStatus?: number;
  attempts: number;
  error?: string;
  contentType?: string;
  bodyHash?: string;
  bytes?: number;
  /** read after its scripts ran, in a browser: the HTML as delivered was mostly script */
  rendered?: boolean;
}
export interface DiscoveredUrl {
  url: string;
  via: ('input' | 'listing' | 'nav' | 'sitemap' | 'link')[];
  depth: number;
  linkedFrom: string[];
  /** the words of the link that pointed here (the first one seen) */
  anchor?: string;
  /** crawl: a page to read; document: a linked PDF (read by the documents stage, within its own budget); skip: not read */
  decision: 'crawl' | 'skip' | 'document';
  reason?: string;
  priority: number;
}
export interface AssetProbe {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
  sha256?: string;
  /** artwork (logo, badge, illustration) rather than a photograph */
  artwork?: boolean;
  /** 64-bit difference hash, hex: near-duplicates are within a few bits */
  dhash?: string;
}
/** A linked PDF, as the documents stage read it. Its extracted pages (text, OCR lines, sizes) are stored by hash. */
export interface DocumentSnapshot {
  url: string;
  kind: 'menu' | 'price-list' | 'services' | 'brochure' | 'allergen' | 'other';
  anchor?: string;
  linkedFrom: string[];
  status: 'read' | 'failed' | 'skipped';
  reason?: string;
  httpStatus?: number;
  attempts: number;
  bytes?: number;
  sha256?: string;
  totalPages?: number;
  pagesRead?: number;
  /** pages by how they were read */
  methods?: { text: number; ocr: number; textAndOcr: number; unread: number };
  ocrConfidence?: number;
  /** sha256 of the extraction (PdfExtraction JSON), stored with the page bodies */
  extractionHash?: string;
}
export interface LogoProbe { url: string; ok: boolean; reason?: string; width?: number; height?: number; format?: string; colors: string[] }
/** What the Google listing says, as returned (photos as references and their credits; review text is not kept). */
export type ListingSnapshot = Pick<Business, 'placeId' | 'name' | 'primaryType' | 'primaryTypeLabel' | 'types' | 'formattedAddress' | 'street' | 'city' | 'state' | 'zip' | 'phone' | 'website' | 'mapsUrl' | 'rating' | 'reviewCount' | 'businessStatus' | 'editorialSummary' | 'lat' | 'lng'> & {
  hours?: string[];
  photos: { ref: string; width: number; height: number; authors: string[]; isOwner: boolean }[];
};
export interface IdentitySnapshot {
  route: 'website' | 'google';
  status: 'verified' | 'probable' | 'unverified' | 'website-only';
  evidence: string[];
  rejected: { placeId: string; name: string; reason: string }[];
  notes: string[];
  /** the website Roger reads (given, or the one the listing names) */
  homeUrl?: string;
  placeId?: string;
}
export interface SourceSnapshot {
  schema: 'roger.source-snapshot';
  version: number;
  id: string;
  capturedAt: string;
  input: { website?: string; google?: string };
  identity: IdentitySnapshot;
  listing?: ListingSnapshot;
  robots: { url?: string; found: boolean; disallow: string[]; sitemaps: string[] };
  sitemaps: { url: string; status: 'read' | 'failed'; urls: number; error?: string }[];
  budget: { maxPages: number; maxDepth: number };
  discovery: DiscoveredUrl[];
  pages: SnapshotPage[];
  stylesheets: { url: string; ok: boolean; status?: number; bodyHash?: string }[];
  /** linked PDFs (menus, price lists, brochures); absent on snapshots made before the documents stage */
  documents?: DocumentSnapshot[];
  assets: AssetProbe[];
  brand: { status: 'measured' | 'skipped' | 'failed'; reason?: string; raw?: RawBrand; logo: LogoProbe[] };
}

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

/** JSON with object keys in a fixed order: the same value always gives the same text, and the same hash. */
export function stableStringify(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

/** The snapshot's id: its content, without when it was captured. */
export function snapshotIdOf(s: Omit<SourceSnapshot, 'id' | 'capturedAt'>): string {
  return `snap_${sha256(stableStringify({ ...s, id: undefined, capturedAt: undefined })).slice(0, 24)}`;
}

// ───────────────────────── bodies ─────────────────────────
const memo = new Map<string, string>();
export async function putBody(text: string): Promise<string> {
  const hash = sha256(text);
  if (memo.has(hash)) return hash;
  const existing = await studioDocs.get<{ data: string }>('studio-bodies', hash);
  if (!existing) await studioDocs.put('studio-bodies', hash, { hash, encoding: 'gzip-base64', data: gzipSync(text).toString('base64') });
  memo.set(hash, text);
  if (memo.size > 400) memo.delete(memo.keys().next().value!);
  return hash;
}
export async function getBody(hash: string | undefined): Promise<string | undefined> {
  if (!hash) return undefined;
  const hit = memo.get(hash);
  if (hit !== undefined) return hit;
  const d = await studioDocs.get<{ data: string }>('studio-bodies', hash);
  if (!d) return undefined;
  const text = gunzipSync(Buffer.from(d.data, 'base64')).toString('utf8');
  memo.set(hash, text);
  return text;
}

export async function saveSnapshot(s: SourceSnapshot) { await studioDocs.put('studio-snapshots', s.id, s); }
export const getSnapshot = (id: string) => studioDocs.get<SourceSnapshot>('studio-snapshots', id);
