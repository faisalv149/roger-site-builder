import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { esc, truncateWords } from '../util/text.js';
import type { AuditResult, Category } from './audit.js';

const FONT = "'Inter', 'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif";
const scoreColor = (s: number) => (s >= 90 ? '#15803D' : s >= 75 ? '#65A30D' : s >= 60 ? '#CA8A04' : s >= 40 ? '#EA580C' : '#DC2626');
const SEV_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' } as const;
const SEV_COLOR = { critical: '#B91C1C', high: '#C2410C', medium: '#A16207', low: '#475569' } as const;
const CAT_LABEL: Record<Category, string> = { security: 'Security', speed: 'Speed', mobile: 'Mobile', seo: 'Google search', conversion: 'Getting leads', trust: 'Trust & accuracy' };

function domain(u: string) { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } }

/** 1200×630 score card used as og:image so the report link renders as a rich card in iMessage. */
export async function writeScoreCard(file: string, a: AuditResult, businessName?: string) {
  const c = scoreColor(a.score);
  const R = 120, C = 2 * Math.PI * R;
  const dash = (a.score / 100) * C;
  const lines = a.issues.slice(0, 3).map((i, k) => `<text x="470" y="${318 + k * 62}" font-family="${FONT}" font-size="30" fill="#1F2937">• ${esc(truncateWords(i.title, 44))}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="#F8FAFC"/><rect width="1200" height="12" fill="${c}"/>
    <text x="64" y="96" font-family="${FONT}" font-size="30" font-weight="600" fill="#64748B">Website check${businessName ? ` · ${esc(truncateWords(businessName, 40))}` : ''}</text>
    <text x="64" y="150" font-family="${FONT}" font-size="46" font-weight="800" fill="#0F172A">${esc(domain(a.finalUrl))}</text>
    <g transform="translate(220,390)">
      <circle r="${R}" fill="none" stroke="#E2E8F0" stroke-width="26"/>
      <circle r="${R}" fill="none" stroke="${c}" stroke-width="26" stroke-linecap="round" stroke-dasharray="${dash} ${C}" transform="rotate(-90)"/>
      <text y="22" text-anchor="middle" font-family="${FONT}" font-size="92" font-weight="800" fill="#0F172A">${a.score}</text>
      <text y="68" text-anchor="middle" font-family="${FONT}" font-size="26" fill="#64748B">out of 100</text>
    </g>
    <text x="470" y="250" font-family="${FONT}" font-size="34" font-weight="700" fill="#0F172A">${a.issues.length ? `Top ${Math.min(3, a.issues.length)} things to fix` : 'Looking good'}</text>
    ${lines}
    <text x="470" y="560" font-family="${FONT}" font-size="24" fill="#64748B">${a.issues.length} issues found · tap to see the full report</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
}

export async function writeReport(slug: string, a: AuditResult, opts: { businessName?: string; siteUrl?: string }): Promise<{ dir: string; url: string; image: string }> {
  const dir = path.join(config.dirs.reports, slug);
  fs.mkdirSync(dir, { recursive: true });
  await writeScoreCard(path.join(dir, 'og.png'), a, opts.businessName);
  const url = `${config.publicBaseUrl}/reports/${slug}/`;
  const image = `${url}og.png`;
  const c = scoreColor(a.score);
  const cats = (Object.keys(a.categories) as Category[]).map((k) => `<div class="cat"><div class="row"><span>${CAT_LABEL[k]}</span><b>${a.categories[k]}</b></div><div class="bar"><i style="width:${a.categories[k]}%;background:${scoreColor(a.categories[k])}"></i></div></div>`).join('');
  const issues = a.issues.map((i) => `<li class="issue"><span class="sev" style="background:${SEV_COLOR[i.severity]}">${SEV_LABEL[i.severity]}</span><div><h3>${esc(i.title)}</h3><p class="muted">${esc(i.detail)}</p><p class="fix"><b>We'll fix it:</b> ${esc(i.fix)}</p></div></li>`).join('');
  const ps = a.metrics.pagespeed;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Website check: ${esc(domain(a.finalUrl))} scored ${a.score}/100</title>
<meta name="robots" content="noindex">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(domain(a.finalUrl))} scored ${a.score}/100">
<meta property="og:description" content="${esc(a.summary.headline)}"><meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<style>
:root{--ink:#0F172A;--muted:#64748B;--line:#E2E8F0;--bg:#F8FAFC}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--ink);background:var(--bg);line-height:1.5}
.wrap{max-width:880px;margin:0 auto;padding:32px 16px 64px}
.top{display:grid;gap:24px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px}
@media(min-width:720px){.top{grid-template-columns:200px 1fr}}
.ring{width:180px;height:180px;margin:0 auto}
h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:40px 0 12px}h3{font-size:17px;margin:0 0 4px}
.muted{color:var(--muted);margin:0}.fix{margin:8px 0 0}
.cats{display:grid;gap:14px;background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px}
@media(min-width:720px){.cats{grid-template-columns:1fr 1fr;column-gap:32px}}
.cat .row{display:flex;justify-content:space-between;font-size:15px}.bar{height:8px;background:var(--line);border-radius:8px;overflow:hidden;margin-top:6px}.bar i{display:block;height:100%}
ul{list-style:none;margin:0;padding:0}
.issue{display:grid;grid-template-columns:88px 1fr;gap:14px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:10px}
.sev{color:#fff;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border-radius:6px;padding:4px 8px;height:fit-content;text-align:center}
.passed li{padding:6px 0;border-bottom:1px solid var(--line)}.passed li::before{content:"✓  ";color:#15803D;font-weight:700}
.cta{display:inline-block;margin-top:16px;background:var(--ink);color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600}
.meta{font-size:13px;color:var(--muted);margin-top:32px}
</style></head><body><main class="wrap">
<section class="top">
  <svg class="ring" viewBox="0 0 200 200" role="img" aria-label="Score ${a.score} out of 100"><circle cx="100" cy="100" r="84" fill="none" stroke="#E2E8F0" stroke-width="18"/><circle cx="100" cy="100" r="84" fill="none" stroke="${c}" stroke-width="18" stroke-linecap="round" stroke-dasharray="${(a.score / 100) * 527.8} 527.8" transform="rotate(-90 100 100)"/><text x="100" y="112" text-anchor="middle" font-size="48" font-weight="800" fill="#0F172A">${a.score}</text><text x="100" y="140" text-anchor="middle" font-size="14" fill="#64748B">grade ${a.grade}</text></svg>
  <div><p class="muted">Website check${opts.businessName ? ` for ${esc(opts.businessName)}` : ''}</p><h1>${esc(domain(a.finalUrl))}</h1><p>${esc(a.summary.headline)}</p><p class="muted" style="margin-top:8px">${esc(a.summary.pitch)}</p>
  ${opts.siteUrl ? `<a class="cta" href="${esc(opts.siteUrl)}">See your free new-site preview →</a>` : ''}</div>
</section>
<h2>Scores by area</h2><div class="cats">${cats}</div>
<h2>What to fix (${a.issues.length})</h2><ul>${issues || '<li class="issue"><span></span><div>No issues found.</div></li>'}</ul>
${a.passed.length ? `<h2>What's already working</h2><ul class="passed">${a.passed.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
<p class="meta">Checked ${new Date(a.generatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · page ~${a.metrics.pageKb} KB · server ${a.metrics.ttfbMs} ms${ps ? ` · PageSpeed ${ps.performance}/100` : ''}</p>
</main></body></html>`;
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'audit.json'), JSON.stringify(a, null, 2));
  return { dir, url, image };
}
