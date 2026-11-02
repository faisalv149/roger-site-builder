/**
 * Evidence of what publication produces (QA, fictional profiles, MOCK=1): for a multi-page and a one-page site, the
 * files, robots.txt, sitemap.xml, JSON-LD and redirect config at a primary origin, and again after a domain change.
 * Writes to out/qa/release/examples. Run with an isolated DATA_DIR/OUT_DIR.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { buildSite } from '../src/pipeline.js';
import { getDraft } from '../src/drafts.js';
import { publicationFiles } from '../src/publish.js';

if (!config.mock) { console.error('Run with MOCK=1.'); process.exit(1); }
const OUT = path.join(config.dirs.out, 'qa', 'release', 'examples');
fs.mkdirSync(OUT, { recursive: true });

const SITES = [{ id: 'mock-demo-copperleaf', label: 'multi-page' }, { id: 'mock-cat-marlow', label: 'one-page' }];
const origins = ['https://example-primary.vercel.app', 'https://www.example-business.test'];
let md = '# Publication examples\n\nGenerated from fictional QA profiles. The origins are placeholders; nothing was deployed.\n';

for (const s of SITES) {
  const built = await buildSite({ placeId: s.id, screenshot: false, audit: false });
  const d = (await getDraft(built.draftId!))!;
  md += `\n## ${built.business.name} (${s.label})\n`;
  for (const origin of origins) {
    const files = await publicationFiles(d, origin);
    const get = (f: string) => files.find((x) => x.file === f)?.data.toString('utf8');
    const dir = path.join(OUT, `${s.label}-${new URL(origin).hostname}`);
    for (const f of files.filter((x) => /\.(html|txt|xml|json)$/.test(x.file))) {
      fs.mkdirSync(path.dirname(path.join(dir, f.file)), { recursive: true });
      fs.writeFileSync(path.join(dir, f.file), f.data);
    }
    const ld = [...(get('index.html') ?? '').matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
    md += `\n### Origin ${origin}\n\nFiles: ${files.map((f) => f.file).filter((f) => /\.(html|txt|xml|json)$/.test(f)).join(', ')}\n\n` +
      `robots.txt\n\n\`\`\`\n${get('robots.txt')}\`\`\`\n\nsitemap.xml\n\n\`\`\`xml\n${get('sitemap.xml')}\`\`\`\n\n` +
      `Home JSON-LD\n\n\`\`\`json\n${JSON.stringify(ld, null, 2)}\n\`\`\`\n\nvercel.json\n\n\`\`\`json\n${get('vercel.json')}\n\`\`\`\n`;
  }
}
fs.writeFileSync(path.join(OUT, 'README.md'), md);
console.log(`wrote ${path.join(OUT, 'README.md')}`);
