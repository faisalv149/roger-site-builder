import * as cheerio from 'cheerio';
import { studioDocs } from '../store.js';
import { stripUiDebris } from '../util/text.js';
import { getBrief } from './jobs.js';
import { getBody } from './snapshot.js';
import { ownLineSources } from './concepts/review.js';
import type { BusinessBrief, Fact, SiteInventory, SourceRef } from './schema.js';

/**
 * The site manifest: what the business's own website holds, ingested once, in a compact form the open planner can
 * read. It is built from the Studio brief job's saved crawl (pages, page HTML, pictures, documents, brand), so Roger's
 * crawler is the only thing that fetches; nothing here goes to the network, to Google or to Claude.
 *
 *   pages     every page read, with a short id the other items point to
 *   text      the business's own words: headings (its own lines), page paragraphs, its story, claims, testimonials
 *   services  each service with its description and the pages it is shown on
 *   menu      items read from its menus and price lists, with the price's status and the document page
 *   brand     logo, colours, fonts, each with its evidence
 *   images    usable pictures of its own (duplicates merged into one), with every page they appear on
 *   videos    videos embedded on its pages (one per video, whatever the embed address)
 *   review    every fact Roger is not sure of, and why: these are shown to the owner, never assumed
 *   missed    what the crawl did not read or could not use, and why
 *
 * Each item carries `src`: the page it came from (its id and URL), or the document and page for a PDF.
 */
export const MANIFEST_SCHEMA = 'roger.site-manifest';
export const MANIFEST_VERSION = 1;

