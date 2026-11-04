import { buildFromSnapshot } from './brief.js';
import { SCHEMA_VERSION, businessBrief, siteInventory, type BusinessBrief, type SiteInventory } from './schema.js';
import type { SourceSnapshot } from './snapshot.js';

/**
 * The job's last stage: checks on what was produced. "fail" means the brief can't be relied on as it is (it doesn't
 * validate, it isn't reproducible from its snapshot, Google content is mixed with owner content); "review" means the
 * owner or an operator must look (pages that failed, conflicts, unknowns); "pass" is fine.
 */
export interface QaCheck { id: string; level: 'pass' | 'review' | 'fail'; message: string }
export interface QaReport { status: 'pass' | 'needs-review' | 'fail'; checks: QaCheck[] }

export async function runQa(snapshot: SourceSnapshot, inventory: SiteInventory, brief: BusinessBrief): Promise<QaReport> {
  const checks: QaCheck[] = [];
  const add = (id: string, level: QaCheck['level'], message: string) => checks.push({ id, level, message });

  const vi = siteInventory.safeParse(inventory);
  const vb = businessBrief.safeParse(brief);
  add('schema', vi.success && vb.success ? 'pass' : 'fail', vi.success && vb.success ? `The inventory and the brief match their schemas (version ${SCHEMA_VERSION}).` : `Schema errors: ${[...(vi.success ? [] : vi.error.issues), ...(vb.success ? [] : vb.error.issues)].slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);

  // the same snapshot must give the same brief
  const again = await buildFromSnapshot(snapshot);
  add('deterministic', again.brief.briefHash === brief.briefHash ? 'pass' : 'fail', again.brief.briefHash === brief.briefHash ? `Rebuilt from snapshot ${snapshot.id}: the same brief (${brief.briefHash.slice(0, 12)}).` : `Rebuilding from snapshot ${snapshot.id} gave a different brief.`);

  const c = inventory.coverage;
  const home = inventory.pages.find((p) => p.type === 'home');
  if (inventory.site.home && (!home || home.status === 'failed')) add('coverage-home', 'fail', 'The home page could not be read.');
  else if (inventory.site.home) add('coverage', c.failed ? 'review' : 'pass', `${c.read + c.rendered} of ${c.discovered} pages read (${c.rendered} after running scripts), ${c.skipped} skipped, ${c.failed} failed${c.failed ? `: ${inventory.pages.filter((p) => p.status === 'failed').slice(0, 4).map((p) => `${new URL(p.url).pathname} (${p.reason})`).join(', ')}` : ''}.`);
  else add('coverage', 'review', 'No website: only the Google listing was read.');

  add('identity', brief.identity.status === 'verified' || brief.identity.status === 'website-only' ? 'pass' : 'review', `Identity ${brief.identity.status}${brief.identity.evidence.length ? `: ${brief.identity.evidence.join(', ')}` : ''}.`);
  const off = brief.offerings;
  add('services', brief.services.status === 'known' || off.status === 'known' ? 'pass' : 'review', brief.services.status === 'known' ? `${brief.services.items.length} services, each with where the business shows it${brief.services.proposals.length ? `; ${brief.services.proposals.length} more held for the owner` : ''}.` : off.status === 'known' ? `No services list; ${off.items.length} items read from the business's own PDFs (text layer only), each with its page.` : 'Services unknown: the owner is asked.');
  // linked PDFs: every one found is accounted for; a business document that was not read is for review
  const dc = inventory.coverage.documents;
  const unread = inventory.documents.filter((d) => d.status !== 'read' && d.kind !== 'other');
  if (dc.found) add('documents', unread.length ? 'review' : 'pass', `${dc.found} linked PDF(s): ${dc.read} read, ${dc.failed} failed, ${dc.skipped} not read${unread.length ? `: ${unread.slice(0, 3).map((d) => `${new URL(d.url).pathname.split('/').pop()} (${d.reason ?? d.status})`).join(', ')}` : ''}.`);
  // an item is never made from OCR alone: each comes from a text-layer page of a document that was read
  const readDocs = new Set(inventory.documents.filter((d) => d.status === 'read').map((d) => d.url));
  const orphan = off.items.filter((i) => !i.sources.length || i.sources.some((s) => !readDocs.has(s.url)));
  if (off.items.length || orphan.length) add('offerings', orphan.length ? 'fail' : 'pass', orphan.length ? `Items without a read document behind them: ${orphan.slice(0, 4).map((i) => i.name).join(', ')}.` : `${off.items.length} items, each from a page of a PDF that was read.`);
  // a disputed fact has no chosen value, and nothing public acts on it
  const disputedPhone = !!brief.contact.phone.candidates, disputedPlace = !!brief.contact.address.candidates;
  const publicCtas = [brief.callsToAction.primary, brief.callsToAction.secondary].filter(Boolean).map((c) => c!.href).concat(brief.callsToAction.booking ? [brief.callsToAction.booking] : []);
  const leaks = [
    ...(brief.contact.phone.candidates && brief.contact.phone.value !== null ? ['contact.phone has a value while disputed'] : []),
    ...(brief.contact.address.candidates && brief.contact.address.value !== null ? ['contact.address has a value while disputed'] : []),
    ...(disputedPhone && publicCtas.some((h) => /^tel:/i.test(h)) ? ['a call button uses a disputed number'] : []),
    ...(disputedPlace && brief.locations.primaryId ? ['a main location is chosen while the address is disputed'] : []),
  ];
  if (disputedPhone || disputedPlace) add('disputed', leaks.length ? 'fail' : 'pass', leaks.length ? leaks.join('; ') : `Disputed: ${[disputedPhone && 'phone', disputedPlace && 'address/location'].filter(Boolean).join(', ')}; no value chosen, ${brief.callsToAction.held.length} action(s) held until the owner answers.`);
  // one count of pictures: the summary adds up, and the brief repeats it
  const s = inventory.assetSummary.website, sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const web = inventory.assets.filter((a) => a.origin === 'website').length;
  const countsOk = sum(s.examined) === s.total && sum(s.outcomes) === s.total && s.total === web && brief.assets.website.total === s.total && brief.assets.website.usable === s.outcomes.usable && brief.assets.google.count === inventory.assetSummary.google.total;
  add('counts', countsOk ? 'pass' : 'fail', countsOk ? `Pictures: ${s.total} on the website (${s.outcomes.usable} usable), counted once in the inventory and repeated by the brief.` : `Picture counts disagree: summary ${s.total} (examined ${sum(s.examined)}, outcomes ${sum(s.outcomes)}), records ${web}, brief ${brief.assets.website.total}.`);
  add('conflicts', brief.conflicts.length ? 'review' : 'pass', brief.conflicts.length ? `${brief.conflicts.length} conflict(s): ${brief.conflicts.map((x) => x.field).join(', ')}.` : 'No conflicts between sources.');
  add('unknowns', brief.unknowns.length ? 'review' : 'pass', brief.unknowns.length ? `Unknown: ${brief.unknowns.map((u) => u.field).join(', ')}; each has an owner question.` : 'Nothing essential is unknown.');

  // Google content stays apart from the owner's pictures, and nothing is marked approved without the owner
  const g = inventory.assets.filter((a) => a.origin === 'google');
  const mixed = g.some((a) => a.rights !== 'google-restricted') || inventory.assets.some((a) => a.origin === 'website' && a.rights === 'owner-approved');
  add('rights', mixed ? 'fail' : 'pass', mixed ? 'A picture is marked approved without the owner, or a Google photo is not marked restricted.' : `${inventory.assets.filter((a) => a.origin === 'website').length} website pictures await the owner's confirmation; ${g.length} Google photos are preview-only.`);
  // every fact that is not unknown has a source
  const unsourced: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if ('status' in o && 'confidence' in o && 'sources' in o && o.status !== 'unknown' && Array.isArray(o.sources) && !o.sources.length) unsourced.push(path);
    for (const [k, x] of Object.entries(o)) if (k !== 'summary') walk(x, `${path}.${k}`);
  };
  walk(brief, 'brief');
  add('provenance', unsourced.length ? 'fail' : 'pass', unsourced.length ? `Facts without a source: ${unsourced.slice(0, 5).join(', ')}` : 'Every stated fact has a source.');
  if (brief.summary.status === 'rejected') add('summary', 'review', `The AI summary was discarded: ${brief.summary.reason}.`);

  const status: QaReport['status'] = checks.some((x) => x.level === 'fail') ? 'fail' : checks.some((x) => x.level === 'review') ? 'needs-review' : 'pass';
  return { status, checks };
}
