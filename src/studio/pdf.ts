import { createRequire } from 'node:module';
import * as mupdf from 'mupdf';

/**
 * Business documents a website links to as PDFs: menus, price lists, service brochures. Roger reads a few of them
 * (bounded), page by page: the PDF's own text where it has a usable text layer, and OCR of the rendered page where it
 * has none, or where its text is garbled (a decorative font whose glyphs carry no letters). Every page records how it
 * was read and how sure the reading is, so nothing downstream mistakes an OCR guess for the business's own words.
 *
 * Items (a menu's dishes, a price list's lines) are taken only from text-layer pages with a clear heading structure:
 * an item is a heading line, its details the lines under it. OCR text is kept as evidence and used to corroborate
 * items, never to create them.
 */

export type PdfKind = 'menu' | 'price-list' | 'services' | 'brochure' | 'allergen' | 'other';
const KIND_RULES: [PdfKind, RegExp][] = [
  ['menu', /\b(menu|food|drinks?|beverages?|breakfast|lunch|dinner|catering|wine|cocktails?)\b/i],
  ['price-list', /\b(price|prices|pricing|rates?|fees?|tariff|cost)\b/i],
  ['services', /\b(services?|treatments?|procedures?|packages?)\b/i],
  ['brochure', /\b(brochure|catalog(?:ue)?|lookbook|specials?|flyer)\b/i],
  ['allergen', /\b(allergens?|allergy|nutrition)\b/i],
];
/** what a linked PDF is, from its address and the words of the link */
export function pdfKind(url: string, anchor = ''): PdfKind {
  const file = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || '').replace(/[-_+.]+/g, ' ');
  for (const [k, re] of KIND_RULES) if (re.test(file) || re.test(anchor)) return k;
  return 'other';
}
/** which PDFs are worth reading first: what the business sells and what it costs */
export const PDF_PRIORITY: Record<PdfKind, number> = { menu: 0, 'price-list': 0, services: 1, brochure: 2, allergen: 3, other: 9 };
export const isBusinessCritical = (k: PdfKind) => k !== 'other';

// ───────────────────────── reading ─────────────────────────
export interface PdfLine { text: string; size?: number; bold?: boolean; y: number; x?: number; w?: number; conf?: number }
export interface PdfPage {
  page: number;
  /** text: the PDF's own text; ocr: read from the rendered page; text+ocr: both (its text layer was partly garbled) */
  method: 'text' | 'ocr' | 'text+ocr' | 'skipped';
  chars: number;
  /** share of the text layer's characters that carry no letter (glyphs without a Unicode mapping) */
  garbled: number;
  ocrConfidence?: number;
  reason?: string;
  lines: PdfLine[];
  ocrLines?: PdfLine[];
}
export interface PdfExtraction { pages: PdfPage[]; totalPages: number; truncated: boolean; title?: string }

