import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { config } from '../config.js';
import type { Business } from '../types.js';
import { liveListingPhotos, livePhotoUri, liveReviews } from './places.js';
import { matchLive } from '../studio/concepts/listing-photos.js';

/**
 * Google listing content on the live builder's pages, within Google Maps Platform's terms (Terms of Service 3.2.3
 * (a)(b), Service Specific Terms 14; reviewed 2026-11-04): photos and review text are shown, never stored.
 *  - A photo is a link to /gphoto/<place>/<n>?s=<w>x<h>, which fetches Google's image for that view (only when the
 *    photo at that place in the listing is still the same size: a reordered listing never shows another photo).
 *  - A credit, a review's text, author and age are markers in the saved page, filled from a fresh Place Details call
 *    when the page is served, with the author's profile link and the "Google Maps" link to the source.
 * Nothing Google returns is written to disk, the store or a draft. Google photos stay preview-only (publish leaves them
 * out); the owner's own uploads replace them.
 */
const M = /⟦g:([actw]):([A-Za-z0-9_-]+):(\d+)(?::([0-9x]+))?⟧/;
const MG = new RegExp(M.source, 'g');
export const photoCreditMarker = (placeId: string, n: number, w: number, h: number) => `⟦g:c:${placeId}:${n}:${w}x${h}⟧`;
export const livePhotoPath = (placeId: string, n: number, w: number, h: number, width?: number) => `/gphoto/${encodeURIComponent(placeId)}/${n}?s=${w}x${h}${width ? `&w=${width}` : ''}`;
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

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s: string, max: number) => { const t = s.replace(/\s+/g, ' ').trim(); if (t.length <= max) return t; const cut = t.slice(0, max).replace(/\s+\S*$/, ''); return `${cut}…`; };

/** Fill every Google marker on a page for this view. Content Google no longer returns is hidden, never guessed. */
export async function fillGoogleContent(html: string, deps: { photos?: typeof liveListingPhotos; reviews?: typeof liveReviews } = {}): Promise<string> {
  if (!html.includes('⟦g:')) return html;
  const places = new Set([...html.matchAll(MG)].map((m) => m[2]));
  const photos = new Map<string, Awaited<ReturnType<typeof liveListingPhotos>> | null>();
  const reviews = new Map<string, Awaited<ReturnType<typeof liveReviews>> | null>();
  for (const p of places) {
    if (html.includes(`⟦g:c:${p}:`)) photos.set(p, await (deps.photos ?? liveListingPhotos)(p).catch(() => null));
    if (/⟦g:[atw]:/.test(html)) reviews.set(p, await (deps.reviews ?? liveReviews)(p).catch(() => null));
  }
  const credit = (placeId: string, n: number, size: string | undefined, asHtml: boolean) => {
    const p = matchLive(photos.get(placeId), n, size);
    if (!p) return asHtml ? 'Photo via <span translate="no">Google Maps</span>' : 'Photo via Google Maps';
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
  out = out.replace(new RegExp(`"(${M.source})"`, 'g'), (_a, _m: string, kind: string, placeId: string, n: string, extra?: string) =>
    JSON.stringify(kind === 'c' ? credit(placeId, Number(n), extra, false) : ''));
  out = out.replace(MG, (_a, kind: string, placeId: string, n: string, extra?: string) => {
    if (kind === 'c') return credit(placeId, Number(n), extra, true);
    const r = review(placeId, Number(n));
    if (!r) return '';
    if (kind === 'a') return r.authorUri ? `<a href="${escHtml(r.authorUri)}" target="_blank" rel="noopener">${escHtml(r.author)}</a>` : escHtml(r.author);
    if (kind === 'w') return escHtml(r.when ?? '');
    return escHtml(clip(r.text, 320));
  });
  return out;
}

/**
 * GET /gphoto/:placeId/:n?s=WxH&w=1600 → a redirect to Google's image for this view (a fresh, short-lived address).
 * Sample listings (mock) serve their fixture file.
 */
export async function googlePhotoRoute(req: Request, res: Response) {
  const placeId = String(req.params.placeId);
  const n = Number(req.params.n);
  const size = typeof req.query.s === 'string' && /^\d+x\d+$/.test(req.query.s) ? req.query.s : undefined;
  const width = Math.min(1920, Math.max(200, Number(req.query.w) || 1600));
  res.set({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(placeId) || !Number.isInteger(n) || n < 0 || n > 50) return res.status(404).end();
  const p = matchLive(await liveListingPhotos(placeId).catch(() => null), n, size);
  if (!p) return res.status(404).end();
  if (p.name.startsWith('file:')) return res.type(path.extname(p.name) || 'jpg').send(fs.readFileSync(path.resolve(config.dirs.fixtures, '..', p.name.slice(5))));
  const uri = await livePhotoUri(p.name, width).catch(() => undefined);
  if (!uri) return res.status(404).end();
  res.redirect(302, uri);
}
