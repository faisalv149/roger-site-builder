// Builds themes/general/general-<variant>.theme.json for businesses outside the five trades (gyms, salons, shops...).
// Each is a plumbing layout (same grid, type, sections, components and palette) with trade-neutral copy and no
// standard services: services come only from the business's own website or reviews (src/content/services.ts).
// Stand-ins until the designers ship real general themes.   npx tsx scripts/make-general-themes.ts
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';

const BASE = 'plumbing';
const VARIANTS = ['urgent', 'showcase', 'trust', 'estimate', 'classic', 'minimal'];
const outDir = path.join(ROOT, 'themes', 'general');
fs.mkdirSync(outDir, { recursive: true });
const indexFile = path.join(ROOT, 'themes', 'index.json');
const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
index.themes = index.themes.filter((e: { vertical: string }) => e.vertical !== 'general');
if (!index.verticals.includes('general')) index.verticals.push('general');

for (const v of VARIANTS) {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes', BASE, `${BASE}-${v}.theme.json`), 'utf8'));
  t.meta = {
    ...t.meta,
    name: t.meta.name.replace(/^Plumbing/, 'General'),
    vertical: 'general',
    description: `${t.meta.description} Trade-neutral copy for any local business.`,
    previewImage: `/themes/general-${v}.png`,
  };
  t.match = { googleTypes: [] }; // never matched by category: picked when no trade theme matches
  t.copy = {
    ...t.copy,
    hero: '{business}',
    heroNoCity: '{business}',
    subline: "{category} in {city}. Here's what we offer and how to reach us.",
    sublineNoServices: '{category} in {city}. Call, text or send us a message.',
    urgent: 'Need help right away? Call us now.',
    action: v === 'urgent' ? 'Call now' : 'Get in touch',
    quoteTitle: 'Send us a message',
    titles: { services: 'What we offer', gallery: 'Photos' }, // the defaults ("Recent work") read like a contractor
  };
  delete t.copy.maintenance;
  t.sections = t.sections.filter((s: string) => s !== 'maintenance');
  t.placeholders = [...new Set([...t.placeholders, '{category}'])];
  t.services = { defaults: [] };
  t.sectionRules.services = { ...t.sectionRules.services, min: 2 };
  t.trust = { ...t.trust, templates: { licensed: 'Licensed in {state}', insured: 'Fully insured', years: '{years} years in {city}', warranty: 'Guarantee on our work' } };
  t.roger = { ...t.roger, textPrefill: 'Hi, I have a question.' };
  t.seo = {
    ...t.seo,
    titlePattern: '{business} | {category} in {city}',
    descriptionPattern: '{business}: {category} in {city}. Hours, photos, reviews and how to get in touch.',
    schemaType: 'LocalBusiness',
  };
  t.stock = { hero: [{ url: '/stock/general-hero.svg', width: 1920, height: 1080, alt: 'Placeholder image: a row of local storefronts', source: 'stock' }], gallery: [] };

  const file = path.join(outDir, `general-${v}.theme.json`);
  fs.writeFileSync(file, `${JSON.stringify(t, null, 2)}\n`);
  index.themes.push({ id: `general-${v}`, vertical: 'general', variant: v, name: t.meta.name, file: `themes/general/general-${v}.theme.json`, brand: t.palette.brand, defaultPair: t.defaultPair, grid: t.grid.system, sections: t.sections });
  console.log('wrote', path.relative(ROOT, file));
}
// keep the package file's \uXXXX escapes so only the new entries show up in a diff
const ascii = (s: string) => s.replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
fs.writeFileSync(indexFile, `${ascii(JSON.stringify(index, null, 2))}\n`);
console.log('updated themes/index.json');
