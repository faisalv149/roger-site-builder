import { config } from './config.js';
import type { Lead } from './store.js';

/**
 * Getting an enquiry to the business. Saving it is not delivering it: a lead that sits in Roger's own store and
 * reaches nobody is a lost customer. Delivery goes through the channels the operator has set up (a webhook, an
 * email), each attempt is recorded with its own result, and only an acknowledgement from a channel counts as delivery.
 *
 *  - webhook: LEAD_WEBHOOK_URL receives the lead as JSON; any 2xx answer is the receiver's acknowledgement ("delivered").
 *  - email: RESEND_API_KEY + LEAD_FROM_EMAIL, sent to the business's own email (or LEAD_NOTIFY_EMAIL); the provider
 *    accepting the message is "accepted": it has taken responsibility for sending, which is not the same as a person reading it.
 */
export type Channel = 'webhook' | 'email';
export interface DeliveryAttempt { channel: Channel; status: 'delivered' | 'accepted' | 'failed'; at: string; detail?: string }
export interface DeliveryResult { attempts: DeliveryAttempt[]; /** at least one channel acknowledged the enquiry */ confirmed: boolean; configured: Channel[] }

const emailConfig = () => ({ key: process.env.RESEND_API_KEY || '', from: process.env.LEAD_FROM_EMAIL || '', notify: process.env.LEAD_NOTIFY_EMAIL || '', api: (process.env.RESEND_API_URL || 'https://api.resend.com').replace(/\/$/, '') });
const validEmail = (e?: string) => !!e && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e);

/** the channels that would be used for a business whose own email is `ownerEmail` */
export function configuredChannels(ownerEmail?: string): Channel[] {
  const out: Channel[] = [];
  if (config.leadWebhook) out.push('webhook');
  const e = emailConfig();
  if (e.key && validEmail(e.from.match(/<([^>]+)>/)?.[1] ?? e.from) && validEmail(ownerEmail || e.notify)) out.push('email');
  return out;
}

const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);

export async function deliverLead(lead: Lead, opts: { business: string; ownerEmail?: string; test?: boolean }): Promise<DeliveryResult> {
  const attempts: DeliveryAttempt[] = [];
  const configured = configuredChannels(opts.ownerEmail);
  if (configured.includes('webhook')) {
    const at = new Date().toISOString();
    try {
      const r = await fetch(config.leadWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...lead, business: opts.business, test: !!opts.test }), signal: AbortSignal.timeout(8000) });
      attempts.push(r.ok ? { channel: 'webhook', status: 'delivered', at, detail: `HTTP ${r.status}` } : { channel: 'webhook', status: 'failed', at, detail: `the receiver answered HTTP ${r.status}` });
    } catch (e) { attempts.push({ channel: 'webhook', status: 'failed', at, detail: clean((e as Error).message, 120) }); }
  }
  if (configured.includes('email')) {
    const at = new Date().toISOString();
    const e = emailConfig();
    const to = opts.ownerEmail && validEmail(opts.ownerEmail) ? opts.ownerEmail : e.notify;
    const lines = [`New ${opts.test ? 'TEST ' : ''}enquiry for ${opts.business}`, '', `Name: ${clean(lead.name, 120)}`, `Phone: ${clean(lead.phone, 40)}`, lead.email ? `Email: ${clean(lead.email, 160)}` : '', lead.zip ? `ZIP: ${clean(lead.zip, 10)}` : '', lead.service ? `Service: ${clean(lead.service, 120)}` : '', lead.message ? `Message: ${clean(lead.message, 2000)}` : '', '', `Received ${lead.at}`].filter((x) => x !== '');
    try {
      const r = await fetch(`${e.api}/emails`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${e.key}` }, body: JSON.stringify({ from: e.from, to: [to], subject: `${opts.test ? '[Test] ' : ''}New enquiry from ${clean(lead.name, 60)}`, text: lines.join('\n'), ...(validEmail(lead.email) ? { reply_to: lead.email } : {}) }), signal: AbortSignal.timeout(10000) });
      const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
      attempts.push(r.ok && body.id ? { channel: 'email', status: 'accepted', at, detail: `accepted by the email provider (${body.id})` } : { channel: 'email', status: 'failed', at, detail: clean(body.message || `the email provider answered HTTP ${r.status}`, 160) });
    } catch (err) { attempts.push({ channel: 'email', status: 'failed', at, detail: clean((err as Error).message, 120) }); }
  }
  return { attempts, configured, confirmed: attempts.some((a) => a.status === 'delivered' || a.status === 'accepted') };
}

/** the business's own email from its reviewed facts, when it has not been left out */
export function ownerEmailOf(content: { facts: { email?: { value: unknown; review: { status: string } } } } | undefined): string | undefined {
  const f = content?.facts.email;
  return f && f.review.status !== 'omitted' && validEmail(String(f.value)) ? String(f.value) : undefined;
}