const clean = (s: string) => s.replace(/[​-‍﻿­]/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
/** characters that are not text: the replacement character, private-use glyphs, controls */
export function garbledRatio(text: string): number {
  const chars = [...text.replace(/\s+/g, '')];
  if (!chars.length) return 0;
  const bad = chars.filter((c) => c === '�' || /[-]/.test(c) || /[\u0000-\u001f]/.test(c)).length;
  return +(bad / chars.length).toFixed(3);
}

export type Ocr = (png: Buffer) => Promise<{ lines: PdfLine[]; confidence: number }>;

/** Tesseract (WebAssembly) with the English model shipped in node_modules: no download at run time. */
export async function tesseractOcr(): Promise<{ ocr: Ocr; close: () => Promise<void> }> {
  const { createWorker } = await import('tesseract.js');
  const require = createRequire(import.meta.url);
  const eng = require('@tesseract.js-data/eng') as { langPath: string };
  const worker = await createWorker('eng', 1, { langPath: eng.langPath, gzip: true, cacheMethod: 'none' });
  return {
    ocr: async (png) => {
      const r = await worker.recognize(png, {}, { blocks: true });
      const lines: PdfLine[] = [];
      for (const b of r.data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
        const text = clean(l.text);
        if (text) lines.push({ text, y: l.bbox.y0, x: l.bbox.x0, size: l.bbox.y1 - l.bbox.y0, conf: Math.round(l.confidence) });
      }
      return { lines, confidence: Math.round(r.data.confidence) };
    },
    close: async () => { await worker.terminate(); },
  };
}

/**
 * Read a PDF: each page's text layer, and OCR for pages that have no usable text. Bounded by `maxPages` and by
 * `ocrBudget` (pages that may be OCR'd; shared across a job's documents, decremented here).
 */
export async function readPdf(bytes: Uint8Array, opts: { maxPages: number; ocrBudget: { pages: number }; ocr?: Ocr; scale?: number }): Promise<PdfExtraction> {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const totalPages = doc.countPages();
  const n = Math.min(totalPages, opts.maxPages);
  const pages: PdfPage[] = [];
  let title: string | undefined;
  try { title = clean(String(doc.getMetaData('info:Title') || '')) || undefined; } catch { /* no metadata */ }
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    const json = JSON.parse(page.toStructuredText('preserve-whitespace').asJSON()) as { blocks: { type: string; lines?: { text: string; font?: { size?: number; weight?: string }; bbox: { x: number; y: number; w: number; h: number } }[] }[] };
    const raw = json.blocks.flatMap((b) => (b.type === 'text' ? b.lines ?? [] : []));
    const all = raw.map((l) => l.text).join(' ');
    const garbled = garbledRatio(all);
    const lines: PdfLine[] = raw.map((l) => ({ text: clean(l.text), size: l.font?.size ? Math.round(l.font.size * 10) / 10 : undefined, bold: l.font?.weight === 'bold', y: Math.round(l.bbox.y), x: Math.round(l.bbox.x), w: Math.round(l.bbox.w) }))
      .filter((l) => l.text && garbledRatio(l.text) < 0.2);
    const chars = lines.reduce((s, l) => s + l.text.length, 0);
    const needsOcr = chars < 60 || garbled >= 0.15;
    const rec: PdfPage = { page: i + 1, method: 'text', chars, garbled, lines };
    if (needsOcr) {
      if (!opts.ocr) { rec.method = chars ? 'text' : 'skipped'; rec.reason = 'no usable text layer and OCR is not available here'; }
      else if (opts.ocrBudget.pages <= 0) { rec.method = chars ? 'text' : 'skipped'; rec.reason = 'no usable text layer; over the OCR page budget'; }
      else {
        opts.ocrBudget.pages--;
        const scale = opts.scale ?? 2.5;
        const png = Buffer.from(page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true).asPNG());
        const o = await opts.ocr(png);
        rec.method = chars ? 'text+ocr' : 'ocr';
        rec.ocrConfidence = o.confidence;
        rec.ocrLines = o.lines.map((l) => ({ ...l, y: Math.round(l.y / scale), x: l.x !== undefined ? Math.round(l.x / scale) : undefined, size: l.size !== undefined ? Math.round(l.size / scale) : undefined }));
        rec.reason = chars ? `the text layer is ${Math.round(garbled * 100)}% unreadable glyphs: the page was also read by OCR` : 'no text layer: the page was read by OCR';
      }
    }
    pages.push(rec);
  }
  return { pages, totalPages, truncated: totalPages > n, title };
}

// ───────────────────────── items ─────────────────────────
export interface PdfItem {
  name: string;
  section?: string;
  description?: string;
  /** the price as the document writes it ("$6.50", "12oz – $7.25 | 24oz – $10.25") */
  price?: string;
  /** how the price was tied to the item: on the item's own lines, or printed in the same tile of a grid */
  priceBy?: 'item-lines' | 'same-tile';
  tags: string[];
  page: number;
  layout: 'list' | 'grid';
}
const PRICE = /(\$\s?\d{1,4}(?:[.,]\d{2})?|\b\d{1,3}\.\d{2}\b)/;
const PRICE_ONLY = /^\$?\s?\d{1,4}[.,]\d{2}$/;
const TAG = /^(vegan|vegetarian|gluten[- ]free|dairy[- ]free|spicy|new|kids?|organic|keto|paleo|nut[- ]free|v|gf|df)(\s*[|,/]\s*(vegan|vegetarian|gluten[- ]free|dairy[- ]free|spicy|\d+\s?oz|sold separately|[a-z ]{1,20}))*$/i;

