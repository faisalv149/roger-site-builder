import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { persistDir } from '../files.js';
import { esc, truncateWords } from '../util/text.js';
import type { AuditResult, Category } from './audit.js';
import type { PageSpeedResult, PsiCategory, PsiReport } from './pagespeed.js';

const FONT = "'Inter', 'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif";
const scoreColor = (s: number) => (s >= 90 ? '#15803D' : s >= 75 ? '#65A30D' : s >= 60 ? '#CA8A04' : s >= 40 ? '#EA580C' : '#DC2626');
const SEV_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' } as const;
const SEV_COLOR = { critical: '#B91C1C', high: '#C2410C', medium: '#A16207', low: '#475569' } as const;
const CAT_LABEL: Record<Category, string> = { security: 'Security', speed: 'Speed', mobile: 'Mobile', seo: 'Google search', accessibility: 'Accessibility', conversion: 'Getting leads', trust: 'Trust & accuracy' };
const PSI_LABEL: Record<PsiCategory, string> = { performance: 'Performance', accessibility: 'Accessibility', 'best-practices': 'Best practices', seo: 'SEO' };
// Google's own colour bands: 90-100 good, 50-89 needs improvement, 0-49 poor
const psiColor = (s: number) => (s >= 90 ? '#0C7A43' : s >= 50 ? '#C33300' : '#CC0F0F');
const FIELD_LABEL: Record<string, string> = { FAST: 'Good', AVERAGE: 'Needs improvement', SLOW: 'Poor' };

