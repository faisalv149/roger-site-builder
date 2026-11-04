import type { ParsedAddress } from '../sources/site-content.js';

/**
 * US street addresses in page text, as sites actually write them: "2401 Winsted Lane Austin, TX 78703",
 * "2711 La Frontera Blvd, Ste 320 Round Rock, TX 78681", "111 E Cesar Chavez Austin, TX 78701". A comma separates the
 * city when there is one; otherwise the street ends at its last street word (Lane, Rd, Blvd) or suite, and what
 * follows is the city; failing both, the last word is the city.
 */
const STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
const STATE_NAMES = 'Alabama Alaska Arizona Arkansas California Colorado Connecticut Delaware Florida Georgia Hawaii Idaho Illinois Indiana Iowa Kansas Kentucky Louisiana Maine Maryland Massachusetts Michigan Minnesota Mississippi Missouri Montana Nebraska Nevada New_Hampshire New_Jersey New_Mexico New_York North_Carolina North_Dakota Ohio Oklahoma Oregon Pennsylvania Rhode_Island South_Carolina South_Dakota Tennessee Texas Utah Vermont Virginia Washington West_Virginia Wisconsin Wyoming District_of_Columbia'.split(' ').map((n) => n.replace(/_/g, ' '));
/** a state's full name from its postal code ("TX" is Texas); anything else as given */
export const stateName = (code: string) => { const i = [...STATES].indexOf(code.toUpperCase()); return i >= 0 ? STATE_NAMES[i] : code; };
const STREET_WORD = /^(st|street|rd|road|blvd|boulevard|ave|avenue|dr|drive|ln|lane|way|pkwy|parkway|hwy|highway|ct|court|loop|trail|trl|pl|place|cir|circle|sq|square|ter|terrace|row|pike|expy|expressway|fwy|freeway|plz|plaza)\.?$/i;
const UNIT = /^(ste|suite|unit|apt|bldg|#)\.?$/i;
const NUMBERED_ROAD = /^(fm|rm|rr|cr|sh|us|hwy|highway|route|rte|i)$/i;

export function findAddresses(text: string): ParsedAddress[] {
  const out: ParsedAddress[] = [];
  const re = /\b(\d{1,6}[A-Za-z]?)\s+((?:[A-Za-z0-9.'’#&-]+[ ,.]+){1,10}?)([A-Z]{2})\.?\s+(\d{5})(?:-\d{4})?\b/g;
  for (const m0 of text.matchAll(re)) {
    if (!STATES.has(m0[3])) continue;
    // a number earlier in the run ("2 locations ... 2401 Winsted Lane"): the address starts at the last house number
    const words = `${m0[1]} ${m0[2]}`.split(/\s+/).filter(Boolean);
    let start = 0;
    for (let i = 1; i < words.length; i++) if (/^\d{1,6}[A-Za-z]?$/.test(words[i]) && !UNIT.test(words[i - 1].replace(/,$/, '')) && !NUMBERED_ROAD.test(words[i - 1]) && i < words.length - 1) start = i;
    const m = [m0[0], words[start], words.slice(start + 1).join(' '), m0[3], m0[4]];
    const middle = m[2].replace(/[\s,.]+$/, '');
    let streetPart: string, city: string;
    const parts = middle.split(/\s*,\s*/).filter(Boolean);
    if (parts.length >= 2) {
      city = parts.pop()!;
      streetPart = parts.join(', ');
      // "La Frontera Blvd, Ste 320 Round Rock": the unit and the city share the last part
      const tail = city.split(/\s+/);
      if (UNIT.test(tail[0]) && tail.length >= 3) { streetPart += `, ${tail.slice(0, 2).join(' ')}`; city = tail.slice(2).join(' '); }
    } else {
      const t = middle.split(/\s+/).map((x) => x.replace(/\.$/, ''));
      let cut = -1;
      for (let i = t.length - 2; i >= 0; i--) {
        if (STREET_WORD.test(t[i]) || (UNIT.test(t[i - 1] || '') && /^#?\w+$/.test(t[i]))) { cut = i; break; }
        if (/^\d+$/.test(t[i]) && NUMBERED_ROAD.test(t[i - 1] || '')) { cut = i; break; }
      }
      if (cut < 0) cut = t.length - 2;
      if (cut < 0) continue;
      streetPart = t.slice(0, cut + 1).join(' ');
      city = t.slice(cut + 1).join(' ');
    }
    if (!/^[A-Z][A-Za-z.'’ -]{1,30}$/.test(city) || city.split(/\s+/).length > 3) continue;
    const unitM = streetPart.match(/,?\s*((?:ste|suite|unit|apt|bldg)\.?\s*#?\s*[\w-]+|#\s*[\w-]+)$/i);
    const street = `${m[1]} ${(unitM ? streetPart.slice(0, unitM.index) : streetPart).replace(/[,\s]+$/, '')}`.trim();
    if (street.split(/\s+/).length < 2) continue;
    const unit = unitM ? unitM[1].replace(/^(ste|suite)\.?\s*#?\s*/i, 'Suite ').replace(/^unit\s*#?\s*/i, 'Unit ').replace(/^#\s*/, 'Unit ') : undefined;
    const a: ParsedAddress = { street, unit, city: city.trim(), state: m[3], zip: m[4], formatted: `${street}${unit ? `, ${unit}` : ''}, ${city.trim()}, ${m[3]} ${m[4]}` };
    if (!out.some((x) => x.zip === a.zip && x.street.toLowerCase() === a.street.toLowerCase())) out.push(a);
  }
  return out;
}

/** Page text with breaks between blocks, so "Lane<br>Austin" reads as two words. */
export const spacedHtml = (html: string) => html.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/td|\/th|\/tr|\/section|\/address|\/span|\/a|\/strong|\/b|\/em|\/header|\/footer|\/button)\b[^>]*>/gi, ' $&');
