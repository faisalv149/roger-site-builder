import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { draftDocs } from './store.js';
import { persistDir, readOut } from './files.js';
import { screenshot } from './render/og.js';
import { formatMoney } from './design/offerings.js';
import { DraftError, ensureLocalSite, summarisePlan, type DraftRecord } from './drafts.js';

/**
 * Demo purchase and domain onboarding. Everything here is a demonstration: no payment provider is called, no card
 * is charged, no domain is bought, no DNS record is changed and nothing is deployed. Orders are stored with
 * mode "demo" and a simulated payment; the real flags (entitlement, domainVerified, certificateReady, published)
 * stay false and only real publishing (src/publish.ts, Studio) can ever set them.
 */
export interface DemoOrder {
  id: string;
  reference: string;
  draftId: string;
  idempotencyKey: string;
  mode: 'demo';
  payment: { status: 'simulated'; method: 'demo-card'; label: 'Demo payment'; last4: '4242'; charged: false };
  package: { name: string; amount: number; currency: string; cadence: string; label: string; demoPrice: true };
  owner: { name: string; email: string; phone?: string };
  business: { name: string; category: string };
  /** the saved design the order bought, frozen: later edits don't change it */
  snapshot: { revision: number; plan: ReturnType<typeof summarisePlan>; planId: string; appearance: unknown; offerings: unknown; siteUrl: string; savedAt: string; files: string };
  /** real entitlement and publication: never set by a demo order */
  real: { entitlement: false; published: false };
  onboarding: Onboarding;
  createdAt: string;
  updatedAt: string;
}

export interface Onboarding {
  status: 'not-started' | 'in-progress' | 'later' | 'demo-complete';
  choice?: 'connect' | 'need' | 'later';
  domain?: { input: string; apex: string; host: string; subdomain: boolean };
  provider?: { id: string; label: string; registrar?: string };
  /** steps the owner ticked off (0..4: sign in, find DNS, add records, verification, check) */
  done: number[];
  demo: { verified: boolean; verifiedAt?: string; launched: boolean; launchedAt?: string };
  /** what real publishing reports (Vercel); a demo never sets these */
  real: { domainVerified: false; certificateReady: false; published: false };
  updatedAt: string;
}

const newOnboarding = (): Onboarding => ({ status: 'not-started', done: [], demo: { verified: false, launched: false }, real: { domainVerified: false, certificateReady: false, published: false }, updatedAt: new Date().toISOString() });

// ── checkout ──
const ownerSchema = z.object({
  name: z.string().transform((s) => s.replace(/[\u0000-\u001f<>]/g, '').trim()).pipe(z.string().min(2, 'Enter your name').max(80)),
  email: z.string().trim().toLowerCase().pipe(z.string().email('Enter a valid email').max(120)),
  phone: z.string().trim().max(30).regex(/^[+\d][\d\s().-]{6,}$/, 'Enter a valid phone number').optional().or(z.literal('').transform(() => undefined)),
}).strict();
const checkoutSchema = z.object({
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'missing idempotency key'),
  revision: z.number().int().min(1),
  owner: ownerSchema,
  /** the owner confirmed they understand nothing is charged */
  demoAcknowledged: z.literal(true),
}).strict();

