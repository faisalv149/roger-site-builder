import { load } from 'cheerio';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import type { Business } from '../types.js';
import { liveListingPhotos, livePhotoUri, liveReviews } from './places.js';
import { recordPhotoOmission, verifyLivePhoto, type LiveVerdict } from '../studio/concepts/listing-photos.js';

/**
 * Google listing content on the live builder's pages, within Google Maps Platform's terms (Terms of Service 3.2.3
 * (a)(b), Service Specific Terms 14; reviewed 2026-11-04): photos and review text are shown, never stored.
 *  - A photo is a link to /gphoto/<place>/<n>?s=<w>x<h>, which fetches Google's image for that view (only when the
 *    candidate's pixels match the saved fingerprint; position and dimensions alone never establish identity).
 *  - A credit, a review's text, author and age are markers in the saved page, filled from a fresh Place Details call
 *    when the page is served, with the author's profile link and the "Google Maps" link to the source.
 * Nothing Google returns is written to disk, the store or a draft. Google photos stay preview-only (publish leaves them
 * out); the owner's own uploads replace them.
 */
const M = /⟦g:([actw]):([A-Za-z0-9_-]+):(\d+)(?::([0-9x]+))?(?::([0-9a-f-]+))?⟧/;
const MG = new RegExp(M.source, 'g');
/** a photo's credit, filled when served; fp: the fingerprint of the picture shown (verified before the credit is given) */
export const photoCreditMarker = (placeId: string, n: number, w: number, h: number, fp?: string) => `⟦g:c:${placeId}:${n}:${w}x${h}${fp ? `:${fp}` : ''}⟧`;
/** a photo's live link; fp: the fingerprint of the picture the page shows there (the route serves it only if it matches) */
export const livePhotoPath = (placeId: string, n: number, w: number, h: number, width?: number, fp?: string) => `/gphoto/${encodeURIComponent(placeId)}/${n}?s=${w}x${h}${fp ? `&f=${fp}` : ''}${width ? `&w=${width}` : ''}`;
export const isLivePhoto = (publicPath: string) => publicPath.startsWith('/gphoto/');
export const isLiveMarker = (s: string) => M.test(s);

/**
 * The business as it may be kept: review text, author and age become markers (the rating stays, as a number on the
 * card); reviews too short to quote are left out here, since their text can't be checked later.
 */
export function withLiveReviews(b: Business): Business {
  if (b.source !== 'places') return b;
  const reviews = b.reviews.map((r, i) => ({ r, i })).filter(({ r }) => r.text.trim().length >= 40)
    .map(({ r, i }) => ({ rating: r.rating, author: `⟦g:a:${b.placeId}:${i}⟧`, text: `⟦g:t:${b.placeId}:${i}:${r.rating}⟧`, relativeTime: r.relativeTime ? `⟦g:w:${b.placeId}:${i}⟧` : undefined }));
  return { ...b, reviews };
}

/**
 * The business's photos as they may be kept: a Google listing photo becomes a reference to its place in the listing and
 * its size ("google-listing:<placeId>#<n>", n numbered as /gphoto/<place>/<n> numbers it), the same reference the live
 * path resolves for each view (matchLive). Google's photo resource name and its authors are not kept: the image comes
 * from /gphoto/ and the credit from its marker, both fetched fresh. The business's own (website) photos are unchanged.
 * Safe to apply more than once.
 */
