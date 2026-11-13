import { studioDocs } from './store.js';

/**
 * A preview link pinned to one saved version: /sites/<slug>/ keeps showing that version's copy whatever is built into
 * the draft's own folder afterwards. A link already sent to a client must never start showing something else, so a pin
 * never changes once made (pinning it to the same version again is a no-op; to another version, an error).
 */
export interface SitePin { slug: string; to: string; reason: string; versionId?: string; at: string }

const SLUG = /^[a-z0-9-]{1,120}$/i;
export async function getSitePin(slug: string): Promise<SitePin | undefined> {
  return SLUG.test(slug) ? (await studioDocs.get<SitePin>('site-pins', slug)) ?? undefined : undefined;
}
export async function pinSiteLink(slug: string, to: string, reason: string, versionId?: string): Promise<SitePin> {
  if (!SLUG.test(slug) || !SLUG.test(to)) throw new Error('a pin joins two site folders by name');
  const old = await getSitePin(slug);
  if (old && old.to !== to) throw new Error(`/sites/${slug}/ is already pinned to /sites/${old.to}/; a pinned link never changes`);
  if (old) return old;
  const pin: SitePin = { slug, to, reason, ...(versionId ? { versionId } : {}), at: new Date().toISOString() };
  await studioDocs.put('site-pins', slug, pin);
  return pin;
}
/** the path a request under /sites should be served from: a pinned slug is served from its version's copy */
export async function pinnedPath(url: string): Promise<string> {
  const m = url.match(/^\/([a-z0-9-]+)(\/[^]*)?$/i);
  if (!m) return url;
  const pin = await getSitePin(m[1]);
  return pin ? `/${pin.to}${m[2] ?? ''}` : url;
}
