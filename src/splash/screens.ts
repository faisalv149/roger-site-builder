/**
 * The screen plan, written before any HTML: start from the trade's scroll order, keep a screen only when the fact sheet
 * gives it real material, merge a thin screen into its neighbour instead of padding it. Hero, Where and when, and the
 * final call to action are always kept; What to expect always has material (the business's own process, or the
 * trade's plain standard flow), so a page has 4 to 9 screens.
 */
import { ACTION_LABELS, SCREEN_LABELS, screenOrder, type ScreenId, type TradeRow } from './playbook.js';

/** how much real material the fact sheet has for each screen */
export interface Material {
  /** reviews that passed selection (4+ stars, quotable) */
  reviews: number;
  /** stated licences, certifications, insurance, awards, years in business */
  credentials: number;
  /** services or menu items */
  offerings: number;
  /** real photos: owner, website, or Google with attribution */
  photos: number;
  /** the business states its own process */
  processStated: boolean;
  /** an owner or team name, and sentences of their own story */
  aboutName: boolean;
  aboutStory: boolean;
  /** questions the sources answer */
  faqs: number;
}
export interface PlannedScreen { screen: ScreenId; label: string; content: string }
export interface ScreenPlan { screens: PlannedScreen[]; merged: { screen: ScreenId; into: ScreenId; reason: string }[]; dropped: { screen: ScreenId; reason: string }[] }

type Verdict = { keep: true; content: string } | { keep: false; thin: boolean; reason: string };

function judge(screen: ScreenId, row: TradeRow, m: Material): Verdict {
  switch (screen) {
    case 'hero': return { keep: true, content: `What they do and where; ${row.firstScreen} Main action: ${ACTION_LABELS[row.mainAction]}.` };
    case 'where': return { keep: true, content: 'Address and Google map link, hours (today first, live from Google), phone, service area if stated.' };
    case 'cta': return { keep: true, content: `One clear closing ask: ${ACTION_LABELS[row.mainAction]}, with the phone number.` };
    case 'proof':
      if (m.reviews >= 3 || m.credentials >= 2) return { keep: true, content: [m.reviews >= 3 ? `${m.reviews} selected Google reviews beside the full rating and count, with how they were chosen` : '', m.credentials ? `${m.credentials} stated credential(s)` : ''].filter(Boolean).join('; ') + '.' };
      return m.reviews || m.credentials ? { keep: false, thin: true, reason: `only ${m.reviews} quotable review(s) and ${m.credentials} credential(s)` } : { keep: false, thin: false, reason: 'no quotable reviews or credentials' };
    case 'offer':
      if (m.offerings >= 3) return { keep: true, content: `${m.offerings} services or menu items, named and priced exactly as the business writes them, each linking to its page on their site.` };
      return m.offerings ? { keep: false, thin: true, reason: `only ${m.offerings} offering(s)` } : { keep: false, thin: false, reason: 'no services or menu items' };
    case 'work':
      if (m.photos >= 4) return { keep: true, content: `${m.photos} real photos (owner, website, or Google with attribution), each with a deliberate role.` };
      return m.photos ? { keep: false, thin: true, reason: `only ${m.photos} photo(s)` } : { keep: false, thin: false, reason: 'no real photos' };
    case 'expect':
      return { keep: true, content: m.processStated ? 'The process the business states, in its own steps.' : `The plain standard flow for the trade: ${row.standardFlow.join(' ')} No invented guarantees.` };
    case 'about':
      if (m.aboutName && m.aboutStory) return { keep: true, content: 'The owner or team by name, and their own story in their words.' };
      return m.aboutName || m.aboutStory ? { keep: false, thin: true, reason: m.aboutName ? 'a name but no story of their own' : 'a story but no owner or team name' } : { keep: false, thin: false, reason: 'no owner or team story' };
    case 'faq':
      if (m.faqs >= 3) return { keep: true, content: `${m.faqs} questions answered by the business's own sources.` };
      return m.faqs ? { keep: false, thin: true, reason: `only ${m.faqs} answered question(s)` } : { keep: false, thin: false, reason: 'no answered questions' };
  }
}

export function planScreens(row: TradeRow, m: Material): ScreenPlan {
  const plan: ScreenPlan = { screens: [], merged: [], dropped: [] };
  for (const screen of screenOrder(row)) {
    const v = judge(screen, row, m);
    if (v.keep) { plan.screens.push({ screen, label: SCREEN_LABELS[screen], content: v.content }); continue; }
    if (!v.thin) { plan.dropped.push({ screen, reason: v.reason }); continue; }
    // a thin screen joins the screen above it (the hero when it is the first after it)
    const into = plan.screens.at(-1)?.screen ?? 'hero';
    plan.merged.push({ screen, into, reason: v.reason });
    const host = plan.screens.find((s) => s.screen === into);
    if (host) host.content += ` Also: ${SCREEN_LABELS[screen].toLowerCase()} (${v.reason}).`;
  }
  return plan;
}
