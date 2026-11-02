import type { Lead } from './store.js';

/** What a lead is for. Appointment requests are requests: the business confirms the time (no booking provider yet). */
export const LEAD_KINDS = ['quote-request', 'appointment-request', 'message', 'order-enquiry', 'enquiry'] as const;
const TIMES = ['Morning', 'Afternoon', 'Evening'];

const str = (v: unknown, max: number) => (v == null || v === '' ? undefined : String(v).slice(0, max));

/** Validate and trim a lead posted by a generated site (quote form, appointment request, Roger widget). */
export function normalizeLead(slug: string, b: Record<string, unknown>): { ok: true; lead: Lead } | { ok: false; error: string } {
  if (!b.name || !b.phone) return { ok: false, error: 'name and phone are required' };
  const kind = LEAD_KINDS.find((k) => k === b.kind);
  const date = typeof b.preferredDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.preferredDate) ? b.preferredDate : undefined;
  const time = TIMES.find((t) => t === b.preferredTime);
  return {
    ok: true,
    lead: {
      slug,
      at: new Date().toISOString(),
      name: String(b.name).slice(0, 120),
      phone: String(b.phone).slice(0, 40),
      email: str(b.email, 160),
      zip: str(b.zip, 10),
      service: str(b.service, 120),
      message: str(b.message, 2000),
      ...(kind ? { kind } : {}),
      ...(kind === 'appointment-request' ? { preferredDate: date, preferredTime: time, status: 'requested' as const } : {}),
      page: b.page,
    },
  };
}
