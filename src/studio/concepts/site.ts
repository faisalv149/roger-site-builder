import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { persistDir, readOut } from '../../files.js';
import { setDir } from './render.js';
import { buildSite } from '../../pipeline.js';
import { getDraft, issueOwnerKey, ownerUrl, putDraft, saveDraft, withDraftLock, type DraftRecord } from '../../drafts.js';
import type { Appearance, LayoutChoice } from '../../design/schema.js';
import { studioDocs } from '../../store.js';
import { keepAlive, STALE_MS, HEARTBEAT_MS } from '../keepalive.js';
import { getBrief } from '../jobs.js';
import { getConceptSet } from './jobs.js';
import type { Concept } from './types.js';

/**
 * A chosen Phase 2 concept becomes the business's full site, through the existing builder: it researches the
 * business as usual (facts, photos, offerings, forms, SEO, review checks, the owner's draft), then the concept's design
 * is applied as the owner's own layout and appearance choices, so it is locked: edits refine it and keep its layout,
 * type, colour, shapes and image direction. "Try another design" switches to another of the set's three concepts,
 * never a random new one. Publishing stays behind the draft's gates (facts, photo rights, lead delivery).
 */
const HERO: Record<string, LayoutChoice['hero']> = { 'full-bleed': 'photo-led', split: 'split', 'type-collage': 'type-led' };
const GALLERY: Record<string, LayoutChoice['gallery']> = { mosaic: 'masonry', filmstrip: 'strip', 'feature-grid': 'large' };
const FONT: Record<string, Appearance['font']> = { grotesk: 'compact-grotesk', humanist: 'friendly-sans', serif: 'warm-serif', slab: 'editorial', display: 'heavy-grotesk' };

/** The concept's design, as the builder's layout and appearance choices. */
export function conceptDesign(c: Concept): { layout: LayoutChoice; appearance: Appearance } {
  const hero = c.sections.find((s) => s.kind === 'hero')?.variant;
  const gallery = c.sections.find((s) => s.kind === 'gallery')?.variant;
  const a = c.axes;
  const direction: LayoutChoice['direction'] = a.colorStrategy === 'brand-dominant' ? 'bold-direct'
    : a.imageryRole === 'lead' && hero === 'full-bleed' ? 'modern-premium'
    : a.typeVoice === 'serif' || a.typeVoice === 'humanist' ? 'local-trusted' : 'clean-professional';
  const r = c.tokens.radius;
  const hex = /^#[0-9A-Fa-f]{6}$/.test(c.tokens.colors.action) ? c.tokens.colors.action : /^#[0-9A-Fa-f]{6}$/.test(c.tokens.colors.brand) ? c.tokens.colors.brand : undefined;
  return {
    layout: { direction, ...(hero && HERO[hero] ? { hero: HERO[hero] } : {}), ...(gallery && GALLERY[gallery] ? { gallery: GALLERY[gallery] } : {}) },
    appearance: {
      ...(hex ? { color: { mode: 'solid' as const, accent: hex } } : {}),
      ...(FONT[a.typeVoice] ? { font: FONT[a.typeVoice] } : {}),
      corners: r <= 4 ? 'sharp' : r <= 12 ? 'soft' : 'round',
      buttons: r >= 20 ? 'pill' : r <= 4 ? 'square' : 'rounded',

    },
  };
}

/** Apply a concept to a built draft: saved as the owner's choices (locked), re-rendered on every page. */
export async function applyConcept(draftId: string, setId: string, concept: Concept): Promise<DraftRecord> {
  const { layout, appearance } = conceptDesign(concept);
  return withDraftLock(draftId, async () => {
    const d = (await getDraft(draftId))!;
    // a choice this business's content or the chosen style can't carry (a photo-led hero without a strong photo, a
    // gallery the style doesn't offer) is dropped, one at a time; the rest of the concept still applies
    const { hero, gallery, direction } = layout;
    const tries: LayoutChoice[] = [layout, { direction, gallery }, { direction, hero }, { direction }, {}];
    let saved: DraftRecord | undefined;
    let last: unknown;
    for (const t of tries) {
      const clean = Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined)) as LayoutChoice;
      try { saved = await saveDraft((await getDraft(draftId))!, { revision: d.revision, layout: clean, appearance }); break; }
      catch (e) { last = e; }
    }
    void hero; void gallery;
    if (!saved) throw last;
    saved.concept = { setId, conceptId: concept.id };
    await putDraft(saved);
    await writeConceptHome(saved);
    return saved;
  });
}