export function withLivePhotos<T extends Pick<Business, 'placeId' | 'photos'>>(b: T): T {
  if (!b?.photos?.length) return b;
  const google = b.photos.filter((p) => p.source !== 'website');
  const photos = b.photos.map((p) => {
    if (p.source === 'website' || !/^places\//.test(p.ref)) return p; // the business's own, a sample, or already a reference
    const { ref: _name, authors: _authors, localPath: _l, publicPath: _p, ...rest } = p;
    return { ...rest, ref: `google-listing:${b.placeId}#${google.indexOf(p)}`, authors: [], source: 'google' as const };
  });
  return { ...b, photos };
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s: string, max: number) => { const t = s.replace(/\s+/g, ' ').trim(); if (t.length <= max) return t; const cut = t.slice(0, max).replace(/\s+\S*$/, ''); return `${cut}…`; };

/** Fill every Google marker on a page for this view. Content Google no longer returns is hidden, never guessed. */
export async function fillGoogleContent(html: string, deps: { uri?: typeof livePhotoUri; photos?: typeof liveListingPhotos; reviews?: typeof liveReviews; download?: (name: string, widthPx: number) => Promise<Buffer>; page?: string } = {}): Promise<string> {
  if (!html.includes('⟦g:') && !html.includes('/gphoto/')) return html;
  const places = new Set([...html.matchAll(MG)].map((m) => m[2]));
  const photos = new Map<string, Awaited<ReturnType<typeof liveListingPhotos>> | null>();
  const reviews = new Map<string, Awaited<ReturnType<typeof liveReviews>> | null>();
  for (const p of places) {
    if (html.includes(`⟦g:c:${p}:`)) photos.set(p, await (deps.photos ?? liveListingPhotos)(p).catch(() => null));
    if (/⟦g:[atw]:/.test(html)) reviews.set(p, await (deps.reviews ?? liveReviews)(p).catch(() => null));
  }
  // each credited photo is verified once for this view (its candidate fetched from the exact display URL and fingerprinted); a photo that
  // cannot be verified gets no credit (its image route leaves it out too), and why is recorded
  const verdicts = new Map<string, LiveVerdict>();
  for (const m of html.matchAll(MG)) {
    if (m[1] !== 'c') continue;
    const k = `${m[2]}#${m[3]}:${m[4] ?? ""}:${m[5] ?? ""}`;
    if (verdicts.has(k)) continue;
    const ref = { placeId: m[2], n: Number(m[3]), size: m[4], fp: m[5] };
    const v = await verifyLivePhoto(photos.get(m[2]), ref, { ...deps, uri: deps.uri ?? livePhotoUri });
    verdicts.set(k, v);
    if (!v.ok) recordPhotoOmission(ref, v.reason, deps.page ?? 'a builder page');
  }
  const credit = (placeId: string, n: number, size: string | undefined, asHtml: boolean, fp?: string) => {
    const v = verdicts.get(`${placeId}#${n}:${size ?? ""}:${fp ?? ""}`);
    if (!v?.ok) return '';
    const p = v.photo;
    const names = p.authors.map((a) => a.name).join(', ') || 'Google user';
    if (!asHtml) return `Photo: ${names} · Google Maps`;
    const who = p.authors.length ? p.authors.map((a) => (a.uri ? `<a href="${escHtml(a.uri)}" target="_blank" rel="noopener">${escHtml(a.name)}</a>` : escHtml(a.name))).join(', ') : 'Google user';
    return `Photo: ${who} · ${p.mapsUri ? `<a href="${escHtml(p.mapsUri)}" target="_blank" rel="noopener" translate="no">Google Maps</a>` : '<span translate="no">Google Maps</span>'}`;
  };
  const review = (placeId: string, i: number) => reviews.get(placeId)?.reviews[i];
  // a review card whose review Google no longer returns (or that changed rating) is hidden
  let out = html.replace(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/g, (all, attrs: string, inner: string) => {
    const t = inner.match(/⟦g:t:([A-Za-z0-9_-]+):(\d+):(\d)⟧/);
    if (!t) return all;
    const r = review(t[1], Number(t[2]));
    // removed, not hidden: a page's own card styles can override the hidden attribute and show an empty card
    if (!r || Math.round(r.rating) !== Number(t[3])) return '';
    // an avatar letter rendered from the marker: the author's initial
    const initial = escHtml((r.author.trim()[0] || '?').toUpperCase());
    const fixed = inner.replace(/(<span class="(?:rv-av|fw-avatar)"[^>]*>)⟦[^<]*(<\/span>)/, `$1${initial}$2`).replace(/· Google review/g, r.mapsUri ? `· review on <a href="${escHtml(r.mapsUri)}" target="_blank" rel="noopener" translate="no">Google Maps</a>` : '· review on <span translate="no">Google Maps</span>');
    return `<figure${attrs}>${fixed}</figure>`;
  });
  // in scripts' JSON (the lightbox): plain text
  out = out.replace(new RegExp(`"(${M.source})"`, 'g'), (_a, _m: string, kind: string, placeId: string, n: string, extra?: string, fp?: string) =>
    JSON.stringify(kind === 'c' ? credit(placeId, Number(n), extra, false, fp) : ''));
  out = out.replace(MG, (_a, kind: string, placeId: string, n: string, extra?: string, fp?: string) => {
    if (kind === 'c') return credit(placeId, Number(n), extra, true, fp);
    const r = review(placeId, Number(n));
    if (!r) return '';
    if (kind === 'a') return r.authorUri ? `<a href="${escHtml(r.authorUri)}" target="_blank" rel="noopener">${escHtml(r.author)}</a>` : escHtml(r.author);
    if (kind === 'w') return escHtml(r.when ?? '');
    return escHtml(clip(r.text, 320));
  });
  // Remove failed image elements, responsive sources, preloads and gallery links too. Do not leave a grey stand-in.
  // a whole page is parsed as a document, so its doctype, <html lang>, <head> and <body> survive (a fragment parse drops
  // them, and a page without its doctype renders in quirks mode); a snippet stays a fragment
  const $ = load(out, {}, /^\s*(<!doctype\b|<html[\s>])/i.test(out));
  const replacements = new Map<string, string | null>();
  for (const el of $('[src], [srcset], [href]').toArray()) {
    const node = $(el);
    for (const attr of ['src', 'srcset', 'href']) {
      const value = node.attr(attr);
      if (!value?.startsWith('/gphoto/')) continue;
      const url = new URL(value.split(' ')[0], 'https://roger.invalid');
      const match = url.pathname.match(/^\/gphoto\/([A-Za-z0-9_-]+)\/(\d+)$/);
      if (!match) continue;
      const ref = { placeId: match[1], n: Number(match[2]), size: url.searchParams.get('s') ?? undefined, fp: url.searchParams.get('f') ?? undefined };
      const key = `${ref.placeId}#${ref.n}:${ref.size ?? ''}:${ref.fp ?? ''}`;
      if (!photos.has(ref.placeId)) photos.set(ref.placeId, await (deps.photos ?? liveListingPhotos)(ref.placeId).catch(() => null));
      let v = verdicts.get(key);
      if (!v) { v = await verifyLivePhoto(photos.get(ref.placeId), ref, { ...deps, uri: deps.uri ?? livePhotoUri }); verdicts.set(key, v); }
      if (!v.ok) {
        recordPhotoOmission(ref, v.reason, deps.page ?? 'a builder page');
        replacements.set(value, null);
        if (node.is('a')) node.removeAttr(attr); else node.remove();
      } else if (v.uri) { node.attr(attr, v.uri); replacements.set(value, v.uri); }
    }
  }
  $('picture, figure').each((_, el) => { if (!$(el).find('img').length && !$(el).text().trim()) $(el).remove(); });
  // The lightbox uses JSON photo URLs, not DOM attributes. Remove omitted entries and update verified URLs.
  $('script[type="application/json"]').each((_, el) => {
    try {
      const walk = (x: any): any => {
        if (typeof x === 'string') return replacements.has(x) ? replacements.get(x) : x;
        if (Array.isArray(x)) return x.map(walk).filter((v) => v !== null);
        if (x && typeof x === 'object') {
          if (Object.values(x).some((v) => typeof v === 'string' && replacements.get(v) === null)) return null;
          return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]));
        }
        return x;
      };
      $(el).text(JSON.stringify(walk(JSON.parse($(el).text()))).replace(/</g, '\\u003c'));
    } catch { /* not photo JSON */ }
  });
  return $.html();
}

