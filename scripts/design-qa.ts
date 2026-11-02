// QA for the personalisation pilot (src/design): builds the plumbing fixtures through the API in the three
// directions and the sparse cases, refines them like the Studio and the iMessage flow do, and checks every page on
// desktop and phone. Bounded: one load per page and viewport, a fixed list of checks; nothing here runs during a
// normal build. Start a server on scratch folders first (keeps QA out of the real history):
//   PORT=4100 MOCK=1 CLAUDE_CLI=0 DATA_DIR=<tmp>/data OUT_DIR=<tmp>/out STUDIO_PASSWORD=qa-pass PUBLIC_BASE_URL=http://localhost:4100 npm start
//   npx tsx scripts/design-qa.ts http://localhost:4100 qa-pass out/qa/design
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { chromium, type Page } from 'playwright-core';
import { config } from '../src/config.js';

const [BASE = 'http://localhost:4100', PASS = '', OUT = 'out/qa/design'] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const AUTH: Record<string, string> = PASS ? { authorization: `Basic ${Buffer.from(`roger:${PASS}`).toString('base64')}` } : {};
const json = async (p: string, body?: unknown) => {
  const r = await fetch(`${BASE}${p}`, { method: body ? 'POST' : 'GET', headers: { ...AUTH, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
};

type Result = any;
interface Case { name: string; note: string; place?: string; themeId?: string; from?: string; refine?: { preferences?: Record<string, unknown>; alternative?: boolean; optIn?: boolean }; expect: (r: Result) => string[] }
const sec = (r: Result) => (r.design?.sections || []).map((s: any) => s.id);
const need = (cond: boolean, msg: string) => (cond ? [] : [msg]);

const CASES: Case[] = [
  { name: 'copperleaf-auto', note: 'rich data, recommended direction', place: 'mock-demo-copperleaf', expect: (r) => [...need(r.design?.direction === 'modern-premium', 'expected modern-premium'), ...need(sec(r).includes('team') && sec(r).includes('projects'), 'expected team + projects')] },
  { name: 'copperleaf-local-call', note: 'owner: Local & trusted, Call', from: 'copperleaf-auto', refine: { preferences: { style: 'local-trusted', goal: 'call' } }, expect: (r) => [...need(r.design?.direction === 'local-trusted', 'style not applied'), ...need(r.design?.goal === 'call', 'goal not applied')] },
  { name: 'copperleaf-bold', note: 'owner: Bold & direct, no emergency facts', from: 'copperleaf-auto', refine: { preferences: { style: 'bold-direct' } }, expect: (r) => [...need(r.design?.direction === 'bold-direct', 'style not applied'), ...need(!r.design?.emergency && !sec(r).includes('urgent'), 'bold must not add emergency claims')] },
  { name: 'copperleaf-alternative', note: 'alternative design', from: 'copperleaf-auto', refine: { alternative: true }, expect: (r) => need(r.design?.variation >= 1, 'expected a new variation') },
  { name: 'hearthstone-auto', note: 'team photo, modest data', place: 'mock-demo-hearthstone', expect: (r) => [...need(r.design?.direction === 'local-trusted', 'expected local-trusted'), ...need(sec(r).includes('team'), 'expected team section')] },
  { name: 'rapidrooter-auto', note: 'open 24h, drain focus', place: 'mock-demo-rapidrooter', expect: (r) => [...need(r.design?.direction === 'bold-direct', 'expected bold-direct'), ...need(r.design?.emergency && sec(r).includes('urgent'), 'expected verified emergency band'), ...need(r.design?.goal === 'call', 'expected call')] },
  { name: 'rapidrooter-premium', note: 'owner: Modern & premium on an urgent business', from: 'rapidrooter-auto', refine: { preferences: { style: 'modern-premium', service: 'Sewer line repair' } }, expect: (r) => [...need(r.design?.direction === 'modern-premium', 'style not applied'), ...need(/sewer/i.test(r.design?.service?.label || ''), 'service not applied')] },
  { name: 'bluebird-auto', note: 'remodel/fixtures focus, large photos', place: 'mock-demo-bluebird', expect: (r) => need(r.design?.direction === 'modern-premium', 'expected modern-premium') },
  { name: 'nightjar-appointment', note: 'owner: appointment + own service', place: 'mock-demo-nightjar', refine: { preferences: { goal: 'appointment', service: 'Tankless water heater installs' } }, expect: (r) => [...need(r.design?.goal === 'appointment', 'goal not applied'), ...need(r.design?.service?.label === 'Tankless water heater installs', 'custom service not applied')] },
  { name: 'juniperflats-auto', note: 'no photos', place: 'mock-demo-juniperflats', expect: (r) => [...need(r.design?.hero?.variant === 'type-led', 'expected type-led hero'), ...need(!sec(r).includes('projects') && !sec(r).includes('team'), 'no photo sections expected')] },
  { name: 'juniperflats-bold', note: 'no photos, Bold & direct', from: 'juniperflats-auto', refine: { preferences: { style: 'bold-direct', emergencyConfirmed: true } }, expect: (r) => need(r.design?.emergency === true && sec(r).includes('urgent'), 'owner-confirmed emergency should show') },
  { name: 'juniperflats-premium', note: 'no photos, Modern & premium', from: 'juniperflats-auto', refine: { preferences: { style: 'modern-premium' } }, expect: (r) => need(r.design?.hero?.variant === 'type-led', 'expected type-led hero') },
  { name: 'quietcreek-call', note: 'no phone, owner asks for Call', place: 'mock-demo-quietcreek', refine: { preferences: { goal: 'call' } }, expect: (r) => [...need(r.design?.goal === 'quote', 'call without phone must fall back to quote'), ...need(r.warnings.some((w: string) => /phone/.test(w)), 'expected a warning')] },
  { name: 'pebblepipe-auto', note: 'few reviews, small photo', place: 'mock-demo-pebblepipe', expect: (r) => need(!sec(r).includes('proof'), 'no reviews section expected with 3 reviews and no stated facts') },
  { name: 'ironwood-manual', note: 'explicit legacy theme', place: 'mock-demo-ironwood', themeId: 'plumbing-trust', expect: (r) => [...need(!r.design, 'manual theme must stay authoritative'), ...need(r.themeId === 'plumbing-trust', 'theme changed')] },
  { name: 'ironwood-optin', note: 'manual theme, operator opts in', from: 'ironwood-manual', refine: { preferences: { style: 'local-trusted' }, optIn: true }, expect: (r) => need(r.design?.direction === 'local-trusted', 'opt-in should personalise') },
  { name: 'larkspur-bold', note: 'customer photos only, Bold without emergency', place: 'mock-demo-larkspur', refine: { preferences: { style: 'bold-direct' } }, expect: (r) => need(!r.design?.emergency, 'no emergency claims expected') },
];

const results: Record<string, Result> = {};
const report: any[] = [];
const timings: { name: string; ms: number }[] = [];

// Saved plans make rebuilds of a business stable, so leftovers from an earlier run would change the results
const existing = (await json('/api/builds')).body.builds || [];
if (existing.length) { console.error(`This server already has ${existing.length} builds. Start it on empty DATA_DIR / OUT_DIR folders for QA.`); process.exit(1); }

// ── page checks, desktop + phone (run right after each build: a refinement updates the same preview address) ──
const browser = await chromium.launch({ executablePath: config.chromiumPath, args: ['--no-sandbox'] });
const VPS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;
async function open(page: Page, url: string) {
  await page.addInitScript('window.__name = (f) => f'); // tsx keeps function names with a helper the browser doesn't have
  await page.route('**/*', (rt) => (/^https?:\/\/(localhost|127\.0\.0\.1|fonts\.(googleapis|gstatic)\.com)/.test(rt.request().url()) ? rt.continue() : rt.abort()));
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(async () => { // load lazy images, then back to the top
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
    window.scrollTo(0, 0);
    document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in'));
  });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(250);
}
const pageChecks = (vw: number) => {
  const out: string[] = [];
  const info: Record<string, unknown> = {};
  if (document.documentElement.scrollWidth > vw) out.push(`horizontal overflow ${document.documentElement.scrollWidth}px`);
  const hs = [...document.querySelectorAll('h1,h2,h3')].filter((h) => (h as HTMLElement).offsetParent !== null || h.closest('.visually-hidden'));
  if (document.querySelectorAll('h1').length !== 1) out.push(`${document.querySelectorAll('h1').length} h1 elements`);
  let prev = 1;
  for (const h of hs) { const lvl = Number(h.tagName[1]); if (lvl > prev + 1) out.push(`heading skips from h${prev} to h${lvl}: "${h.textContent?.trim().slice(0, 40)}"`); prev = lvl; }
  const h1 = document.querySelector('h1') as HTMLElement;
  const lh = parseFloat(getComputedStyle(h1).lineHeight) || parseFloat(getComputedStyle(h1).fontSize) * 1.1;
  info.h1Lines = Math.round(h1.getBoundingClientRect().height / lh);
  if ((info.h1Lines as number) > (vw < 600 ? 5 : 3)) out.push(`hero headline wraps to ${info.h1Lines} lines`);
  for (const el of document.querySelectorAll('h1,h2,h3,.btn,.chip,.d-tag,.tag,.stat .v,.d-band-phone,.dh-phone')) {
    const e = el as HTMLElement;
    if (e.offsetParent && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible') out.push(`text clipped: "${e.textContent?.trim().slice(0, 30)}"`);
    if (e.offsetParent && e.getBoundingClientRect().right > vw + 1) out.push(`off-screen: "${e.textContent?.trim().slice(0, 30)}"`);
  }
  const broken = [...document.images].filter((i) => i.getAttribute('src') && i.complete && i.naturalWidth === 0 && !i.src.includes('maps')); // the photo viewer's empty slot has no src
  if (broken.length) out.push(`${broken.length} broken images`);
  const heroImg = document.querySelector('.dh picture img') as HTMLImageElement | null;
  if (heroImg) {
    const r = heroImg.getBoundingClientRect();
    info.heroCrop = { box: `${Math.round(r.width)}x${Math.round(r.height)}`, file: heroImg.currentSrc.split('/').pop(), natural: `${heroImg.naturalWidth}x${heroImg.naturalHeight}`, cssCrop: Math.abs(r.width / r.height - heroImg.naturalWidth / heroImg.naturalHeight) / (heroImg.naturalWidth / heroImg.naturalHeight) };
  }
  const secs = [...document.querySelectorAll('main > section, main > div > section')].map((s) => ({ id: s.id, pt: parseFloat(getComputedStyle(s).paddingTop), pb: parseFloat(getComputedStyle(s).paddingBottom) }));
  info.spacing = secs;
  for (const s of secs) if (s.id !== 'top' && s.pt < 16 && s.pb < 16) out.push(`section #${s.id} has almost no vertical padding`);
  const cta = document.querySelector('.dh .btn-row .btn, .hero .btn-row .btn') as HTMLElement | null;
  if (!cta) out.push('no call to action in the hero');
  else {
    const c = cta.getBoundingClientRect();
    info.ctaTop = Math.round(c.top);
    if (c.bottom > innerHeight) out.push(`primary call to action below the first screen (bottom ${Math.round(c.bottom)}px)`);
    const dock = document.querySelector('.rw-dock') as HTMLElement | null;
    const d = dock?.getBoundingClientRect();
    for (const b of document.querySelectorAll('.dh .btn-row .btn, .hero .btn-row .btn, .dh .d-credit')) {
      const r = b.getBoundingClientRect();
      if (d && d.height && r.bottom > d.top && r.top < d.bottom && r.right > d.left && r.left < d.right) out.push(`${b.classList.contains('d-credit') ? 'photo credit' : 'hero button'} "${b.textContent?.trim()}" is under the Roger widget`);
    }
    const href = cta.getAttribute('href') || '';
    info.primary = { text: cta.textContent?.trim(), href };
    const lum = (c: string) => { const m = c.match(/\d+(\.\d+)?/g)!.map(Number); const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    const cs = getComputedStyle(cta);
    const L1 = lum(cs.color), L2 = lum(cs.backgroundColor);
    info.ctaContrast = Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 10) / 10;
    if (!/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) && (info.ctaContrast as number) < 4.5) out.push(`primary button contrast ${info.ctaContrast}:1`);
  }
  for (const el of document.querySelectorAll('.btn, .form input, .form select, .form textarea')) {
    const r = (el as HTMLElement).getBoundingClientRect();
    if ((el as HTMLElement).offsetParent && r.height && r.height < 44) out.push(`small touch target (${Math.round(r.height)}px): "${(el.textContent || (el as HTMLInputElement).name || '').trim().slice(0, 24)}"`);
  }
  info.direction = document.body.dataset.direction;
  info.text = {
    hero: document.querySelector('.dh')?.textContent || '',
    bands: [...document.querySelectorAll('.d-band, .d-urgent, h1, h2')].map((e) => e.textContent).join(' '),
  };
  return { out: [...new Set(out)], info };
};

async function checkPages(row: any, r: Result) {
  row.pages = {};
  for (const [vp, size] of Object.entries(VPS)) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await open(page, r.siteUrl);
    const { out, info } = await page.evaluate(pageChecks, size.width);
    // keyboard focus is visible on the first hero button
    let focusOk = false;
    for (let i = 0; i < 25 && !focusOk; i++) {
      await page.keyboard.press('Tab');
      focusOk = await page.evaluate(() => { const a = document.activeElement as HTMLElement; if (!a?.closest('.dh .btn-row, .hero .btn-row')) return false; const s = getComputedStyle(a); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0; });
    }
    if (!focusOk && !errs.length) out.push('no visible keyboard focus on the hero buttons');
    // claims: no emergency language unless the plan allows it
    const t = info.text as { hero: string; bands: string };
    if (r.design && !r.design.emergency && /emergenc|24\/7|24 hours/i.test(`${t.hero} ${t.bands}`)) out.push('emergency wording without verified facts or owner confirmation');
    // primary action matches the goal and capabilities
    const prim = info.primary as { href: string } | undefined;
    if (r.design && prim) {
      if (r.design.goal === 'call' && !/^tel:\+1\d{10}$/.test(prim.href)) out.push(`goal is Call but the first button is ${prim.href}`);
      if (r.design.goal !== 'call' && prim.href !== '#quote') out.push(`goal is ${r.design.goal} but the first button is ${prim.href}`);
      if (!r.business.phone && (await page.$('.dh a[href^="tel:"]'))) out.push('call link without a phone number');
    }
    await page.screenshot({ path: path.join(OUT, `${row.case}-${vp}.png`), fullPage: true });
    if (vp === 'desktop' || vp === 'phone') await page.screenshot({ path: path.join(OUT, `${row.case}-${vp}-first.png`) });
    delete info.text;
    row.pages[vp] = { problems: [...out, ...errs.map((e) => `JS error: ${e}`)], ...info };
    await ctx.close();
  }
}

// leads: the request form posts a real lead with the right kind
async function leadCheck(name: string, r: Result) {
  const ctx = await browser.newContext({ viewport: VPS.desktop });
  const page = await ctx.newPage();
  await open(page, r.siteUrl);
  const f = page.locator('#quote form.lead-form');
  await f.locator('input[name=name]').fill('QA Visitor');
  await f.locator('input[name=phone]').fill('(555) 010-0000');
  const appt = await f.locator('input[name=preferredDate]').count();
  if (appt) { await f.locator('input[name=preferredDate]').fill(new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)); await f.locator('select[name=preferredTime]').selectOption('Morning'); }
  await f.locator('button[type=submit]').click();
  await page.waitForSelector('#quote form.lead-form.sent', { timeout: 10_000 }).catch(() => {});
  const sent = await f.evaluate((e) => e.classList.contains('sent'));
  const okText = await f.locator('.ok').textContent();
  const leads = (await json(`/api/leads/${r.slug}`)).body.leads || [];
  const lead = leads[0];
  const want = r.design.goal === 'appointment' ? 'appointment-request' : r.design.goal === 'call' ? 'message' : 'quote-request';
  const errors = [
    ...need(sent, 'form did not confirm'),
    ...need(lead?.kind === want, `lead kind ${lead?.kind} (want ${want})`),
    ...(want === 'appointment-request' ? [...need(lead?.status === 'requested' && !!lead?.preferredDate && lead?.preferredTime === 'Morning', 'appointment request fields missing'), ...need(/confirm/i.test(okText || ''), 'appointment confirmation copy missing')] : []),
  ];
  report.push({ case: `lead-${name}`, note: `submits the ${r.design.goal} form`, errors, lead: lead && { kind: lead.kind, preferredDate: lead.preferredDate, preferredTime: lead.preferredTime, status: lead.status } });
  await ctx.close();
}

// ── 1. builds + refinements through the API, each page checked straight away ──
const LEAD_CASES = new Set(['nightjar-appointment', 'hearthstone-auto', 'copperleaf-local-call']);
for (const c of CASES) {
  let base: Result;
  if (c.place) {
    const b = await json('/api/build?wait=1', { placeId: c.place, audit: false, themeId: c.themeId });
    if (b.status !== 200) { report.push({ case: c.name, errors: [`build failed: ${b.body.error}`] }); continue; }
    base = b.body;
    timings.push({ name: `${c.name} (first preview)`, ms: base.totalMs });
  } else base = results[c.from!];
  let r = base;
  const extra: string[] = [];
  if (c.refine) {
    if (c.name === 'ironwood-optin') { // without the opt-in the manual theme must be refused
      const refused = await json(`/api/builds/${base.jobId}/personalise`, { preferences: c.refine.preferences });
      if (refused.status !== 409) extra.push(`expected 409 without opt-in, got ${refused.status}`);
    }
    const x = await json(`/api/builds/${base.jobId}/personalise?wait=1`, c.refine);
    if (x.status !== 200) { report.push({ case: c.name, errors: [`refine failed (${x.status}): ${x.body.error}`] }); continue; }
    r = x.body;
    timings.push({ name: `${c.name} (refinement)`, ms: r.totalMs });
  }
  results[c.name] = r;
  const row = { case: c.name, note: c.note, siteUrl: r.siteUrl, plan: r.design ? { id: r.design.id, direction: r.design.direction, hero: r.design.hero.variant, goal: r.design.goal, service: r.design.service.label, sections: sec(r), emergency: r.design.emergency, typography: r.design.typography } : null, errors: [...extra, ...c.expect(r)] };
  report.push(row);
  await checkPages(row, r);
  if (LEAD_CASES.has(c.name)) await leadCheck(c.name, r);
  process.stdout.write(`${c.name} `);
}
console.log();

// ── 2. stability: an ordinary rebuild reuses the newest saved plan ──
{
  const before = results['copperleaf-alternative'].design;
  const again = (await json('/api/build?wait=1', { placeId: 'mock-demo-copperleaf', audit: false })).body;
  timings.push({ name: 'copperleaf ordinary rebuild', ms: again.totalMs });
  const same = ['id', 'direction', 'goal', 'typography'].every((k) => again.design?.[k] === before[k]) && JSON.stringify(again.design?.sections) === JSON.stringify(before.sections) && JSON.stringify(again.design?.images) === JSON.stringify(before.images) && again.design?.copy.headline === before.copy.headline;
  report.push({ case: 'stability-rebuild', note: 'ordinary rebuild after the alternative', plan: { id: again.design?.id }, errors: same ? [] : [`plan changed on rebuild: ${before.id} → ${again.design?.id}`] });
}

// ── 5. the three directions side by side, in greyscale (composition and type, not colour) ──
async function sheet(names: string[], vp: 'desktop' | 'phone', file: string) {
  const w = vp === 'desktop' ? 720 : 300;
  const tiles = await Promise.all(names.map((n) => sharp(path.join(OUT, `${n}-${vp}.png`)).extract({ left: 0, top: 0, width: VPS[vp].width, height: Math.min(VPS[vp].height * (vp === 'desktop' ? 2 : 3), 2600) }).resize({ width: w }).grayscale().png().toBuffer()));
  const metas = await Promise.all(tiles.map((t) => sharp(t).metadata()));
  const h = Math.max(...metas.map((m) => m.height || 0));
  const label = (t: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="40"><rect width="100%" height="100%" fill="#111"/><text x="12" y="27" font-family="Arial" font-size="18" fill="#fff">${t}</text></svg>`);
  await sharp({ create: { width: w * names.length + 20 * (names.length - 1), height: h + 40, channels: 3, background: '#fff' } })
    .composite(names.flatMap((n, i) => [{ input: label(n), left: i * (w + 20), top: 0 }, { input: tiles[i], left: i * (w + 20), top: 40 }]))
    .png().toFile(path.join(OUT, file));
}
await sheet(['copperleaf-auto', 'copperleaf-local-call', 'copperleaf-bold'], 'desktop', 'directions-grayscale-desktop.png');
await sheet(['copperleaf-auto', 'copperleaf-local-call', 'copperleaf-bold'], 'phone', 'directions-grayscale-phone.png');
await sheet(['juniperflats-auto', 'juniperflats-bold', 'juniperflats-premium'], 'desktop', 'sparse-directions-grayscale.png');

// ── 6. iMessage simulator: preview → personalise (three answers + emergency follow-up) → updated preview ──
{
  const from = `qa-sim-${Date.now()}`;
  const say = async (text: string) => (await json('/api/imessage/inbound', { from, text })).body;
  const errors: string[] = [];
  const steps: string[] = [];
  for (const t of ['Hi', 'Hearthstone Plumbing 83702', 'yes', 'yes']) steps.push(`${t} → ${(await say(t)).replies?.map((x: any) => x.text?.slice(0, 50)).join(' | ')}`);
  const flow: [string, RegExp][] = [['Personalise it', /focus on/i], ['Water heaters', /visitors do/i], ['Request an appointment', /feel/i], ['Bold & direct', /emergency/i], ['No', /updated preview/i]];
  for (const [t, expect] of flow) {
    const res = await say(t);
    const text = (res.replies || []).map((x: any) => x.text).join(' ');
    steps.push(`${t} → ${text.slice(0, 90)}`);
    if (!expect.test(text)) errors.push(`after "${t}" expected ${expect}`);
  }
  const convo = (await json(`/api/conversations/${encodeURIComponent(from)}`)).body;
  const last = (await json(`/api/builds/${convo.buildIds?.at(-1)}`)).body;
  const p = last.result?.design;
  errors.push(...need(p?.goal === 'appointment' && p?.direction === 'bold-direct' && p?.service.label === 'Water heaters' && p?.emergency === false, `simulator plan wrong: ${JSON.stringify(p && { goal: p.goal, direction: p.direction, service: p.service.label, emergency: p.emergency })}`));
  errors.push(...need(last.source === 'imessage' && last.from === from, 'refined build not linked to the conversation'));
  report.push({ case: 'simulator-personalise', note: 'iMessage questions → refined build', steps, errors });
}

// ── 7. Studio: Personalise this website on an open build ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, httpCredentials: { username: 'roger', password: PASS } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`JS error: ${e.message}`));
  await page.goto(`${BASE}/app/`, { waitUntil: 'networkidle' });
  await page.click('[data-tab="sites"]');
  await page.click('#sitesList .site-card:has(h3:text-is("Hearthstone Plumbing")) .site-open');
  await page.waitForSelector('#dz [data-pz-open]');
  await page.click('#dz [data-pz-open]');
  await page.check('#pzForm input[name="service"][value="__other"]', { force: true });
  await page.fill('#pzOther', 'Tankless water heaters');
  await page.check('#pzForm input[name="goal"][value="appointment"]', { force: true });
  await page.check('#pzForm input[name="style"][value="modern-premium"]', { force: true });
  const apptNote = await page.isVisible('[data-pz-appt]');
  await page.screenshot({ path: path.join(OUT, 'studio-personalise-form.png'), fullPage: false });
  await page.click('#pzForm button[type=submit]');
  await page.waitForFunction(() => /Modern & premium/.test(document.querySelector('#dz')?.textContent || ''), null, { timeout: 60_000 }).catch(() => errors.push('Studio did not show the updated plan'));
  await page.screenshot({ path: path.join(OUT, 'studio-personalised.png'), fullPage: false });
  const line = await page.$eval('#dz', (e) => e.textContent?.replace(/\s+/g, ' ').trim().slice(0, 200)).catch(() => '');
  errors.push(...need(apptNote, 'appointment note not shown'), ...need(/Tankless water heaters/.test(line || ''), 'custom service not in the summary'));
  report.push({ case: 'studio-personalise', note: 'Studio refinement with the three questions', summary: line, errors });
  await ctx.close();
}
await browser.close();

// ── report ──
const pageProblems = report.flatMap((r) => Object.entries(r.pages || {}).flatMap(([vp, p]: [string, any]) => p.problems.map((x: string) => `${r.case} ${vp}: ${x}`)));
const caseErrors = report.flatMap((r) => (r.errors || []).map((e: string) => `${r.case}: ${e}`));
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), timings, report }, null, 2));
const md = [`# Design QA (${new Date().toISOString().slice(0, 16)})`, '', `Cases: ${report.length} · case errors: ${caseErrors.length} · page problems: ${pageProblems.length}`, '',
  '| case | plan | desktop | phone |', '|---|---|---|---|',
  ...report.filter((r) => r.pages).map((r) => `| ${r.case} | ${r.plan ? `${r.plan.direction} · ${r.plan.hero} · ${r.plan.goal} · ${r.plan.service}` : 'no plan (theme kept)'} | ${r.pages.desktop.problems.length || 'ok'} | ${r.pages.phone.problems.length || 'ok'} |`),
  '', '## Problems', ...(caseErrors.length + pageProblems.length ? [...caseErrors, ...pageProblems].map((x) => `- ${x}`) : ['- none']),
  '', '## Timings (ms)', ...timings.map((t) => `- ${t.name}: ${t.ms}`)].join('\n');
fs.writeFileSync(path.join(OUT, 'report.md'), md);
console.log(md);
