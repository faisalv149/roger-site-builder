// Add a site that was built before build history existed to the Studio's Sites list, from its files on disk
// (out/sites/<slug>/site.json + the audit report, if any). Re-running replaces the same record.
//   npx tsx scripts/import-site.ts <slug> [--source imessage|studio|api]
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { saveBuild, type BuildSource } from '../src/store.js';
import { auditCard, noWebsiteCard, siteCard } from '../src/imessage/cards.js';
import { slugify } from '../src/util/text.js';
import type { BuildResult } from '../src/pipeline.js';

const [slug] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
if (!slug) { console.error('usage: npx tsx scripts/import-site.ts <slug> [--source imessage]'); process.exit(1); }
const siteDir = path.join(config.dirs.sites, slug);
const s = JSON.parse(fs.readFileSync(path.join(siteDir, 'site.json'), 'utf8'));
const b = s.business;

// the audit: from the iMessage step ("<name> audit") or from the build itself (site slug)
let audit: BuildResult['audit'];
for (const dir of [slugify(`${b.name} audit`), slug]) {
  const f = path.join(config.dirs.reports, dir, 'audit.json');
  if (!fs.existsSync(f)) continue;
  const a = JSON.parse(fs.readFileSync(f, 'utf8'));
  const reportUrl = `${config.publicBaseUrl}/reports/${dir}/`;
  audit = { ...(a.audit || a), reportUrl, image: `${reportUrl}og.png` };
  break;
}
const shot = fs.existsSync(path.join(siteDir, 'preview.jpg'));
const cards = [
  ...(audit ? [auditCard(audit, audit.reportUrl, audit.image)] : b.website ? [] : [noWebsiteCard(b.name)]),
  siteCard({ name: b.name, url: s.urls.site, image: shot ? `${s.urls.site}preview.jpg` : s.urls.og, hadWebsite: !!b.website }),
];
const result: BuildResult = {
  slug, siteUrl: s.urls.site, siteDir, themeId: s.themeId, themeReason: 'Imported from an earlier build (steps and timings were not saved then)',
  business: { placeId: b.placeId, name: b.name, formattedAddress: b.formattedAddress, phone: b.phone, website: b.website, rating: b.rating, reviewCount: b.reviewCount, primaryTypeLabel: b.primaryTypeLabel },
  brand: s.brand, facts: s.facts, services: s.services.items.map((i: { label: string }) => i.label), hiddenSections: s.hidden || {},
  audit, cards, steps: [], totalMs: 0, warnings: s.warnings || [], mode: { mock: b.source === 'mock', claude: s.facts?.source === 'claude', screenshot: shot },
};
const createdAt = s.generatedAt || fs.statSync(path.join(siteDir, 'site.json')).mtime.toISOString();
const id = `imp-${slug}`.slice(0, 64);
saveBuild({ id, createdAt, finishedAt: createdAt, source: (flag('source') as BuildSource) || 'imported', status: 'done', result });
console.log(`saved ${id}: ${b.name} (${s.themeId})${audit ? `, audit ${audit.score}/100` : ''} → data/builds/${id}.json`);
