import { COMPAT, MIN_GALLERY_PHOTOS, MIN_SLIDES, validatePlan, type DesignPlan, type DesignSectionId } from './schema.js';
import type { SiteContent } from './content.js';

/**
 * The owner's photo choices applied to a saved design plan at render time (the stored plan is unchanged):
 * an owner-chosen hero, team photo and gallery order win; omitted photos (and, for a publication, photos that
 * can't be published) are removed, and sections that would end up empty are left out. The result always passes
 * plan validation; if a choice can't fit, the closest valid layout is used.
 */
export function mediaExcluded(content: SiteContent | undefined, publishing: boolean): Set<string> {
  const out = new Set<string>();
  for (const m of content?.media ?? []) {
    if (m.role === 'omit') out.add(m.key);
    if (publishing && (!m.publishable || m.source === 'sample')) out.add(m.key);
  }
  return out;
}

export function applyMediaRoles(plan: DesignPlan, content: SiteContent | undefined, excluded: Set<string>): DesignPlan {
  if (!content && !excluded.size) return plan;
  const media = (content?.media ?? []).filter((m) => !excluded.has(m.key)).sort((a, b) => a.order - b.order);
  const byRole = (r: string) => media.filter((m) => m.role === r).map((m) => m.key);
  const C = COMPAT[plan.direction];
  const p: DesignPlan = structuredClone(plan);
  const ok = (k: string | null) => (k && !excluded.has(k) ? k : null);

  let hero: string | null = byRole('hero')[0] ?? ok(p.images.hero);
  const team = byRole('team')[0] ?? ok(p.images.team);
  let slides = p.images.slides.filter((k) => !excluded.has(k));
  if (byRole('hero')[0] && slides.length) slides = [byRole('hero')[0], ...slides.filter((k) => k !== byRole('hero')[0])];
  const used = new Set([hero, team].filter(Boolean) as string[]);
  const ownGallery = byRole('gallery').filter((k) => !used.has(k));
  const rest = p.images.gallery.filter((k) => !excluded.has(k) && !used.has(k) && !ownGallery.includes(k) && byRole('omit').indexOf(k) < 0);
  // photos with no role that aren't used yet can fill the gallery, in the owner's order
  const unassigned = media.filter((m) => !m.role && !used.has(m.key) && !ownGallery.includes(m.key) && !rest.includes(m.key) && m.key !== hero).map((m) => m.key);
  let gallery = [...ownGallery, ...rest, ...(ownGallery.length ? unassigned : [])].slice(0, 8);

  // hero variant follows what's available
  if (p.hero.variant === 'carousel') {
    if (slides.length < MIN_SLIDES) { p.hero.variant = hero && C.heroes.includes('split') ? 'split' : 'type-led'; slides = []; }
  } else slides = [];
  if (p.hero.variant === 'carousel') hero = slides[0] ?? hero;
  if ((p.hero.variant === 'split' || p.hero.variant === 'photo-led') && !hero) p.hero.variant = 'type-led';
  if (p.hero.variant === 'type-led' && byRole('hero')[0] && C.heroes.includes('split')) { p.hero.variant = 'split'; hero = byRole('hero')[0]; }
  if (p.hero.variant === 'type-led') { if (hero) gallery = [hero, ...gallery.filter((k) => k !== hero)].slice(0, 8); hero = null; }
  gallery = gallery.filter((k) => k !== hero && k !== team && !slides.includes(k));

  // sections that lost (or gained) their content
  let sections = p.sections.filter((s) => s.id !== 'hero').filter((s) => !(s.id === 'team' && !team));
  const gal = sections.find((s) => s.id === 'gallery');
  if (gal) {
    const fits = (v: string) => gallery.length >= (MIN_GALLERY_PHOTOS[v] ?? 2);
    if (!fits(gal.variant)) {
      const alt = (C.sections.gallery || []).find(fits);
      sections = alt ? sections.map((s) => (s.id === 'gallery' ? { ...s, variant: alt } : s)) : sections.filter((s) => s.id !== 'gallery');
    }
  } else if (gallery.length >= 3 && C.sections.gallery) {
    const v = C.sections.gallery.find((x) => gallery.length >= (MIN_GALLERY_PHOTOS[x] ?? 2));
    const at = sections.findIndex((s) => s.id === 'proof' || s.id === 'quote');
    if (v) sections.splice(at < 0 ? sections.length - 1 : at, 0, { id: 'gallery' as DesignSectionId, variant: v });
  }
  if (team && !sections.some((s) => s.id === 'team') && C.sections.team) {
    const at = sections.findIndex((s) => s.id === 'proof' || s.id === 'quote');
    sections.splice(at < 0 ? sections.length - 1 : at, 0, { id: 'team', variant: C.sections.team[0] });
  }
  if (!sections.some((s) => s.id === 'gallery')) gallery = [];
  p.sections = [{ id: 'hero', variant: p.hero.variant }, ...sections];
  p.images = { hero: p.hero.variant === 'type-led' ? null : hero, slides, team: sections.some((s) => s.id === 'team') ? team : null, gallery };
  const v = validatePlan(p);
  if (v.ok) return v.plan;
  // a combination the rules don't allow: drop the photos rather than show something broken
  const basic: DesignPlan = { ...p, hero: { variant: 'type-led' }, images: { hero: null, slides: [], team: null, gallery: [] }, sections: [{ id: 'hero', variant: 'type-led' }, ...sections.filter((s) => s.id !== 'team' && s.id !== 'gallery')] };
  const vb = validatePlan(basic);
  return vb.ok ? vb.plan : plan;
}