type L = PdfLine & { page: number };
const center = (l: L) => (l.x ?? 0) + (l.w ?? 0) / 2;

/** a page set out as a grid of tiles (a poster menu), not a list: its item names sit in three or more columns */
function isGrid(names: L[]): boolean {
  const cols: number[] = [];
  for (const l of names) { const c = center(l); if (!cols.some((x) => Math.abs(x - c) < 30)) cols.push(c); }
  return cols.filter((c) => names.filter((l) => Math.abs(center(l) - c) < 30).length >= 2).length >= 3;
}

function finishItem(cur: PdfItem & { details: string[] }): PdfItem {
  const details: string[] = [];
  for (const d of cur.details) {
    if (!cur.price && PRICE.test(d) && d.length <= 60) { cur.price = d.replace(/\s*\|\s*/g, ' | '); cur.priceBy = 'item-lines'; continue; }
    if (TAG.test(d) && d.length <= 50) { cur.tags.push(...d.split(/\s*[|,/]\s*/).map((t) => t.trim()).filter(Boolean)); continue; }
    details.push(d);
  }
  const { details: _d, ...item } = cur;
  void _d;
  if (details.length) item.description = details.join(' ').replace(/\s+/g, ' ').slice(0, 400);
  return item;
}

/** A list page: each item name is a heading line; the lines under it are its price, tags and description. */
function listItems(lines: L[], itemSize: number, bodySize: number, isSection: (l: L) => boolean, section: { name?: string }): PdfItem[] {
  const out: PdfItem[] = [];
  let cur: (PdfItem & { details: string[] }) | undefined;
  for (const l of lines) {
    if (isSection(l)) { if (cur) out.push(finishItem(cur)); cur = undefined; section.name = l.text.replace(/[:.]$/, ''); continue; }
    if (l.size === itemSize && l.text.length <= 60 && !PRICE.test(l.text)) { if (cur) out.push(finishItem(cur)); cur = { name: l.text.replace(/[:.]$/, ''), section: section.name, tags: [], page: l.page, layout: 'list', details: [] }; continue; }
    if (cur && l.size! <= bodySize * 1.1) cur.details.push(l.text);
  }
  if (cur) out.push(finishItem(cur));
  return out;
}

/**
 * A grid page: a name may wrap over lines in its column ("El Breakfast" / "Taco"); its price is the price printed
 * above it in the same tile, that is in its column and below the tile above. A name with no such price has none.
 */
function gridItems(lines: L[], itemSize: number, isSection: (l: L) => boolean, section: { name?: string }): PdfItem[] {
  for (const l of lines) if (isSection(l)) section.name = l.text.replace(/[:.]$/, '');
  const names = lines.filter((l) => l.size === itemSize && !PRICE.test(l.text) && !isSection(l)).sort((a, b) => center(a) - center(b) || a.y - b.y);
  const groups: { lines: L[]; x: number; y: number; bottom: number }[] = [];
  for (const l of names.sort((a, b) => a.y - b.y)) {
    const g = groups.find((x) => Math.abs(x.x - center(l)) < 25 && l.y - x.bottom >= 0 && l.y - x.bottom <= itemSize * 1.8);
    if (g) { g.lines.push(l); g.bottom = l.y; } else groups.push({ lines: [l], x: center(l), y: l.y, bottom: l.y });
  }
  // the spacing between columns: half of it is how far a tile's price can sit from its name
  const xs = [...new Set(groups.map((g) => Math.round(g.x / 10) * 10))].sort((a, b) => a - b);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]).filter((d) => d > 40).sort((a, b) => a - b);
  const half = gaps.length ? gaps[Math.floor(gaps.length / 2)] / 2 : 60;
  const prices = lines.filter((l) => PRICE_ONLY.test(l.text) || /^\d{1,3}\s?oz\b/i.test(l.text) && PRICE.test(l.text));
  const out: PdfItem[] = [];
  for (const g of groups) {
    const name = g.lines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').replace(/\s+&$/, '').trim();
    if (name.length < 3) continue;
    // the nearest price above the name in its column, with no other name between them
    const above = prices.filter((p) => p.y < g.y && Math.abs(center(p) - g.x) <= half && g.y - p.y <= 260)
      .filter((p) => !groups.some((o) => o !== g && Math.abs(o.x - g.x) < 25 && o.y > p.y && o.y < g.y))
      .sort((a, b) => b.y - a.y);
    const item: PdfItem = { name, section: section.name, tags: [], page: g.lines[0].page, layout: 'grid' };
    if (above[0]) { item.price = above[0].text.replace(/\s+/g, ' '); item.priceBy = 'same-tile'; }
    out.push(item);
  }
  return out;
}

