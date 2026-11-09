/**
 * Time-limited calls to action ("Thanksgiving Pie Preorders!", "Pre-order for 11/24"). A seasonal action is never a
 * page's main action (a site outlives the season); one whose season or date has passed is not shown at all.
 * Business-agnostic: holiday windows and explicit dates, judged against today's date.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** each holiday's selling window: [start month, start day, end month, end day] (months 0-based) */
const HOLIDAYS: [RegExp, [number, number, number, number]][] = [
  [/\bthanksgiving\b/i, [9, 1, 10, 30]],
  [/\b(?:black friday|cyber monday|small business saturday)\b/i, [10, 1, 11, 2]],
  [/\b(?:christmas|xmas|holiday (?:pies?|cookies?|orders?|gift|menu|special))\b/i, [10, 1, 11, 26]],
  [/\bhanukkah\b/i, [10, 15, 11, 31]],
  [/\bnew year'?s?\b/i, [11, 1, 0, 2]],
  [/\bvalentine'?s?\b/i, [0, 10, 1, 15]],
  [/\bsuper ?bowl\b/i, [0, 10, 1, 15]],
  [/\bst\.? patrick'?s?\b/i, [1, 20, 2, 18]],
  [/\beaster\b/i, [2, 1, 3, 30]],
  [/\bmother'?s day\b/i, [3, 10, 4, 15]],
  [/\bfather'?s day\b/i, [4, 20, 5, 25]],
  [/\b(?:4th of july|fourth of july|independence day)\b/i, [5, 1, 6, 5]],
  [/\bhalloween\b/i, [8, 15, 10, 1]],
  [/\bback[- ]to[- ]school\b/i, [6, 15, 8, 30]],
];
const LIMITED = /\b(?:pre-?orders?|pre-?order now|limited[- ]time|this (?:weekend|week|month)|while supplies last|seasonal)\b/i;

const inWindow = (now: Date, [sm, sd, em, ed]: [number, number, number, number]) => {
  const t = now.getMonth() * 100 + now.getDate(), s = sm * 100 + sd, e = em * 100 + ed;
  return s <= e ? t >= s && t <= e : t >= s || t <= e; // a window across the new year
};
/** explicit dates in a label ("11/24", "Nov 24"), as dates in the current year */
function datesIn(label: string, now: Date): Date[] {
  const out: Date[] = [];
  for (const m of label.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
    out.push(new Date(y, Number(m[1]) - 1, Number(m[2]), 23, 59));
  }
  for (const m of label.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/gi)) out.push(new Date(m[3] ? Number(m[3]) : now.getFullYear(), MONTHS.indexOf(m[1].toLowerCase()), Number(m[2]), 23, 59));
  return out.filter((d) => !Number.isNaN(d.getTime()));
}

export interface Season { seasonal: boolean; expired: boolean; why?: string }
/** Is this action time-limited, and has its time passed? */
export function seasonOf(label: string, now = new Date()): Season {
  const dates = datesIn(label, now);
  if (dates.length) {
    // a date without a year that is well behind today (more than ~10 months) is next year's; otherwise past means expired
    const live = dates.some((d) => d.getTime() >= now.getTime() || now.getTime() - d.getTime() > 300 * 864e5);
    return { seasonal: true, expired: !live, why: live ? `dated ${dates.map((d) => `${d.getMonth() + 1}/${d.getDate()}`).join(', ')}` : `its date (${dates.map((d) => `${d.getMonth() + 1}/${d.getDate()}`).join(', ')}) has passed` };
  }
  for (const [re, w] of HOLIDAYS) if (re.test(label)) {
    const live = inWindow(now, w);
    return { seasonal: true, expired: !live, why: live ? `a ${label.match(re)![0]} offer, in season until ${MONTHS[w[2]]} ${w[3]}` : `a ${label.match(re)![0]} offer out of season` };
  }
  if (LIMITED.test(label)) return { seasonal: true, expired: false, why: 'a limited-time offer' };
  return { seasonal: false, expired: false };
}
