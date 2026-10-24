// Smoke test / demo: builds the mock businesses (auto-picked layout) and the roofing demo in all six layouts.
// Requires the server to be running (the demo website + audit are served by it):  npm start  (MOCK=1)
import { config } from '../src/config.js';
const base = config.publicBaseUrl;
const jobs: Record<string, unknown>[] = [
  { google: 'Summit Peak Roofing 78704' },
  { google: 'BlueLine Plumbing Denver' },
  { google: 'Greenway Lawn Landscape Charlotte' },
  { google: 'ComfortPro Heating Air Tempe' },
];
if (process.argv.includes('--all-layouts')) {
  for (const v of ['urgent', 'showcase', 'trust', 'estimate', 'classic', 'minimal']) jobs.push({ google: 'Summit Peak Roofing 78704', themeId: `roofing-${v}`, audit: false, slug: `demo-roofing-${v}` });
}
const rows: string[] = [];
for (const j of jobs) {
  const t0 = Date.now();
  const r = await fetch(`${base}/api/build?wait=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(j) }).then((x) => x.json());
  if (r.error) { rows.push(`✗ ${JSON.stringify(j)} → ${r.error}`); continue; }
  rows.push(`✓ ${r.business.name.padEnd(28)} ${r.themeId.padEnd(22)} ${String(Date.now() - t0).padStart(5)}ms  brand ${r.brand.brand} (${r.brand.source})  ${r.audit ? `audit ${r.audit.score}/100` : 'no audit'}  hidden: ${Object.keys(r.hiddenSections).join(',') || '-'}  → ${r.siteUrl}`);
}
console.log(rows.join('\n'));
