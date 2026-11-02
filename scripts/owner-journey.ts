/**
 * Owner journey in a real browser (QA): build → owner link → preview → customise → save → reload → buy (demo) →
 * success → domain guidance → simulated verification → resume later. Run against a server started with an
 * isolated DATA_DIR/OUT_DIR and MOCK=1, e.g.  BASE=http://localhost:4100 npx tsx scripts/owner-journey.ts
 * Screenshots go to out/qa/owner (or QA_OUT).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { config } from '../src/config.js';

const BASE = process.env.BASE || 'http://localhost:4100';
const PLACE = process.argv[2] || 'mock-demo-copperleaf';
const OUT = process.env.QA_OUT || path.join(config.dirs.out, 'qa', 'owner');
fs.mkdirSync(OUT, { recursive: true });
const problems: string[] = [];
const ok = (cond: unknown, msg: string) => { if (!cond) problems.push(msg); console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`); };
const j = async (p: string, init?: RequestInit) => { const r = await fetch(BASE + p, init); return { status: r.status, body: await r.json().catch(() => ({})) as any }; };

console.log(`build ${PLACE}`);
const built = await j('/api/build?wait=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ placeId: PLACE, audit: false, wait: true }) });
const draftId = built.body.draftId as string;
ok(draftId, 'build created a draft');
const link = await j(`/api/drafts/${draftId}/owner-link`, { method: 'POST' });
const url = link.body.url as string;
ok(/#k=rk_/.test(url), 'owner link has a key in the fragment');

// scope: no key, wrong key, other draft
ok((await j(`/api/owner/${draftId}`)).status === 401, 'owner API refuses requests without a key');
ok((await j(`/api/owner/${draftId}`, { headers: { authorization: 'Bearer rk_wrongwrongwrongwrongwrong' } })).status === 401, 'owner API refuses a wrong key');

const browser = await chromium.launch({ executablePath: config.chromiumPath, args: ['--no-sandbox'] });
async function journey(width: number, height: number, tag: string, mobile: boolean) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, reducedMotion: tag.includes('rm') ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text()) && !/status of 400/.test(m.text())) errors.push(`${m.text()} ${m.location().url}`); });
  page.on('response', (r) => { if (r.status() === 404) errors.push(`404 ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#o-dock:not([hidden])', { timeout: 20000 });
  await page.waitForFunction(() => (document.querySelector('#o-frame') as HTMLIFrameElement).contentDocument?.querySelector('h1'));
  await page.waitForSelector('#o-loading[hidden]', { state: 'attached' });
  ok(!page.url().includes('#k='), `${tag}: key removed from the address bar`);
  await page.screenshot({ path: path.join(OUT, `${tag}-1-preview.png`) });
  return { ctx, page, errors };
}

async function overlap(page: Page) {
  // the dock must not cover the frame's Roger widget launcher
  return page.evaluate(() => {
    const dock = document.querySelector('#o-dock')!.getBoundingClientRect();
    const f = document.querySelector('#o-frame') as HTMLIFrameElement;
    const w = f.contentDocument?.querySelector('.rw-launch, .rw') as HTMLElement | null;
    if (!w) return false;
    const r = w.getBoundingClientRect();
    return !(r.right < dock.left || r.left > dock.right || r.bottom < dock.top || r.top > dock.bottom);
  });
}

// ── desktop ──
{
  const { ctx, page, errors } = await journey(1440, 900, 'desktop', false);
  ok(!(await overlap(page)), 'desktop: dock clear of the Roger widget');
  await page.click('#o-customise');
  ok(await page.isVisible('#o-panel'), 'desktop: customise panel opens');
  ok(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab'), 'desktop: focus moves to the tabs');
  // colours: gradient preset
  await page.click('[data-act=mode][data-v=gradient]');
  await page.click('[data-act=gpreset][data-v=sunset]');
  await page.waitForFunction(() => /linear-gradient/.test((document.querySelector('#o-frame') as HTMLIFrameElement).contentDocument!.getElementById('rg-appearance')?.textContent || ''));
  ok(true, 'desktop: gradient applied live to the preview');
  ok(/Unsaved/.test(await page.textContent('#o-status') || ''), 'desktop: status says unsaved');
  // fonts
  await page.click('#tab-fonts');
  await page.click('[data-act=font][data-v=editorial]');
  await page.waitForFunction(() => /Fraunces|font-heading/.test((document.querySelector('#o-frame') as HTMLIFrameElement).contentDocument!.getElementById('rg-appearance')?.textContent || ''));
  // layout: section order
  await page.click('#tab-layout');
  await page.click('[data-act=layout][data-k=arrangement][data-v=b]');
  await page.waitForTimeout(600);
  await page.waitForSelector('#o-loading[hidden]', { state: 'attached' });
  // undo then redo arrangement
  await page.click('#o-undo');
  await page.waitForTimeout(700);
  await page.click('#tab-layout');
  await page.click('[data-act=layout][data-k=arrangement][data-v=b]');
  await page.waitForTimeout(700);
  // prices: edit first offering to a range, then an invalid range
  await page.click('#tab-prices');
  await page.click('#tp-prices details summary');
  await page.selectOption('#tp-prices select[data-f=kind]', 'range');
  await page.waitForTimeout(300);
  await page.fill('#tp-prices input[data-f=amount]', '120');
  await page.fill('#tp-prices input[data-f=max]', '80');
  await page.press('#tp-prices input[data-f=max]', 'Tab');
  ok(/higher/.test(await page.textContent('#err-0') || ''), 'desktop: invalid range is rejected with a message');
  await page.fill('#tp-prices input[data-f=max]', '240');
  await page.press('#tp-prices input[data-f=max]', 'Tab');
  const priced = await page.waitForFunction(() => /\$120–\$240/.test((document.querySelector('#o-frame') as HTMLIFrameElement).contentDocument?.body?.textContent || ''), undefined, { timeout: 8000 }).then(() => true, () => false);
  ok(priced, 'desktop: edited price shows in the preview');
  await page.screenshot({ path: path.join(OUT, 'desktop-2-customised.png') });
  // generate another design
  await page.click('#tab-layout');
  const before = await page.evaluate(() => (document.querySelector('#o-frame') as HTMLIFrameElement).contentDocument!.body.dataset.plan);
  await page.click('[data-act=generate]');
  await page.waitForFunction((b) => (document.querySelector('#o-frame') as HTMLIFrameElement).contentDocument?.body?.dataset.plan && (document.querySelector('#o-frame') as HTMLIFrameElement).contentDocument!.body.dataset.plan !== b, before, { timeout: 15000 });
  await page.waitForTimeout(400);
  const kept = await page.evaluate(() => (document.querySelector('#o-frame') as HTMLIFrameElement).contentDocument!.body.textContent || '');
  ok(/\$120–\$240/.test(kept), 'desktop: another design keeps the owner\'s prices');
  await page.screenshot({ path: path.join(OUT, 'desktop-3-generated.png') });
  // save
  await page.click('#o-save');
  await page.waitForFunction(() => /^Saved/.test(document.querySelector('#o-status')!.textContent || ''), undefined, { timeout: 15000 });
  ok(true, 'desktop: saved');
  const pub = await (await fetch(`${BASE}/sites/${built.body.slug}/`)).text();
  ok(/\$120–\$240/.test(pub) && /linear-gradient/.test(pub), 'shared preview shows the saved design');
  ok(!/owner\.js|o-dock|rk_|\/api\/owner/.test(pub), 'shared preview has no editor, checkout or key');
  ok(/noindex/.test(pub), 'shared preview is noindex');
  // reload restores the saved design
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#o-dock:not([hidden])');
  await page.waitForFunction(() => (document.querySelector('#o-frame') as HTMLIFrameElement).contentDocument?.querySelector('h1'));
  const re = await page.evaluate(() => (document.querySelector('#o-frame') as HTMLIFrameElement).contentDocument!.body.textContent || '');
  ok(/\$120–\$240/.test(re) && /Saved/.test(await page.textContent('#o-status') || ''), 'desktop: reload restores the saved design');
  // keyboard: Escape closes the panel and returns focus
  await page.click('#o-customise');
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => document.activeElement?.id === 'o-customise'), 'desktop: Escape closes the panel, focus returns to Customise');
  // checkout
  await page.click('#o-buy');
  await page.waitForSelector('#o-checkout[open]');
  ok(/Demo checkout — no payment will be taken/.test(await page.textContent('#o-checkout') || ''), 'checkout says no payment is taken');
  ok(/Demo price/.test(await page.textContent('#o-checkout') || ''), 'checkout labels the demo price');
  await page.screenshot({ path: path.join(OUT, 'desktop-4-review.png') });
  await page.click('[data-co=to-details]');
  ok(!(await page.$('#o-checkout input[name*=card], #o-checkout input[autocomplete^=cc-]')), 'no card number or CVC fields');
  await page.click('#o-co-form button[type=submit]');
  ok(/name/i.test(await page.textContent('#o-co-err') || ''), 'details form validates');
  await page.fill('[name=name]', 'Sam Owner');
  await page.fill('[name=email]', 'sam@example.test');
  await page.click('#o-co-form button[type=submit]');
  await page.screenshot({ path: path.join(OUT, 'desktop-5-confirm.png') });
  await page.click('#o-complete');
  ok(/Tick the box/.test(await page.textContent('#o-co-err') || ''), 'confirm needs the demo acknowledgement');
  await page.check('#o-ack');
  await page.click('#o-complete');
  await page.waitForSelector('.o-ref', { timeout: 20000 });
  ok(/Demo order created — no payment taken/.test(await page.textContent('#o-checkout') || ''), 'success says no payment taken');
  await page.screenshot({ path: path.join(OUT, 'desktop-6-success.png') });
  // domain: connect
  await page.click('[data-ob=choice][data-v=connect]');
  await page.fill('[name=domain]', 'not a domain');
  await page.click('#o-dom-form button[type=submit]');
  await page.waitForTimeout(400);
  ok(/doesn.t look like a domain/.test(await page.textContent('#o-dom-err') || ''), 'invalid domain rejected');
  await page.fill('[name=domain]', 'https://www.CopperleafPlumbing.com/');
  await page.selectOption('[name=provider]', 'cloudflare');
  await page.click('#o-dom-form button[type=submit]');
  await page.waitForSelector('.o-records');
  const guide = await page.textContent('#o-checkout') || '';
  const gOk = /copperleafplumbing\.com/.test(guide) && /DNS only/.test(guide) && /MX/.test(guide) && /nameservers/.test(guide);
  if (!gOk) console.log(guide.slice(0, 1500));
  ok(gOk, 'guide: domain, provider note, keep MX, no nameserver change');
  ok(await page.evaluate(() => [...document.querySelectorAll('.o-copy')].every((b) => (b as HTMLButtonElement).disabled)), 'placeholder values cannot be copied');
  await page.check('[data-ob=step][data-i="0"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'desktop-7-domain.png'), fullPage: false });
  // leave and resume later
  await page.click('[data-co=cancel]');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#o-dock:not([hidden])');
  ok(/Your order/.test(await page.textContent('#o-buy') || ''), 'resume: dock shows the order');
  await page.click('#o-buy');
  await page.waitForSelector('.o-records');
  ok(await page.isChecked('[data-ob=step][data-i="0"]'), 'resume: domain progress kept');
  await page.click('[data-ob=simulate]');
  await page.waitForSelector('text=Demo launch complete');
  ok(/Demo verification complete/.test(await page.textContent('#o-checkout') || ''), 'simulated verification completes the demo');
  await page.screenshot({ path: path.join(OUT, 'desktop-8-verified.png') });
  ok(!errors.length, `desktop: no script errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

// API checks after the purchase: real flags untouched, idempotent replay, stale revision
{
  const key = decodeURIComponent(url.split('#k=')[1]);
  const H = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const st = await j(`/api/owner/${draftId}`, { headers: H });
  const o = st.body.orders[0];
  ok(o.mode === 'demo' && o.payment.charged === false && o.real.published === false && o.onboarding.real.domainVerified === false && o.onboarding.demo.verified === true, 'order: demo mode, nothing charged, real flags false');
  const stale = await j(`/api/owner/${draftId}`, { method: 'PUT', headers: H, body: JSON.stringify({ revision: st.body.draft.revision - 1, appearance: {} }) });
  ok(stale.status === 409, 'stale save rejected (409)');
  const bad = await j(`/api/owner/${draftId}`, { method: 'PUT', headers: H, body: JSON.stringify({ revision: st.body.draft.revision, offerings: [{ id: 'x', name: 'X <b>', price: { kind: 'fixed', amount: -5, currency: 'USD' }, source: 'owner' }] }) });
  ok(bad.status === 400, 'negative price rejected (400)');
  const idem = 'replaytestreplaytest01';
  const a = await j(`/api/owner/${draftId}/orders`, { method: 'POST', headers: H, body: JSON.stringify({ idempotencyKey: idem, revision: st.body.draft.revision, owner: { name: 'A B', email: 'a@b.test' }, demoAcknowledged: true }) });
  const b = await j(`/api/owner/${draftId}/orders`, { method: 'POST', headers: H, body: JSON.stringify({ idempotencyKey: idem, revision: st.body.draft.revision, owner: { name: 'A B', email: 'a@b.test' }, demoAcknowledged: true }) });
  ok(a.status === 201 && b.status === 200 && a.body.order.id === b.body.order.id, 'same idempotency key returns the same order');
  // revoke
  await j(`/api/drafts/${draftId}/owner-link`, { method: 'DELETE' });
  ok((await j(`/api/owner/${draftId}`, { headers: H })).status === 401, 'revoked link stops working');
  const fresh = await j(`/api/drafts/${draftId}/owner-link`, { method: 'POST' });
  (globalThis as any).freshUrl = fresh.body.url;
}

// ── phone (touch, reduced motion) ──
{
  const u = (globalThis as any).freshUrl as string;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript('window.__name = (f) => f');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(u, { waitUntil: 'load' });
  await page.waitForSelector('#o-dock:not([hidden])');
  await page.waitForFunction(() => (document.querySelector('#o-frame') as HTMLIFrameElement).contentDocument?.querySelector('h1'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'phone-1-preview.png') });
  ok(!(await overlap(page)), 'phone: dock clear of the Roger widget');
  const dock = await page.evaluate(() => document.querySelector('#o-dock')!.getBoundingClientRect().right);
  ok(dock < 390 - 60, 'phone: dock leaves room for the widget');
  await page.tap('#o-customise');
  const sheet = await page.evaluate(() => { const r = document.querySelector('#o-panel')!.getBoundingClientRect(); return { b: r.bottom, w: r.width }; });
  ok(Math.abs(sheet.b - 844) < 2 && sheet.w >= 389, 'phone: panel is a bottom sheet');
  await page.tap('[data-act=mode][data-v=solid]');
  await page.tap('[data-act=preset][data-v=forest]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'phone-2-sheet.png') });
  await page.tap('#o-close');
  await page.tap('#o-min');
  ok(await page.isVisible('#o-restore'), 'phone: minimised to a restore button');
  await page.tap('#o-restore');
  ok(await page.isVisible('#o-dock'), 'phone: restored');
  const sizes = await page.evaluate(() => [...document.querySelectorAll('#o-dock button')].filter((b) => (b as HTMLElement).offsetParent).map((b) => b.getBoundingClientRect().height));
  ok(sizes.every((h) => h >= 44), 'phone: dock buttons are at least 44px tall');
  ok(!errors.length, `phone: no script errors${errors.length ? `: ${errors[0]}` : ''}`);
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'journey.json'), JSON.stringify({ place: PLACE, draftId, problems }, null, 2));
console.log(problems.length ? `\n${problems.length} problem(s)` : '\nall checks passed');
process.exit(problems.length ? 1 : 0);