export interface SiteJob {
  id: string; setId: string; conceptId: string; status: 'queued' | 'running' | 'done' | 'failed';
  stages: { name: string; status: 'running' | 'done' | 'failed'; ms?: number; note?: string }[];
  createdAt: string; updatedAt: string; startedAt?: string; finishedAt?: string; resumes: number;
  siteUrl?: string; ownerUrl?: string; draftId?: string; review?: { status: string; checks: { id: string; level: string; message: string }[] }; error?: string;
  /** switched among the set's saved concepts (re-render only), rather than built */
  switched?: boolean;
}
const save = (j: SiteJob) => studioDocs.put('studio-site-jobs', j.id, { ...j, updatedAt: new Date().toISOString() });
export const getSiteJob = (id: string) => studioDocs.get<SiteJob>('studio-site-jobs', id);

async function ownerLink(draftId: string) {
  return withDraftLock(draftId, async () => { const d = (await getDraft(draftId))!; const key = issueOwnerKey(d); await putDraft(d); return ownerUrl(d, key); });
}

/** Start (or switch) the site for a set's concept. A business with a draft from this set only switches design. */
export async function startSiteJob(setId: string, conceptId: string): Promise<SiteJob> {
  const set = await getConceptSet(setId);
  if (!set) throw new Error('No such concept set');
  if (!set.concepts.some((c) => c.id === conceptId)) throw new Error('conceptId must be a, b or c of this set');
  const now = new Date().toISOString();
  const job: SiteJob = { id: `sj_${randomBytes(6).toString('hex')}`, setId, conceptId, status: 'queued', stages: [], createdAt: now, updatedAt: now, resumes: 0 };
  await save(job);
  void keepAlive(runSiteJob(job.id));
  return job;
}

const running = new Map<string, Promise<void>>();
export function runSiteJob(id: string): Promise<void> {
  if (running.has(id)) return running.get(id)!;
  const p = run(id).finally(() => running.delete(id));
  running.set(id, p);
  return p;
}

async function run(id: string) {
  const job = (await getSiteJob(id))!;
  const set = (await getConceptSet(job.setId))!;
  const concept = set.concepts.find((c) => c.id === job.conceptId)!;
  job.status = 'running'; job.startedAt = new Date().toISOString(); job.stages = []; job.error = undefined;
  await save(job);
  const beat = setInterval(() => { void save(job); }, HEARTBEAT_MS);
  const stage = (name: string, status: SiteJob['stages'][number]['status'], extra: { ms?: number; note?: string } = {}) => {
    const s = job.stages.find((x) => x.name === name);
    if (s) Object.assign(s, { status, ...extra }); else job.stages.push({ name, status, ...extra });
    void save(job);
  };
  try {
    const { brief } = await getBrief(set.brief.businessKey, set.brief.revision);
    if (!brief) throw new Error('the brief this concept set was made from is missing');
    const placeId = brief.identity.listing?.placeId;
    const website = brief.identity.website.value ?? undefined;
    // a draft this set already built: switching concepts is a re-render, not a new build
    const existing = (await studioDocs.list<SiteJob>('studio-site-jobs')).find((j) => j.id !== job.id && j.setId === job.setId && j.status === 'done' && j.draftId);
    let draftId = existing?.draftId && (await getDraft(existing.draftId)) ? existing.draftId : undefined;
    if (!draftId) {
      const r = await buildSite({ placeId, website, audit: false, scoreNew: false }, (e) => { if (e.type === 'step') stage(e.step, e.status === 'start' ? 'running' : e.status === 'error' ? 'failed' : 'done', { ms: e.ms, note: e.note }); });
      draftId = r.draftId;
      job.review = r.review ? { status: r.review.status, checks: r.review.checks.filter((c) => c.level !== 'info').map((c) => ({ id: c.id, level: c.level, message: c.message })) } : undefined;
      if (!draftId) throw new Error('the build made no editable draft (the design pilot is off)');
    } else { job.switched = true; job.review = existing!.review; }
    const t = Date.now();
    stage(`Apply concept ${concept.id.toUpperCase()} "${concept.name}"`, 'running');
    const d = await applyConcept(draftId, set.id, concept);
    stage(`Apply concept ${concept.id.toUpperCase()} "${concept.name}"`, 'done', { ms: Date.now() - t, note: `${d.plan.direction} · ${d.plan.hero.variant} hero · ${d.sitePlan?.pages.length ?? 1} page(s)` });
    job.draftId = draftId;
    job.siteUrl = `${d.base.slug ? (await import('../../config.js')).config.publicBaseUrl : ''}/sites/${d.slug}/`;
    job.ownerUrl = await ownerLink(draftId);
    job.status = 'done'; job.finishedAt = new Date().toISOString();
  } catch (e) {
    job.status = 'failed'; job.error = (e as Error).message; job.finishedAt = new Date().toISOString();
  } finally {
    clearInterval(beat);
    await save(job);
  }
}