/**
 * GET /gphoto/:placeId/:n?s=WxH&f=<fingerprint>&w=1600 → a redirect to Google's image for this view (a fresh, short-lived
 * address), only when the photo now at that place is the picture the page described (verifyLivePhoto: that one candidate,
 * fetched from the exact resolved display URL, has the same fingerprint). Otherwise this route returns 404 and records
 * the reason. Served HTML removes the failed image instead of leaving a placeholder. Sample listings (mock) serve their fixture file.
 */
export async function googlePhotoRoute(req: Request, res: Response, deps: { photos?: typeof liveListingPhotos; download?: typeof import("./places.js").downloadPhoto; uri?: typeof livePhotoUri } = {}) {
  const placeId = String(req.params.placeId);
  const n = Number(req.params.n);
  const size = typeof req.query.s === 'string' && /^\d+x\d+$/.test(req.query.s) ? req.query.s : undefined;
  const width = Math.min(1920, Math.max(200, Number(req.query.w) || 1600));
  res.set({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(placeId) || !Number.isInteger(n) || n < 0 || n > 50) return res.status(404).end();
  const fp = typeof req.query.f === 'string' && /^[0-9a-f-]{20,40}$/.test(req.query.f) ? req.query.f : undefined;
  const v = await verifyLivePhoto(await (deps.photos ?? liveListingPhotos)(placeId).catch(() => null), { placeId, n, size, fp }, { ...deps, uri: deps.uri ?? livePhotoUri, width });
  if (!v.ok) {
    let page = 'a builder page';
    try { if (req.headers.referer) page = new URL(String(req.headers.referer)).pathname; } catch { /* no page named */ }
    recordPhotoOmission({ placeId, n, size, fp }, v.reason, page);
    res.set({ 'x-photo-omitted': v.reason.slice(0, 160) });
    return res.status(404).end();
  }
  const p = v.photo;
  if (p.name.startsWith('file:')) return res.type(path.extname(p.name) || 'jpg').send(fs.readFileSync(path.resolve(config.dirs.fixtures, '..', p.name.slice(5))));
  const uri = v.uri;
  if (!uri) return res.status(404).end();
  res.redirect(302, uri);
}

/**
 * GET /gphoto/cover/:placeId?w=800 → a redirect to the listing's first Google photo as Google serves it now (the
 * listing card in the conversation, where the customer picks their business). Nothing is stored; the card that shows
 * it credits the photo's author. 404 when the listing has no photo (the card then shows its own image).
 */
export async function googleCoverRoute(req: Request, res: Response, deps: { photos?: typeof liveListingPhotos; uri?: typeof livePhotoUri } = {}) {
  const placeId = String(req.params.placeId);
  const width = Math.min(1200, Math.max(200, Number(req.query.w) || 800));
  res.set({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(placeId)) return res.status(404).end();
  const first = (await (deps.photos ?? liveListingPhotos)(placeId).catch(() => []))[0];
  if (!first) return res.status(404).end();
  if (first.name.startsWith('file:')) return res.type(path.extname(first.name) || 'jpg').send(fs.readFileSync(path.resolve(config.dirs.fixtures, '..', first.name.slice(5))));
  const uri = await (deps.uri ?? livePhotoUri)(first.name, width).catch(() => undefined);
  return uri ? res.redirect(302, uri) : res.status(404).end();
}
