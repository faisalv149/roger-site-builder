import { cleanText, preferencesSchema, type Direction, type Goal } from './schema.js';

/**
 * Turning an owner's text reply into a preference (the iMessage questions). The Studio sends the same values
 * directly; both are validated by preferencesSchema (src/design/schema.ts).
 */
export type Step = 'service' | 'goal' | 'style' | 'emergency';
export type Answer<T> = { keep: true } | { value: T } | { error: string };

const KEEP = /^(keep( it)?( recommended)?|recommended|skip|no preference|you (pick|choose|decide)|whatever|default|any|not sure|dunno)\.?$/i;
export const isKeep = (text: string) => KEEP.test(text.trim());

export function parseService(text: string, suggestions: string[]): Answer<string> {
  const t = cleanText(text);
  if (isKeep(t)) return { keep: true };
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= suggestions.length) return { value: suggestions[n - 1] };
  const hit = suggestions.find((s) => s.toLowerCase() === t.toLowerCase());
  const v = preferencesSchema.shape.service.safeParse(hit ?? t);
  return v.success && v.data ? { value: v.data } : { error: 'Send the service as a few words, like "water heater repair".' };
}

export function parseGoal(text: string, phoneOk: boolean): Answer<Goal> {
  const t = text.trim().toLowerCase();
  if (isKeep(t)) return { keep: true };
  if (/appoint|book|visit|schedul|consult|class/.test(t)) return { value: 'appointment' };
  if (/quote|estimate|price/.test(t)) return { value: 'quote' };
  if (/order|takeaway|pick ?up|collect/.test(t)) return { value: 'order' };
  if (/enquir|inquir|message|question|ask|membership|contact/.test(t)) return { value: 'enquiry' };
  if (/call|phone|ring/.test(t)) return phoneOk ? { value: 'call' } : { error: 'Your Google profile has no phone number, so visitors can\'t call from the site. Pick another action, or add a number on Google first.' };
  return { error: 'Reply Call, Request a quote, Request an appointment, Order enquiry or Send an enquiry (or keep).' };
}

export function parseStyle(text: string): Answer<Direction> {
  const t = text.trim().toLowerCase();
  if (isKeep(t)) return { keep: true };
  if (/clean|professional|simple|minimal|corporate/.test(t)) return { value: 'clean-professional' };
  if (/local|trust|warm|friendly|neighbo/.test(t)) return { value: 'local-trusted' };
  if (/bold|direct|strong|straight|practical/.test(t)) return { value: 'bold-direct' };
  if (/modern|premium|elegant|sleek|high[- ]end|upscale|editorial|showcase/.test(t)) return { value: 'modern-premium' };
  return { error: 'Reply Clean professional, Warm local, Bold practical or Editorial showcase (or keep).' };
}

export function parseYesNo(text: string): Answer<boolean> {
  const t = text.trim().toLowerCase();
  if (isKeep(t)) return { keep: true };
  if (/^(y|yes|yeah|yep|yup|sure|we do|of course|correct)\b/.test(t)) return { value: true };
  if (/^(n|no|nope|we don'?t|not really)\b/.test(t)) return { value: false };
  return { error: 'Reply yes or no.' };
}