/** Google PageSpeed Insights: scores for both devices, Core Web Vitals, real-visitor data and every failing check. */
function pageSpeedSection(ps: Partial<PageSpeedResult> | undefined): string {
  if (!ps || !ps.reportUrl) return ''; // older audits: only the legacy mobile score, shown in the footer line
  const runs = [ps.mobile, ps.desktop].filter(Boolean) as PsiReport[];
  if (!runs.length) {
    if (!ps.error || ['no-key', 'disabled'].includes(ps.error.code)) return '';
    return `<h2>Google PageSpeed Insights</h2><p class="muted">Google's check couldn't run: ${esc(ps.error.message)}${ps.error.code === 'private-url' ? '' : ` <a href="${esc(ps.reportUrl)}" target="_blank" rel="noopener">Try it on Google</a>`}</p>`;
  }
  const ring = (label: string, s?: number) => (s === undefined ? '' : `<div class="psr"><svg viewBox="0 0 64 64" role="img" aria-label="${esc(label)} ${s} out of 100"><circle cx="32" cy="32" r="27" fill="none" stroke="#E2E8F0" stroke-width="6"/><circle cx="32" cy="32" r="27" fill="none" stroke="${psiColor(s)}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(s / 100) * 169.6} 169.6" transform="rotate(-90 32 32)"/><text x="32" y="38" text-anchor="middle" font-size="18" font-weight="700" fill="${psiColor(s)}">${s}</text></svg><span>${esc(label)}</span></div>`);
  const device = (r: PsiReport) => `<div class="psd"><h3>${r.strategy === 'mobile' ? 'Phones' : 'Computers'}</h3><div class="psrs">${(Object.keys(PSI_LABEL) as PsiCategory[]).map((c) => ring(PSI_LABEL[c], r.scores[c])).join('')}</div>
    <dl class="vitals">${[['Main content (LCP)', r.lab.lcp], ['First content (FCP)', r.lab.fcp], ['Blocking time (TBT)', r.lab.tbt], ['Layout shift (CLS)', r.lab.cls], ['Speed index', r.lab.si]].filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k!)}</dt><dd>${esc(v!)}</dd></div>`).join('')}</dl></div>`;
  const m = ps.mobile || ps.desktop!;
  const f = m.field;
  const field = f ? `<div class="field"><h3>Real visitors, last 28 days${f.scope === 'origin' ? ' (whole site)' : ''}${f.overall ? ` · <span style="color:${f.overall === 'FAST' ? '#0C7A43' : f.overall === 'AVERAGE' ? '#C33300' : '#CC0F0F'}">${FIELD_LABEL[f.overall]}</span>` : ''}</h3>
    <dl class="vitals">${[['Main content (LCP)', f.lcpMs !== undefined ? `${(f.lcpMs / 1000).toFixed(1)} s` : '', f.lcp], ['Response to taps (INP)', f.inpMs !== undefined ? `${f.inpMs} ms` : '', f.inp], ['Layout shift (CLS)', f.cls !== undefined ? String(f.cls) : '', f.clsCategory], ['Server response (TTFB)', f.ttfbMs !== undefined ? `${(f.ttfbMs / 1000).toFixed(1)} s` : '', '']].filter(([, v]) => v).map(([k, v, c]) => `<div><dt>${esc(k!)}</dt><dd>${esc(v!)}${c ? ` <small>${esc(FIELD_LABEL[c!] || '')}</small>` : ''}</dd></div>`).join('')}</dl></div>`
    : '<p class="muted small">Google has no real-visitor data for this site yet (it needs more traffic); the numbers above are from Google\'s test run.</p>';
  const groups = (Object.keys(PSI_LABEL) as PsiCategory[]).map((c) => {
    const list = m.findings.filter((x) => x.category === c);
    if (!list.length) return '';
    return `<details class="psf"><summary><b>${PSI_LABEL[c]}</b> · ${list.length} to fix · ${m.passedCount[c] ?? 0} passed</summary><ul>${list.map((x) => `<li><b>${esc(x.title)}</b>${x.displayValue ? ` <span class="dv">${esc(x.displayValue)}</span>` : ''}${x.items ? ` <span class="dv">${x.items} item${x.items === 1 ? '' : 's'}</span>` : ''}<p class="muted">${esc(x.description)}</p></li>`).join('')}</ul></details>`;
  }).join('');
  return `<h2>Google PageSpeed Insights</h2><div class="ps"><div class="psds">${runs.map(device).join('')}</div>${field}
    ${groups ? `<h3 style="margin-top:20px">Everything Google flagged (${m.strategy === 'mobile' ? 'phones' : 'computers'})</h3>${groups}` : '<p>Google found nothing to fix.</p>'}
    ${[...new Set(runs.flatMap((r) => r.warnings))].map((w) => `<p class="muted small">Google: ${esc(w)}</p>`).join('')}
    ${ps.error ? `<p class="muted small">${esc(ps.error.message)}</p>` : ''}
    <p class="muted small">Lighthouse ${esc(m.lighthouseVersion || '')} · ${new Date(m.fetchedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · <a href="${esc(ps.reportUrl)}" target="_blank" rel="noopener">Open the full report on Google</a></p></div>`;
}

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

/** Old site against the new Roger site: the same checks on both, the better value highlighted. */
function comparisonSection(a: AuditResult, n: AuditResult | undefined, siteUrl?: string): string {
  if (!n) return '';
  const pick = (r: AuditResult) => r.metrics.pagespeed?.mobile || r.metrics.pagespeed?.desktop;
  const om = pick(a);
  const nm = pick(n);
  type Row = [string, number | undefined, number | undefined, string?];
  const rows: Row[] = [['Roger\'s website check', a.score, n.score]];
  for (const c of ['performance', 'accessibility', 'best-practices', 'seo'] as PsiCategory[]) {
    const oldV = om?.scores[c] ?? (c === 'performance' ? a.metrics.pagespeed?.performance : undefined);
    rows.push([`Google ${c === 'seo' ? 'SEO' : PSI_LABEL[c].toLowerCase()}${om?.strategy === 'desktop' ? '' : ' (phones)'}`, oldV, nm?.scores[c]]);
  }
  const cell = (v: number | undefined, other: number | undefined) => (v === undefined ? '<td class="na">—</td>' : `<td><b style="color:${psiColor(v)}">${v}</b>${other !== undefined && v > other ? ' <span class="up">better</span>' : ''}</td>`);
  const lcp = (r?: PsiReport) => r?.lab.lcp || '—';
  const src = n.metrics.pagespeed?.source === 'local'
    ? 'New site measured with Lighthouse (the engine behind Google PageSpeed) on Roger\'s server, because Google can\'t reach a private preview; Google re-checks it once it\'s live.'
    : 'Both measured with Google PageSpeed Insights.';
  return `<h2>Your current site vs. your new site</h2><div class="cmp"><table><thead><tr><th scope="col"></th><th scope="col">Current site</th><th scope="col">New site</th></tr></thead><tbody>
    ${rows.filter(([, o, nv]) => o !== undefined || nv !== undefined).map(([k, o, nv]) => `<tr><th scope="row">${esc(k)}</th>${cell(o, nv)}${cell(nv, o)}</tr>`).join('')}
    <tr><th scope="row">Main content appears (phones)</th><td>${esc(lcp(om))}</td><td>${esc(lcp(nm))}</td></tr>
    <tr><th scope="row">Things to fix</th><td>${a.issues.length}</td><td>${n.issues.length}</td></tr></tbody></table>
    <p class="muted small">${esc(src)}</p>${siteUrl ? `<a class="cta" href="${esc(siteUrl)}">See the new site →</a>` : ''}</div>`;
}

export async function writeReport(slug: string, a: AuditResult, opts: { businessName?: string; siteUrl?: string; newSite?: AuditResult }): Promise<{ dir: string; url: string; image: string }> {
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
.small{font-size:13px}
.cmp{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px;overflow-x:auto}
.cmp table{width:100%;border-collapse:collapse;font-size:15px}.cmp th,.cmp td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line)}
.cmp thead th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.cmp td b{font-size:18px}.cmp .na{color:var(--muted)}
.up{display:inline-block;font-size:11px;font-weight:700;color:#0C7A43;background:#E7F6EE;border-radius:6px;padding:1px 6px;margin-left:4px}
.ps{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px}
.psds{display:grid;gap:20px}@media(min-width:720px){.psds{grid-template-columns:1fr 1fr}}
.psd h3,.field h3{font-size:15px;margin:0 0 10px}
.psrs{display:flex;gap:12px;flex-wrap:wrap}.psr{display:grid;justify-items:center;gap:4px;font-size:12px;color:var(--muted);width:72px;text-align:center}.psr svg{width:60px;height:60px}
.vitals{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin:12px 0 0}.vitals div{border-top:1px solid var(--line);padding-top:6px}.vitals dt{font-size:12px;color:var(--muted)}.vitals dd{margin:0;font-weight:700}.vitals small{font-weight:500;color:var(--muted)}
.field{margin-top:18px}
.psf{border-top:1px solid var(--line);padding:10px 0}.psf summary{cursor:pointer;min-height:32px}.psf ul{margin:8px 0 0}.psf li{padding:8px 0;border-bottom:1px dashed var(--line)}.dv{display:inline-block;font-size:12px;background:#F1F5F9;border-radius:6px;padding:1px 6px;margin-left:4px}
</style></head><body><main class="wrap">
<section class="top">
  <svg class="ring" viewBox="0 0 200 200" role="img" aria-label="Score ${a.score} out of 100"><circle cx="100" cy="100" r="84" fill="none" stroke="#E2E8F0" stroke-width="18"/><circle cx="100" cy="100" r="84" fill="none" stroke="${c}" stroke-width="18" stroke-linecap="round" stroke-dasharray="${(a.score / 100) * 527.8} 527.8" transform="rotate(-90 100 100)"/><text x="100" y="112" text-anchor="middle" font-size="48" font-weight="800" fill="#0F172A">${a.score}</text><text x="100" y="140" text-anchor="middle" font-size="14" fill="#64748B">grade ${a.grade}</text></svg>
  <div><p class="muted">Website check${opts.businessName ? ` for ${esc(opts.businessName)}` : ''}</p><h1>${esc(domain(a.finalUrl))}</h1><p>${esc(a.summary.headline)}</p><p class="muted" style="margin-top:8px">${esc(a.summary.pitch)}</p>
  ${opts.siteUrl ? `<a class="cta" href="${esc(opts.siteUrl)}">See your free new-site preview →</a>` : ''}</div>
</section>
${comparisonSection(a, opts.newSite, opts.siteUrl)}
<h2>Scores by area</h2><div class="cats">${cats}</div>
<h2>What to fix (${a.issues.length})</h2><ul>${issues || '<li class="issue"><span></span><div>No issues found.</div></li>'}</ul>
${pageSpeedSection(ps)}
${a.passed.length ? `<h2>What's already working</h2><ul class="passed">${a.passed.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
<p class="meta">Checked ${new Date(a.generatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · page ~${a.metrics.pageKb} KB · server ${a.metrics.ttfbMs} ms${(ps?.mobile?.scores.performance ?? ps?.performance) !== undefined ? ` · PageSpeed ${ps?.mobile?.scores.performance ?? ps?.performance}/100 on phones` : ''}</p>
</main></body></html>`;
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(path.join(dir, 'audit.json'), JSON.stringify(a, null, 2));
  await persistDir(dir); // on Vercel: so any server instance can serve the report
  return { dir, url, image };
}