/**
 * Items from the text-layer pages of a document with a heading structure: lines set larger than the body text are
 * item names (a size used only once or twice per page, larger still, is a section title). Running headers and page
 * numbers are dropped. List pages and grid pages (poster menus) are read differently. A document without that
 * structure gives no items: its text stays evidence only. OCR text is never used to make an item.
 */
export function itemsFromPdf(x: PdfExtraction): PdfItem[] {
  const pages = x.pages.filter((p) => p.method === 'text' || p.method === 'text+ocr');
  const lines: L[] = pages.flatMap((p) => p.lines.filter((l) => l.size).map((l) => ({ ...l, page: p.page })));
  if (lines.length < 4) return [];
  // running headers: the same text near the same height on two or more pages; page numbers
  // (only near the top or bottom of a page: the same price in the same row of two posters is not a header)
  const extent = new Map<number, { top: number; bottom: number }>();
  for (const l of lines) { const e = extent.get(l.page) ?? { top: l.y, bottom: l.y }; e.top = Math.min(e.top, l.y); e.bottom = Math.max(e.bottom, l.y); extent.set(l.page, e); }
  const margin = (l: L) => { const e = extent.get(l.page)!; const band = Math.max(40, (e.bottom - e.top) * 0.08); return l.y <= e.top + band || l.y >= e.bottom - band; };
  const seen = new Map<string, Set<number>>();
  for (const l of lines) if (margin(l)) { const k = `${l.text.toLowerCase()}|${Math.round(l.y / 20)}`; seen.set(k, (seen.get(k) ?? new Set()).add(l.page)); }
  const body = lines.filter((l) => !(margin(l) && /^\d{1,3}$/.test(l.text)) && !(margin(l) && (seen.get(`${l.text.toLowerCase()}|${Math.round(l.y / 20)}`)?.size ?? 0) >= 2));
  const bySize = new Map<number, number>();
  for (const l of body) bySize.set(l.size!, (bySize.get(l.size!) ?? 0) + l.text.length);
  const bodySize = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!bodySize) return [];
  const headingSizes = [...bySize.keys()].filter((sz) => sz >= bodySize * 1.15);
  if (!headingSizes.length) return [];
  const counts = new Map(headingSizes.map((sz) => [sz, body.filter((l) => l.size === sz).length]));
  const itemSize = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  const isSection = (l: L) => l.size! > itemSize && (counts.get(l.size!) ?? 0) <= Math.max(2, pages.length * 2);
  const section: { name?: string } = {};
  const items: PdfItem[] = [];
  for (const p of pages) {
    const pl = body.filter((l) => l.page === p.page).sort((a, b) => a.y - b.y || (a.x ?? 0) - (b.x ?? 0));
    const names = pl.filter((l) => l.size === itemSize && !PRICE.test(l.text));
    items.push(...(isGrid(names) ? gridItems(pl, itemSize, isSection, section) : listItems(pl, itemSize, bodySize, isSection, section)));
  }
  const out: PdfItem[] = [];
  for (const it of items) if (!out.some((o) => o.name.toLowerCase() === it.name.toLowerCase())) out.push(it);
  return out;
}

/** whether a name appears in OCR text (all its words, in order, allowing OCR's usual small errors) */
export function seenInOcr(name: string, ocrText: string): boolean {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const n = norm(name), t = ` ${norm(ocrText)} `;
  if (!n) return false;
  if (t.includes(` ${n} `)) return true;
  const words = n.split(' ').filter((w) => w.length > 2);
  return words.length >= 2 && words.every((w) => t.includes(` ${w} `));
}