/** A job left running nowhere (its instance stopped) is started again by the poll that notices. */
export async function resumeSiteIfStale(j: SiteJob): Promise<SiteJob> {
  if ((j.status === 'running' || j.status === 'queued') && Date.now() - Date.parse(j.updatedAt) > STALE_MS() && !running.has(j.id)) {
    j.resumes++; j.status = 'queued'; await save(j);
    void keepAlive(runSiteJob(j.id));
  }
  return j;
}

/** The set's concept after the current one (a → b → c → a): "Try another design" never invents a fourth. */
export async function nextConcept(current: { setId: string; conceptId: string }): Promise<Concept | undefined> {
  const set = await getConceptSet(current.setId);
  if (!set?.concepts.length) return undefined;
  const i = set.concepts.findIndex((c) => c.id === current.conceptId);
  return set.concepts[(i + 1) % set.concepts.length];
}

/**
 * The homepage IS the chosen concept: its own rendered page from the Phase 2 renderer (same sections in the same order,
 * hero composition, photos, type, colours and spacing), not a translation into the builder's theme. The builder keeps
 * the inner pages, forms, SEO and owner editing; its home page lends the concept the SEO head (title, description,
 * canonical, structured data, social cards) and the links to the inner pages. Re-applied after every owner save.
 */
export async function writeConceptHome(d: DraftRecord): Promise<boolean> {
  if (!d.concept) return false;
  const set = await getConceptSet(d.concept.setId);
  const concept = set?.concepts.find((c) => c.id === d.concept!.conceptId);
  if (!set || !concept) return false;
  const cdir = setDir(set.id);
  const read = async (rel: string) => { const f = path.join(cdir, rel); return fs.existsSync(f) ? fs.readFileSync(f) : await readOut(`studio-concepts/${set.id}/${rel}`).catch(() => undefined); };
  const src = await read(`${concept.id}.html`);
  const siteDir = path.join(config.dirs.sites, d.slug);
  const homeFile = path.join(siteDir, 'index.html');
  if (!src || !fs.existsSync(homeFile)) return false;
  let html = src.toString('utf8');
  const legacy = fs.readFileSync(homeFile, 'utf8');
  // the concept's own pictures, copied into the site (Google listing photos stay live stand-ins, never copied)
  const dest = path.join(siteDir, 'assets', 'concept');
  fs.mkdirSync(dest, { recursive: true });
  for (const file of new Set([...html.matchAll(/(?:src|href)="img\/([A-Za-z0-9_.-]+)"/g)].map((m) => m[1]))) {
    const data = await read(`img/${file}`);
    if (data) fs.writeFileSync(path.join(dest, file), data);
  }
  html = html.replace(/((?:src|href)=")img\//g, '$1assets/concept/');
  // the SEO head from the builder's home page
  const pick = (re: RegExp) => [...legacy.matchAll(re)].map((m) => m[0]).join('\n');
  const title = legacy.match(/<title>[\s\S]*?<\/title>/)?.[0];
  const seo = [
    pick(/<meta name="(?:description|robots)"[^>]*>/g), pick(/<link rel="(?:canonical|icon|apple-touch-icon|manifest)"[^>]*>/g),
    pick(/<meta (?:property="og:|name="twitter:)[^>]*>/g), pick(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g),
  ].filter(Boolean).join('\n');
  html = html.replace(/<meta name="robots"[^>]*>/, '');
  if (title) html = html.replace(/<title>[\s\S]*?<\/title>/, title);
  html = html.replace('</head>', `${seo}\n</head>`);
  // the inner pages, after the concept's own section links
  const inner = (d.sitePlan?.pages ?? []).filter((p) => p.route && p.type !== 'home' && !p.offeringId);
  // a section link with the same name as an inner page ("Services") goes to that page instead of appearing twice
  const add: string[] = [];
  for (const p of inner) {
    const label = (p.navLabel ?? p.route.replace(/\/$/, '')).replace(/[<>&"]/g, '');
    const same = new RegExp(`<li><a href="#[a-z0-9-]+">${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</a></li>`);
    if (same.test(html)) html = html.replace(same, `<li><a href="${p.route}">${label}</a></li>`);
    else add.push(`<li><a href="${p.route}">${label}</a></li>`);
  }
  if (add.length) html = html.replace(/(<nav aria-label="Sections"><ul>[\s\S]*?)(<\/ul><\/nav>)/, `$1${add.join('')}$2`);
  fs.writeFileSync(homeFile, html);
  await persistDir(siteDir);
  return true;
}