const reference = () => `RGR-${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
export const packageLabel = (p = config.demoPackage) => `${formatMoney(p.amount, p.currency)}${p.cadence === 'one-time' ? ' one-time' : ` / ${p.cadence}`}`;

export async function listOrders(draftId: string): Promise<DemoOrder[]> {
  return (await draftDocs.list<DemoOrder>('orders')).filter((o) => o.draftId === draftId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export const getOrder = (id: string) => draftDocs.get<DemoOrder>('orders', id);
export const allOrders = async () => (await draftDocs.list<DemoOrder>('orders')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/**
 * "Complete demo purchase": the saved revision must be current (the editor saves first), the same idempotency key
 * returns the same order, and the purchased page is copied so it stays as bought.
 */
export async function createDemoOrder(d: DraftRecord, body: unknown): Promise<{ order: DemoOrder; replay: boolean }> {
  if (!config.demoCheckout) throw new DraftError(404, 'Demo checkout is turned off');
  const r = checkoutSchema.safeParse(body);
  if (!r.success) throw new DraftError(400, r.error.issues[0]?.message || 'Invalid checkout', { errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  const existing = (await listOrders(d.id)).find((o) => o.idempotencyKey === r.data.idempotencyKey);
  if (existing) return { order: existing, replay: true };
  if (r.data.revision !== d.revision) throw new DraftError(409, 'Your latest changes aren\'t saved yet. Save your design, then complete the purchase.', { revision: d.revision });
  const id = `ord_${randomBytes(6).toString('hex')}`;
  const now = new Date().toISOString();
  // freeze the purchased page (html + thumbnail); assets stay with the site, the plan snapshot can rebuild it
  await ensureLocalSite(d.slug);
  const siteDir = path.join(config.dirs.sites, d.slug);
  const dir = path.join(config.dirs.orders, id);
  fs.mkdirSync(dir, { recursive: true });
  const html = fs.existsSync(path.join(siteDir, 'index.html')) ? fs.readFileSync(path.join(siteDir, 'index.html')) : await readOut(`sites/${d.slug}/index.html`);
  if (html) fs.writeFileSync(path.join(dir, 'index.html'), html);
  const shot = await screenshot(path.join(siteDir, 'index.html'), path.join(dir, 'thumb.jpg'), { width: 1200, height: 750 }).catch(() => false);
  if (!shot && fs.existsSync(path.join(siteDir, 'preview.jpg'))) fs.copyFileSync(path.join(siteDir, 'preview.jpg'), path.join(dir, 'thumb.jpg'));
  await persistDir(dir);
  const p = config.demoPackage;
  const order: DemoOrder = {
    id, reference: reference(), draftId: d.id, idempotencyKey: r.data.idempotencyKey, mode: 'demo',
    payment: { status: 'simulated', method: 'demo-card', label: 'Demo payment', last4: '4242', charged: false },
    package: { name: p.name, amount: p.amount, currency: p.currency, cadence: p.cadence, label: packageLabel(p), demoPrice: true },
    owner: r.data.owner, business: { name: d.businessName, category: d.category },
    snapshot: { revision: d.revision, plan: summarisePlan(d.plan), planId: d.plan.id, appearance: d.appearance, offerings: d.offerings, siteUrl: `${config.publicBaseUrl}/sites/${d.slug}/`, savedAt: d.savedAt, files: `orders/${id}` },
    real: { entitlement: false, published: false },
    onboarding: newOnboarding(),
    createdAt: now, updatedAt: now,
  };
  await draftDocs.put('orders', id, order);
  return { order, replay: false };
}

/** What the editor shows of an order (the frozen thumbnail inline: the editor's requests carry the owner key). */
export async function orderView(o: DemoOrder) {
  const thumb = await readOut(`orders/${o.id}/thumb.jpg`);
  const { idempotencyKey: _k, ...rest } = o;
  return { ...rest, thumbnail: thumb ? `data:image/jpeg;base64,${thumb.toString('base64')}` : null, guide: o.onboarding.domain ? dnsGuide(o.onboarding) : null };
}

// ── domain onboarding ──
/** DNS hosts the guide knows. Where the records live can differ from where the domain was bought (the registrar). */
export const DNS_PROVIDERS: { id: string; label: string; where: string; note?: string }[] = [
  { id: 'godaddy', label: 'GoDaddy', where: 'Sign in, open My Products → your domain → DNS (Manage DNS).' },
  { id: 'namecheap', label: 'Namecheap', where: 'Sign in, open Domain List → Manage next to the domain → Advanced DNS.' },
  { id: 'cloudflare', label: 'Cloudflare', where: 'Sign in, choose the domain, then DNS → Records.', note: 'Set these records to "DNS only" (grey cloud), not proxied, unless your host tells you otherwise.' },
  { id: 'squarespace', label: 'Squarespace Domains (formerly Google Domains)', where: 'Sign in to Squarespace Domains, open the domain → DNS → DNS Settings → Custom records.' },
  { id: 'wix', label: 'Wix', where: 'Sign in, open Domains → the domain\'s menu → Manage DNS records.' },
  { id: 'ionos', label: 'IONOS', where: 'Sign in, open Domains & SSL → the domain → DNS.' },
  { id: 'hostinger', label: 'Hostinger', where: 'Sign in, open Domains → the domain → DNS / Nameservers → DNS records.' },
  { id: 'bluehost', label: 'Bluehost', where: 'Sign in, open Domains → the domain → DNS.' },
  { id: 'porkbun', label: 'Porkbun', where: 'Sign in, open Domain Management → the domain → DNS.' },
  { id: 'route53', label: 'Amazon Route 53', where: 'In the AWS console, open Route 53 → Hosted zones → the domain → Create record.' },
  { id: 'other', label: 'Other / not sure', where: 'Sign in where your domain\'s DNS is managed (often where you bought it) and look for "DNS", "DNS records" or "Zone editor".' },
];

const MULTI_TLD = /\.(co|com|org|net|gov|ac|edu)\.(uk|au|nz|za|pk|in|sg|ae)$/;
/** Normalise what the owner typed: "https://www.Example.com/" → apex example.com, host www.example.com. */
export function parseDomain(input: string): NonNullable<Onboarding['domain']> | { error: string } {
  const raw = String(input || '').trim().toLowerCase();
  const host = raw.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '').replace(/:\d+$/, '');
  if (!host) return { error: 'Enter your domain, like yourbusiness.com' };
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return { error: 'That doesn\'t look like a domain. Enter it like yourbusiness.com' };
  const bare = host.replace(/^www\./, '');
  const labels = bare.split('.');
  const apexLen = MULTI_TLD.test(bare) ? 3 : 2;
  const subdomain = labels.length > apexLen;
  const apex = labels.slice(-apexLen).join('.');
  return { input: raw.slice(0, 260), apex, host: subdomain ? bare : `www.${apex}`, subdomain };
}

/**
 * The records to add, following Vercel's custom-domain setup (vercel.com/docs/domains/set-up-custom-domain): an A
 * record for the apex and a CNAME for www (or the subdomain), plus a TXT record only if Vercel asks to verify
 * ownership. The exact values come from the Vercel project once the domain is added there, so in this demo they
 * are placeholders, clearly marked and not copyable.
 */
export function dnsGuide(o: Onboarding) {
  const dm = o.domain!;
  const provider = DNS_PROVIDERS.find((p) => p.id === o.provider?.id) || DNS_PROVIDERS[DNS_PROVIDERS.length - 1];
  const ph = (what: string) => ({ placeholder: true as const, text: `Shown here once your domain is added to your Roger project (${what})` });
  const records = dm.subdomain
    ? [{ type: 'CNAME', name: dm.host.slice(0, -(dm.apex.length + 1)), value: ph('a project-specific vercel-dns.com address'), purpose: `Points ${dm.host} to your website` }]
    : [
        { type: 'A', name: '@', value: ph('Vercel\'s IP address for your project'), purpose: `Points ${dm.apex} to your website` },
        { type: 'CNAME', name: 'www', value: ph('a project-specific vercel-dns.com address'), purpose: `Points ${dm.host} to your website` },
      ];
  return {
    provider,
    records,
    verification: { type: 'TXT', name: '_vercel', value: ph('only if Vercel asks you to verify ownership'), purpose: 'Proves you own the domain, if it is already used by another Vercel account' },
    keep: 'Leave your existing MX (email) and TXT records as they are. Only add or change the records listed here.',
    nameservers: 'You don\'t need to change your nameservers.',
    steps: [
      { title: `Sign in to ${provider.label === 'Other / not sure' ? 'your DNS provider' : provider.label}`, text: provider.where },
      { title: 'Open the DNS records', text: 'Find the list of DNS records for the domain. Don\'t delete anything there.' },
      { title: dm.subdomain ? `Add the ${dm.host} record` : 'Add the two records', text: dm.subdomain ? 'Add the CNAME record below exactly as shown.' : 'Add the A record for the bare domain and the CNAME record for www, exactly as shown. If an A record for @ or a www record already exists, edit it instead of adding a second one.' },
      { title: 'Ownership check', text: 'Only if asked: add the TXT verification record. Most domains don\'t need it.' },
      { title: 'Check DNS and HTTPS', text: 'DNS changes can take from a few minutes to a few hours. Once they show up, the secure (HTTPS) certificate is issued automatically.' },
    ],
    note: provider.note,
  };
}

/** "I need a domain": examples from the business name. Availability is not checked; nothing is reserved or bought. */
export function domainIdeas(name: string, city?: string): string[] {
  const words = name.toLowerCase().replace(/&/g, ' and ').replace(/['’.]/g, '').replace(/\b(llc|inc|ltd|co|company|the)\b/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
  const join = words.join('');
  const dash = words.join('-');
  const c = (city || '').toLowerCase().replace(/[^a-z]/g, '');
  const out = [`${join}.com`, words.length > 1 ? `${dash}.com` : '', c ? `${join}${c}.com` : '', `${join}.co`, c && words.length ? `${words[0]}${c}.com` : ''];
  return [...new Set(out.filter((d) => d && d.length <= 40 && d.length > 4))].slice(0, 4);
}

const onboardingSchema = z.object({
  choice: z.enum(['connect', 'need', 'later']).optional(),
  domain: z.string().max(260).optional(),
  provider: z.string().max(40).optional(),
  registrar: z.string().max(60).optional(),
  done: z.array(z.number().int().min(0).max(4)).max(5).optional(),
}).strict();

export async function updateOnboarding(order: DemoOrder, body: unknown): Promise<DemoOrder> {
  const r = onboardingSchema.safeParse(body);
  if (!r.success) throw new DraftError(400, r.error.issues[0]?.message || 'Invalid onboarding update');
  const o = { ...order.onboarding };
  const v = r.data;
  if (v.choice) o.choice = v.choice;
  if (v.domain !== undefined) {
    const d = parseDomain(v.domain);
    if (!d || 'error' in d) throw new DraftError(400, d?.error || 'Enter your domain');
    o.domain = d;
  }
  if (v.provider) {
    const p = DNS_PROVIDERS.find((x) => x.id === v.provider);
    if (!p) throw new DraftError(400, 'Unknown DNS provider');
    o.provider = { id: p.id, label: p.label, registrar: v.registrar ? v.registrar.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 60) || undefined : undefined };
  }
  if (v.done) o.done = [...new Set(v.done)].sort();
  o.status = o.demo.verified ? 'demo-complete' : o.choice === 'later' ? 'later' : 'in-progress';
  o.updatedAt = new Date().toISOString();
  o.real = { domainVerified: false, certificateReady: false, published: false };
  const next = { ...order, onboarding: o, updatedAt: o.updatedAt };
  await draftDocs.put('orders', order.id, next);
  return next;
}

/** "Simulate DNS verification": marks the demo complete. No lookup, no record change, no deployment. */
export async function simulateVerification(order: DemoOrder): Promise<DemoOrder> {
  const o = order.onboarding;
  if (o.choice !== 'connect' || !o.domain) throw new DraftError(400, 'Choose "Connect a domain" and enter your domain first.');
  const now = new Date().toISOString();
  const next: DemoOrder = {
    ...order, updatedAt: now,
    onboarding: { ...o, status: 'demo-complete', done: [0, 1, 2, 3, 4], demo: { verified: true, verifiedAt: now, launched: true, launchedAt: now }, real: { domainVerified: false, certificateReady: false, published: false }, updatedAt: now },
  };
  await draftDocs.put('orders', order.id, next);
  return next;
}