export interface Src { page?: string; url: string; at?: string }
export type Status = 'verified' | 'review';
export interface SiteManifest {
  schema: typeof MANIFEST_SCHEMA; version: typeof MANIFEST_VERSION;
  businessKey: string; revision: number; briefHash: string; snapshotId: string; capturedAt: string;
  site: { home: string | null; pagesRead: number; partial: boolean };
  pages: { id: string; url: string; type: string; title?: string; words: number }[];
  facts: Record<'name' | 'category' | 'phone' | 'email' | 'address' | 'hours', { value: unknown; status: Status; src: Src[]; note?: string } | null>;
  text: { id: string; text: string; kind: 'heading' | 'paragraph' | 'story' | 'claim' | 'testimonial' | 'offer'; src: Src[]; status: Status; siteWide?: true; author?: string; /** an award or ranking claim: for the owner to confirm, never shown as fact */ flag?: 'award-claim' }[];
  services: { id: string; name: string; description?: string; status: Status; src: Src[]; images: string[] }[];
  /** options: sizes or variants, each with its own price (read from the page layout, so for review) */
  menu: { id: string; name: string; section?: string; description?: string; price?: { text: string; status: Status }; options?: { label: string; price: string }[]; /** pictures in the item's own block on the page (asset ids) */ images?: string[]; status: Status; src: Src[] }[];
  brand: {
    logo: { url: string; width?: number; height?: number; status: Status; src: Src[]; note?: string } | null;
    colours: { hex: string; role: string; status: Status; evidence: string }[];
    fonts: { family: string; role: string; source: string }[];
  };
  images: { id: string; url: string; w?: number; h?: number; alt?: string; uses: string[]; services: string[]; /** menu items this picture belongs to (it is in their block on the page) */ items?: string[]; src: Src[] }[];
  videos: { id: string; kind: string; url: string; title?: string; src: Src[] }[];
  review: { item: string; why: string }[];
  missed: { what: string; why: string }[];
  counts: Record<string, number>;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** a status the planner can act on: only "verified" is used as fact; everything else is for review */
const statusOf = (s: string | undefined): Status => (s === 'verified' ? 'verified' : 'review');

/** one video, whatever address its embed used: YouTube and Vimeo by their id, other files by their address without a query */
export function videoKey(url: string): string {
  const yt = url.match(/(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|shorts\/|v\/)|youtu\.be\/)([\w-]{11})/i);
  if (yt) return `youtube:${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vm) return `vimeo:${vm[1]}`;
  try { const u = new URL(url); return `${u.host}${u.pathname}`.toLowerCase(); } catch { return url.toLowerCase(); }
}

/** the readable paragraphs of a page's own content (not its header, navigation, footer, forms or scripts) */
export function paragraphsOf(html: string): string[] {
  const $ = cheerio.load(html);
  $('script,style,noscript,template,svg,header,nav,footer,form,[role="navigation"],[aria-hidden="true"],.cookie,#cookie,[class*="cookie"]').remove();
  const out: string[] = [];
  $('p, blockquote, li').each((_, el) => {
    if ($(el).find('p, li').length) return; // the innermost block only
    const t = stripUiDebris($(el).text().replace(/\s+/g, ' ').trim());
    if (t.length >= 60 && t.length <= 1500 && /[a-z]/.test(t) && !/^(©|copyright)/i.test(t)) out.push(t);
  });
  return [...new Set(out)];
}

/** a page that is the business's menu: by its type, its address, its title or its main heading */
export function isMenuPage(p: { type: string; url: string; title?: string; headings: { level: number; text: string }[] }): boolean {
  if (p.type === 'menu') return true;
  let path = '';
  try { path = new URL(p.url).pathname; } catch { /* keep empty */ }
  return /\bmenus?\b/i.test(path.replace(/[-_/]+/g, ' ')) || /\bmenus?\b/i.test(p.title ?? '') || p.headings.some((h) => h.level === 1 && /\bmenus?\b/i.test(h.text));
}

/** the text pieces of an element: each text-holding leaf on its own (so neighbouring boxes are never run together) */
function leaves($: cheerio.CheerioAPI, el: unknown): string[] {
  const out: string[] = [];
  const walk = (n: { type?: string; data?: string; children?: unknown[] }) => { if (n.type === 'text') { const t = (n.data ?? '').replace(/\s+/g, ' ').trim(); if (t) out.push(t); } else for (const c of n.children ?? []) walk(c as never); };
  walk(el as never);
  return out;
}
/** an <img>'s picture addresses: data-src / src (not a placeholder), and the largest of its srcset, made absolute */
function imageUrlsOf(img: { attr(name: string): string | undefined }, baseUrl?: string): string[] {
  // made absolute against the page; without one, kept as written
  const abs = (u: string) => { if (!baseUrl) return u; try { return new URL(u, baseUrl).href; } catch { return ''; } };
  const largest = (set: string | undefined) => (set ?? '').split(',').map((c) => c.trim().split(/\s+/)).filter((c) => c[0]).sort((a, b) => parseFloat(b[1] ?? '0') - parseFloat(a[1] ?? '0'))[0]?.[0];
  const cands = [img.attr('data-src'), img.attr('src'), largest(img.attr('data-srcset')), largest(img.attr('srcset'))];
  return cands.filter((u): u is string => !!u && !/^data:|placeholder|blank\.gif|spacer/i.test(u)).map(abs).filter(Boolean);
}
/** a picture's address as a comparable key: host and path (no scheme, no query) */
export const imageKey = (u: string) => { try { const x = new URL(u, 'https://x.invalid/'); return `${x.host}${x.pathname}`.toLowerCase(); } catch { return u.toLowerCase(); } };
/** award and ranking wording */
export const AWARD = /\b(?:awards?|award-winning|awarded|winners?|wins|won (?:the|an?|first|best|gold|silver)\b|voted|readers?'? (?:poll|choice)|#\s?1\b|number one|top[- ]rated|best of\b|best [\w-]+(?: [\w-]+)? in\b)/i;
const PRICE = /(?:[$£€]\s?\d+(?:[.,]\d{2})?(?:\s?[-–]\s?[$£€]?\s?\d+(?:[.,]\d{2})?)?)/;
/**
 * A menu page's items: each item heading under its section heading (h2 sections with h3 items, or h3 with h4), its own
 * text up to the next heading as the description, and a price written with it. The page's header, navigation and
 * footer are left out. Names are the business's own; a price is read from the layout (so it is marked for review).
 */
export type PageMenuItem = { name: string; section?: string; description?: string; price?: string; options?: { label: string; price: string }[]; images?: string[]; at: string };
export function menuOfPage(html: string, baseUrl?: string): PageMenuItem[] {
  const $ = cheerio.load(html);
  $('script,style,noscript,template,svg,header,nav,footer,form,[role="navigation"]').remove();
  const hs = $('h2,h3,h4').toArray();
  const level = (el: unknown) => Number(($(el as never).prop('tagName') as string).slice(1));
  const count = (n: number) => hs.filter((h) => level(h) === n).length;
  // items are the most numerous heading level; sections the level above it
  const itemLevel = [3, 4, 2].sort((a, b) => count(b) - count(a))[0];
  if (count(itemLevel) < 2) return [];
  const out: PageMenuItem[] = [];
  let section: string | undefined;
  for (const h of hs) {
    const lv = level(h);
    const name = stripUiDebris($(h).text().replace(/\s+/g, ' ').trim());
    if (!name) continue;
    if (lv < itemLevel) { section = name; continue; }
    if (lv !== itemLevel) continue;
    // the item's own text, piece by piece: what follows its heading up to the next heading (siblings), else its container's
    let block = $(h).nextUntil('h1,h2,h3,h4');
    let parts = block.toArray().flatMap((e) => leaves($, e));
    // an item wrapped in its own container: the largest ancestor (up to three levels) holding no other heading; its other
    // pieces are the item's (a price box, a description box beside the title box)
    if (!parts.length) {
      let box = $(h).parent();
      for (let up = 0; up < 3 && box.parent().length && box.parent().find('h1,h2,h3,h4').length === 1; up++) box = box.parent();
      if (box.find('h1,h2,h3,h4').length === 1) { const c = box.clone(); c.find('h1,h2,h3,h4').remove(); parts = c.toArray().flatMap((e) => leaves($, e)); block = box; }
    }
    // one price is the item's; several are its options (a size or a variant, each with its own price)
    const priced = parts.filter((p) => PRICE.test(p));
    const options = priced.length > 1 ? priced.map((p) => ({ label: p.replace(PRICE, '').replace(/^[\s/:–-]+|[\s/:–-]+$/g, '').trim(), price: p.match(PRICE)![0] })) : undefined;
    const price = priced.length === 1 ? priced[0].match(PRICE)![0] : name.match(PRICE)?.[0];
    // with one price, the rest of its piece is description ("Spiced, with whipped cream. $32.00"); with several, labels
    const rest = priced.length === 1 ? priced[0].replace(PRICE, '').replace(/^[\s/:–-]+|[\s/:–-]+$/g, '').trim() : '';
    const description = stripUiDebris([...parts.filter((p) => !PRICE.test(p)), rest].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim());
    // the pictures in the item's own block (its own evidence): the real address of a lazily loaded image, the largest of a srcset
    const images = [...new Set(block.find('img').addBack('img').toArray().flatMap((img) => imageUrlsOf($(img), baseUrl)))];
    out.push({ name: name.replace(PRICE, '').trim(), ...(section ? { section } : {}), ...(description && description.length <= 600 ? { description } : {}), ...(price ? { price } : {}), ...(options ? { options } : {}), ...(images.length ? { images } : {}), at: `h${lv}` });
  }
  return out;
}

/** Build the manifest from a saved brief revision (the latest when no revision is given). */
export async function buildManifest(businessKey: string, revision?: number): Promise<SiteManifest> {
  const { brief, inventory } = await getBrief(businessKey, revision);
  if (!brief || !inventory) throw new Error(`No saved brief for ${businessKey}${revision ? ` revision ${revision}` : ''}.`);
  return manifestOf(brief, inventory);
}

export async function manifestOf(brief: BusinessBrief, inv: SiteInventory): Promise<SiteManifest> {
  const review: SiteManifest['review'] = [];
  const missed: SiteManifest['missed'] = [];
  // pages: every one Roger read, with a short id
  const read = inv.pages.filter((p) => p.status === 'read' || p.status === 'rendered');
  const pid = new Map<string, string>();
  const pages = read.map((p, i) => { const id = `p${i + 1}`; pid.set(p.url, id); if (p.finalUrl) pid.set(p.finalUrl, id); return { id, url: p.finalUrl ?? p.url, type: p.type, ...(p.title ? { title: p.title } : {}), words: Math.round(p.textLength / 6) }; });
  const src = (url: string, at?: string): Src => ({ ...(pid.get(url) ? { page: pid.get(url) } : {}), url, ...(at ? { at } : {}) });
  const fromRefs = (refs: SourceRef[]) => refs.map((r) => (r.sourceType === 'website' ? src(r.url, r.locator) : { url: r.url, ...(r.locator ? { at: r.locator } : {}) }));
  for (const p of inv.pages.filter((x) => x.status === 'failed' || x.status === 'skipped')) missed.push({ what: `page ${p.url}`, why: `${p.status}${p.reason ? `: ${p.reason}` : ''}` });

  // facts: what the business is and how to reach it, each with its sources and status
  const factOf = <T>(f: Fact<T>, name: string) => {
    if (f.status === 'unknown' || f.value == null) { if (f.status === 'unknown') missed.push({ what: name, why: f.note ?? 'not found on the site' }); return null; }
    const st = statusOf(f.status);
    if (st === 'review') review.push({ item: name, why: f.status === 'conflicting' ? `sources disagree${f.note ? `: ${f.note}` : ''}` : f.note ?? 'read only weakly' });
    return { value: typeof f.value === 'object' && f.value && 'formatted' in (f.value as object) ? (f.value as unknown as { formatted: string }).formatted : f.value, status: st, src: fromRefs(f.sources), ...(f.note ? { note: f.note } : {}) };
  };
  const facts: SiteManifest['facts'] = {
    name: factOf(brief.identity.name, 'name'), category: factOf(brief.identity.category, 'category'), phone: factOf(brief.contact.phone, 'phone'),
    email: factOf(brief.contact.email, 'email'), address: factOf(brief.contact.address, 'address'), hours: factOf(brief.hours.website, 'hours (website)'),
  };

  // text: the business's own lines (headings), each kept once with every page it is on
  const text: SiteManifest['text'] = [];
  const byText = new Map<string, SiteManifest['text'][number]>();
  const addText = (t: string, kind: SiteManifest['text'][number]['kind'], s: Src, status: Status = 'verified', extra: Partial<SiteManifest['text'][number]> = {}) => {
    const k = `${kind === 'heading' ? 'h' : 'b'}:${norm(t)}`;
    if (!norm(t)) return;
    const had = byText.get(k);
    if (had) { if (!had.src.some((x) => x.url === s.url)) had.src.push(s); return; }
    const item = { id: `t${text.length + 1}`, text: t, kind, src: [s], status, ...extra };
    byText.set(k, item); text.push(item);
  };
  for (const l of ownLineSources(inv)) addText(l.text, 'heading', src(l.page, `h${l.level}`));
  // paragraphs from each page's own HTML (as Roger read it); a paragraph on three or more pages is site-wide boilerplate
  let bodiesMissing = 0;
  const bodies = new Map<string, string>();
  for (const p of read) {
    const html = await getBody(p.bodyHash);
    if (!html) { bodiesMissing++; continue; }
    bodies.set(p.url, html);
    for (const t of paragraphsOf(html)) addText(t, 'paragraph', src(p.url));
  }
  if (bodiesMissing) missed.push({ what: `page text of ${bodiesMissing} page(s)`, why: 'their saved HTML is not in the store' });
  for (const t of text) if (t.kind === 'paragraph' && t.src.length >= 3) t.siteWide = true;
  // an award or ranking ("Wins Best…", "Voted…", "Readers' Poll", "#1") is the business's own words, but a claim: the owner
  // confirms it before it is shown as fact
  for (const t of text) if (AWARD.test(t.text) && t.kind !== 'testimonial') { t.flag = 'award-claim'; t.status = 'review'; review.push({ item: `award claim ${t.id}: "${t.text.slice(0, 80)}"`, why: 'an award or ranking: confirm it with the owner before showing it; never present it as confirmed' }); }
  if (brief.story.value) addText(`${brief.story.value.heading}: ${brief.story.value.text}`, 'story', fromRefs(brief.story.sources)[0] ?? { url: inv.site.home ?? '' }, statusOf(brief.story.status));
  for (const c of brief.claims) if (c.value) { addText(c.value, 'claim', fromRefs(c.sources)[0] ?? { url: '' }, statusOf(c.status)); if (c.status !== 'verified') review.push({ item: `claim "${c.value.slice(0, 60)}"`, why: c.note ?? 'a claim stated once; confirm before showing it' }); }
  for (const t of brief.testimonials) addText(t.text, 'testimonial', fromRefs([t.source])[0], 'verified', { author: t.author });
  for (const o of brief.offers) { addText(`${o.label}${o.terms ? ` (${o.terms})` : ''}`, 'offer', fromRefs(o.sources)[0] ?? { url: o.destination }, 'review'); review.push({ item: `offer "${o.label}"`, why: 'offers change: confirm it is current' }); }

  // services, with every page that shows them
  const services: SiteManifest['services'] = brief.services.items.map((s) => {
    const st = s.status === 'verified' ? 'verified' as const : 'review' as const;
    if (st === 'review') review.push({ item: `service "${s.name}"`, why: 'named on the site, but not clearly as a service' });
    if (s.description && s.description.status !== 'verified' && s.description.value) review.push({ item: `description of "${s.name}"`, why: s.description.note ?? 'read only weakly' });
    return { id: s.id, name: s.name, ...(s.description?.value ? { description: s.description.value } : {}), status: st, src: [...new Map(s.evidence.map((e) => [e.url, src(e.url, e.locator)])).values()], images: s.assets };
  });
  for (const p of brief.services.proposals) review.push({ item: `possible service "${p.name}"`, why: p.why });

  // menu and price-list items (from the documents' text layer), with the document page
  const menu: SiteManifest['menu'] = brief.offerings.items.map((m) => {
    if (m.price && m.price.status !== 'verified') review.push({ item: `price of "${m.name}"`, why: m.price.how });
    return { id: m.id, name: m.name, ...(m.section ? { section: m.section } : {}), ...(m.description ? { description: m.description } : {}), ...(m.price ? { price: { text: m.price.text, status: statusOf(m.price.status) } } : {}), status: 'verified' as const, src: fromRefs(m.sources) };
  });
  for (const d of inv.documents.filter((x) => x.status !== 'read')) missed.push({ what: `document ${d.url}`, why: `${d.status}${d.reason ? `: ${d.reason}` : ''}` });
  for (const d of inv.documents.filter((x) => x.status === 'read' && x.items === 0)) missed.push({ what: `document ${d.url} (${d.kind})`, why: 'read, but no items could be taken from its text (a picture-only page, or a layout Roger cannot read reliably)' });
  // a picture in an item's own block is that item's: matched to the crawl's usable pictures (a duplicate to its original)
  const usableByKey = new Map<string, string>();
  for (const a of inv.assets.filter((x) => x.origin === 'website')) {
    if (a.outcome === 'usable') usableByKey.set(imageKey(a.url), a.id);
    else if (a.outcome === 'duplicate' && a.duplicateOf) usableByKey.set(imageKey(a.url), a.duplicateOf);
  }
  const itemImages = (it: PageMenuItem) => [...new Set((it.images ?? []).map((u) => usableByKey.get(imageKey(u))).filter((x): x is string => !!x && inv.assets.some((a) => a.id === x && a.outcome === 'usable')))];
  // a menu set out as a web page (not a PDF): its sections and items from the page's own headings
  const seenMenu = new Set(menu.map((x) => `${norm(x.section ?? '')}|${norm(x.name)}`));
  for (const p of read.filter(isMenuPage)) {
    const html = bodies.get(p.url);
    const items = html ? menuOfPage(html, p.url) : [];
    if (!items.length) { missed.push({ what: `menu items on ${p.url}`, why: html ? 'a menu page, but its items are in pictures or a layout Roger does not itemise' : 'its saved HTML is not in the store' }); continue; }
    for (const it of items) {
      const k = `${norm(it.section ?? '')}|${norm(it.name)}`;
      if (seenMenu.has(k)) continue;
      seenMenu.add(k);
      menu.push({ id: `m${menu.length + 1}`, name: it.name, ...(it.section ? { section: it.section } : {}), ...(it.description ? { description: it.description } : {}), ...(it.price ? { price: { text: it.price, status: 'review' as const } } : {}), ...(it.options ? { options: it.options } : {}), ...(itemImages(it).length ? { images: itemImages(it) } : {}), status: 'verified' as const, src: [src(p.url, it.at)] });
    }
    if (items.some((x) => x.price || x.options)) review.push({ item: `prices on ${p.title ?? p.url}`, why: 'read from the menu page layout (a price beside a name); confirm they are current' });
  }

  // brand: the logo (as a fact), colours (only measured ones count as verified) and fonts
  const lg = brief.brand.logo;
  const logo = lg.value ? { url: lg.value.url, ...(lg.value.width ? { width: lg.value.width } : {}), ...(lg.value.height ? { height: lg.value.height } : {}), status: statusOf(lg.status), src: fromRefs(lg.sources), ...(lg.note ? { note: lg.note } : {}) } : null;
  if (logo && logo.status === 'review') review.push({ item: 'logo', why: lg.note ?? 'found, but not confirmed as the business\'s logo' });
  if (!logo) missed.push({ what: 'logo', why: lg.note ?? 'no logo found' });
  const colours = brief.brand.colors.map((c) => ({ hex: c.hex.toUpperCase(), role: c.role, status: c.confidence === 'high' ? 'verified' as const : 'review' as const, evidence: c.evidence }));
  if (colours.some((c) => c.status === 'review')) review.push({ item: 'brand colours', why: `${colours.filter((c) => c.status === 'review').map((c) => `${c.hex} (${c.role})`).join(', ')}: measured with less than high confidence` });
  const fonts = brief.brand.fonts.map((f) => ({ family: f.family, role: f.role, source: f.source }));

  // images: the business's own usable pictures; a duplicate's pages join its original's
  const site = inv.assets.filter((a) => a.origin === 'website');
  const dupPages = new Map<string, string[]>();
  for (const a of site.filter((x) => x.outcome === 'duplicate' && x.duplicateOf)) dupPages.set(a.duplicateOf!, [...(dupPages.get(a.duplicateOf!) ?? []), ...a.pages]);
  const images: SiteManifest['images'] = site.filter((a) => a.outcome === 'usable').map((a) => ({
    id: a.id, url: a.url, ...(a.width ? { w: a.width } : {}), ...(a.height ? { h: a.height } : {}), ...(a.alt ? { alt: a.alt } : {}), uses: a.uses, services: a.services,
    ...(menu.some((m) => m.images?.includes(a.id)) ? { items: menu.filter((m) => m.images?.includes(a.id)).map((m) => m.id) } : {}),
    src: [...new Set([...a.pages, ...(dupPages.get(a.id) ?? [])])].map((u) => src(u)),
  }));
  if (images.length) review.push({ item: `${images.length} website picture(s)`, why: 'the business\'s own pictures, but the owner has not confirmed they may be used' });
  const rejected = site.filter((a) => a.outcome !== 'usable' && a.outcome !== 'duplicate');
  // why each was not used; a picture never looked at says why (over the download budget, judged by its name or role)
  const reasonOf = (a: (typeof site)[number]) => (a.outcome !== 'not-probed' ? a.outcome : a.examined === 'over-budget' ? 'not examined (over the download budget)' : a.examined === 'by-file-name' || a.examined === 'by-role' ? `not examined (judged ${a.examined.replace('by-', 'by its ').replace('-', ' ')})` : `not examined (${a.examined})`);
  const byOutcome = rejected.reduce<Record<string, number>>((m, a) => ({ ...m, [reasonOf(a)]: (m[reasonOf(a)] ?? 0) + 1 }), {});
  if (rejected.length) missed.push({ what: `${rejected.length} picture(s) not used`, why: Object.entries(byOutcome).map(([k, n]) => `${n} ${k}`).join(', ') });

  // videos: one per video, with every page that embeds it
  const vids = new Map<string, SiteManifest['videos'][number]>();
  for (const p of read) for (const v of p.videos ?? []) {
    const k = videoKey(v.url);
    const had = vids.get(k);
    if (had) { if (!had.src.some((x) => x.url === p.url)) had.src.push(src(p.url)); continue; }
    vids.set(k, { id: `v${vids.size + 1}`, kind: v.provider, url: v.url, ...(v.title ? { title: v.title } : {}), src: [src(p.url)] });
  }
  const videos = [...vids.values()];
  if (videos.length) review.push({ item: `${videos.length} video(s)`, why: 'embedded on the site; confirm they are the business\'s own and may be shown' });

  for (const c of brief.conflicts) review.push({ item: c.field, why: c.summary });
  const counts = { pages: pages.length, text: text.length, headings: text.filter((t) => t.kind === 'heading').length, paragraphs: text.filter((t) => t.kind === 'paragraph').length, siteWide: text.filter((t) => t.siteWide).length, services: services.length, menu: menu.length, colours: colours.length, fonts: fonts.length, images: images.length, imagesNotUsed: rejected.length, duplicatesMerged: site.filter((a) => a.outcome === 'duplicate').length, videos: videos.length, review: review.length, missed: missed.length };
  return {
    schema: MANIFEST_SCHEMA, version: MANIFEST_VERSION, businessKey: brief.businessKey, revision: brief.revision, briefHash: brief.briefHash, snapshotId: brief.snapshotId, capturedAt: brief.capturedAt,
    site: { home: inv.site.home, pagesRead: pages.length, partial: inv.coverage.partial },
    pages, facts, text, services, menu, brand: { logo, colours, fonts }, images, videos, review, missed, counts,
  };
}

/** Build and save the manifest for a brief revision (one per revision). */
export async function saveManifest(businessKey: string, revision?: number): Promise<SiteManifest> {
  const m = await buildManifest(businessKey, revision);
  await studioDocs.put('studio-manifests', `${m.businessKey}--r${m.revision}`, m);
  return m;
}
export const getManifest = (businessKey: string, revision: number) => studioDocs.get<SiteManifest>('studio-manifests', `${businessKey}--r${revision}`);

/** a word count of the manifest's own text, for the report */
export const manifestWords = (m: SiteManifest) => m.text.reduce((n, t) => n + words(t.text), 0);
