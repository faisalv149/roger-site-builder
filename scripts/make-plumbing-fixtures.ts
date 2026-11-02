// Ten fictional plumbing businesses for the personalisation pilot (src/design): the three directions, different
// service priorities and sparse-data cases. Names, phone numbers (555), websites (.example) and reviews are made up.
// Photos are illustrations; each carries `analysis.kind`, the stand-in for the vision step that labels live photos.
// Run: npx tsx scripts/make-plumbing-fixtures.ts
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from '../src/config.js';
import type { Business, OpeningPeriod, PhotoKind } from '../src/types.js';
import { plumbingSceneSvg } from './art.js';

const fxDir = path.join(ROOT, 'fixtures', 'places');
const photoDir = path.join(fxDir, 'photos');
const sitesDir = path.join(ROOT, 'fixtures', 'sites');
for (const d of [fxDir, photoDir, sitesDir]) fs.mkdirSync(d, { recursive: true });

const fmt = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;
function hours(open: number, close: number, sat?: number): Business['hours'] {
  const periods: OpeningPeriod[] = [1, 2, 3, 4, 5].map((d) => ({ open: { day: d, hour: open, minute: 0 }, close: { day: d, hour: close, minute: 0 } }));
  if (sat) periods.push({ open: { day: 6, hour: 8, minute: 0 }, close: { day: 6, hour: sat, minute: 0 } });
  return { periods, weekdayText: [...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => `${d}: ${fmt(open)} – ${fmt(close)}`), `Saturday: ${sat ? `${fmt(8)} – ${fmt(sat)}` : 'Closed'}`, 'Sunday: Closed'] };
}
const open24 = (): Business['hours'] => ({ periods: [{ open: { day: 0, hour: 0, minute: 0 } }], weekdayText: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => `${d}: Open 24 hours`) });

type Shot = { kind: 'team' | 'heater' | 'bath' | 'van' | 'pipes'; label: PhotoKind; w?: number; h?: number; owner?: boolean; author?: string };
async function photos(id: string, owner: string, shots: Shot[]): Promise<Business['photos']> {
  const out: Business['photos'] = [];
  for (const [i, s] of shots.entries()) {
    const w = s.w ?? 1600, h = s.h ?? 1066;
    const file = path.join(photoDir, `${id}-${i}.jpg`);
    await sharp(Buffer.from(plumbingSceneSvg(s.kind, i, w, h))).jpeg({ quality: 82 }).toFile(file);
    const isOwner = s.owner !== false;
    out.push({ ref: `file:fixtures/places/photos/${id}-${i}.jpg`, width: w, height: h, authors: [{ name: isOwner ? owner : s.author || 'A Google user' }], isOwner, analysis: { kind: s.label } });
  }
  return out;
}

interface Spec {
  id: string; name: string; city: string; state: string; zip: string; street: string; lat: number; lng: number;
  phone?: string; rating?: number; reviewCount?: number; reviews: [string, number, string][]; towns: string[];
  hours: Business['hours']; website?: string; shots: Shot[]; note: string;
}

const SPECS: Spec[] = [
  { id: 'demo-copperleaf', name: 'Copperleaf Plumbing Co.', city: 'Portland', state: 'OR', zip: '97214', street: '2200 SE Hawthorne Blvd', lat: 45.512, lng: -122.643,
    phone: '(503) 555-0142', rating: 4.9, reviewCount: 134, website: '{{BASE}}/demo-sites/copperleaf-plumbing/',
    towns: ['Portland', 'Beaverton', 'Gresham', 'Lake Oswego', 'Milwaukie', 'Tigard'], hours: hours(7, 17, 13),
    reviews: [['Dana Whitfield', 5, 'They replaced our old tank with a tankless water heater. Clean install, explained every step, and the crew left the basement spotless.'],
      ['Marcus Bell', 5, 'Full repipe of a 1920s house. Careful with the plaster, finished on schedule and the water pressure is finally great.'],
      ['Priya Raman', 5, 'Fixed a hidden leak behind our shower and showed us photos of the problem before doing anything. Honest people.'],
      ['Tom Okafor', 4, 'Drain cleaning on a stubborn kitchen line. Took longer than expected but they stayed until it was clear.']],
    shots: [{ kind: 'bath', label: 'work', w: 2400, h: 1600 }, { kind: 'team', label: 'team', w: 2000, h: 1333 }, { kind: 'heater', label: 'work', w: 2000, h: 1333 }, { kind: 'pipes', label: 'work', w: 2000, h: 1333 }, { kind: 'bath', label: 'work', w: 1800, h: 1200 }, { kind: 'van', label: 'vehicle' }, { kind: 'heater', label: 'work' }],
    note: 'rich data: team photo, large project photos, 4.9★, website with licence/years → modern & premium' },
  { id: 'demo-hearthstone', name: 'Hearthstone Plumbing', city: 'Boise', state: 'ID', zip: '83702', street: '410 W Idaho St', lat: 43.617, lng: -116.204,
    phone: '(208) 555-0119', rating: 4.7, reviewCount: 41, towns: ['Boise', 'Meridian', 'Eagle', 'Garden City', 'Nampa'], hours: hours(8, 17),
    reviews: [['Elena Ruiz', 5, 'Our neighbors recommended them and now we do too. Fixed the running toilet and a dripping faucet in one visit.'],
      ['Grant Holloway', 5, 'Friendly, on time, and they cleaned the drain without upselling anything. Real local plumbers.'],
      ['Sue Kimura', 4, 'Water heater repair was quick. They called ahead and wore shoe covers.']],
    shots: [{ kind: 'team', label: 'team' }, { kind: 'pipes', label: 'work', w: 1500, h: 1000 }, { kind: 'heater', label: 'work', w: 1500, h: 1000 }],
    note: 'team photo, modest photos and reviews, clear towns → local & trusted' },
  { id: 'demo-rapidrooter', name: 'RapidRooter Drain & Sewer', city: 'Tulsa', state: 'OK', zip: '74103', street: '15 E 5th St', lat: 36.153, lng: -95.99,
    phone: '(918) 555-0177', rating: 4.5, reviewCount: 88, towns: ['Tulsa', 'Broken Arrow', 'Jenks', 'Bixby', 'Sand Springs'], hours: open24(),
    reviews: [['Ray Dunn', 5, 'Main sewer line backed up at midnight. They answered right away and had a camera down the line within the hour.'],
      ['Kim Alvarez', 5, 'Emergency drain call on a Sunday. Fast, fair, and they explained what caused the clog.'],
      ['Jordan Pike', 4, 'Hydro jetting cleared roots out of our sewer line. Loud but effective.'],
      ['Mia Chen', 4, 'Burst pipe in the garage; they shut it off and repaired it the same visit.']],
    shots: [{ kind: 'van', label: 'vehicle', w: 1800, h: 1200 }, { kind: 'pipes', label: 'work', w: 1800, h: 1200 }, { kind: 'pipes', label: 'work' }, { kind: 'heater', label: 'work' }],
    note: 'open 24 hours, drain/sewer focus → bold & direct with verified emergency band' },
  { id: 'demo-bluebird', name: 'Bluebird Bath & Plumbing', city: 'Sacramento', state: 'CA', zip: '95816', street: '1900 J St', lat: 38.576, lng: -121.481,
    phone: '(916) 555-0131', rating: 4.8, reviewCount: 52, website: '{{BASE}}/demo-sites/bluebird-bath/',
    towns: ['Sacramento', 'Elk Grove', 'Folsom', 'Davis', 'Roseville'], hours: hours(8, 17),
    reviews: [['Natalie Brooks', 5, 'They redid our primary bathroom plumbing for the remodel: new shower valve, freestanding tub filler, everything level and tidy.'],
      ['Owen Fischer', 5, 'Beautiful fixture installation. The consultation up front made the whole project easy to plan.'],
      ['Leah Simmons', 5, 'Kitchen sink and disposal replaced, plus a new shutoff valve. Meticulous work.']],
    shots: [{ kind: 'bath', label: 'work', w: 2400, h: 1600 }, { kind: 'bath', label: 'work', w: 2000, h: 1333 }, { kind: 'pipes', label: 'work', w: 2000, h: 1333 }, { kind: 'bath', label: 'work', w: 1800, h: 1200 }, { kind: 'heater', label: 'work', w: 1800, h: 1200 }],
    note: 'fixtures/remodel focus, large project photos, 22 years → modern & premium' },
  { id: 'demo-nightjar', name: 'Nightjar Water Heater Pros', city: 'Albuquerque', state: 'NM', zip: '87102', street: '320 Gold Ave SW', lat: 35.083, lng: -106.651,
    phone: '(505) 555-0158', rating: 4.6, reviewCount: 23, towns: ['Albuquerque', 'Rio Rancho', 'Corrales', 'Los Lunas'], hours: hours(7, 18, 12),
    reviews: [['Ben Archuleta', 5, 'Water heater died on Friday and they installed a new one Monday morning. Hauled the old tank away too.'],
      ['Cora Tafoya', 4, 'Tankless water heater flush and descaling. Hot water is back to normal.'],
      ['Ivan Petrov', 5, 'Replaced the anode rod and thermostat instead of selling us a new heater. Appreciated that.']],
    shots: [{ kind: 'heater', label: 'work', w: 1300, h: 866 }, { kind: 'heater', label: 'work', w: 1200, h: 800 }],
    note: 'water heater priority, two smaller photos (no photo-led hero), appointment goal in QA' },
  { id: 'demo-juniperflats', name: 'Juniper Flats Plumbing', city: 'Flagstaff', state: 'AZ', zip: '86001', street: '2 N Leroux St', lat: 35.198, lng: -111.651,
    phone: '(928) 555-0104', rating: 4.8, reviewCount: 15, towns: ['Flagstaff', 'Sedona', 'Williams'], hours: hours(8, 16),
    reviews: [['Hannah Yazzie', 5, 'Frozen pipe repair in January. They thawed and replaced the cracked section and insulated the rest.'],
      ['Liam O\'Rourke', 5, 'Leak under the kitchen sink fixed quickly. Fair price and a friendly tech.']],
    shots: [], note: 'no photos at all → typography-led hero, no projects/team sections' },
  { id: 'demo-quietcreek', name: 'Quiet Creek Plumbing', city: 'Asheville', state: 'NC', zip: '28801', street: '55 Broadway St', lat: 35.597, lng: -82.553,
    rating: 4.7, reviewCount: 19, towns: ['Asheville', 'Weaverville', 'Black Mountain', 'Fletcher'], hours: hours(8, 17),
    reviews: [['Maya Holt', 5, 'Booked online and they came out the next day for our leaking water line. Tidy and respectful.'],
      ['Sam Greer', 4, 'Good work on a toilet replacement. Communication was all by text, which suited me.']],
    shots: [{ kind: 'pipes', label: 'work' }, { kind: 'bath', label: 'work' }, { kind: 'van', label: 'vehicle' }],
    note: 'no phone number on Google → Call is unavailable; Request a quote leads' },
  { id: 'demo-pebblepipe', name: 'Pebble & Pipe Plumbing', city: 'Duluth', state: 'MN', zip: '55802', street: '18 E Superior St', lat: 46.787, lng: -92.1,
    phone: '(218) 555-0166', rating: 4.0, reviewCount: 3, towns: ['Duluth'], hours: hours(9, 17),
    reviews: [['Erin Lund', 4, 'They fixed our sump pump before the spring melt. Showed up when they said they would.'],
      ['Paul Strand', 4, 'Replaced a corroded shutoff valve. Quick job.']],
    shots: [{ kind: 'pipes', label: 'work', w: 1100, h: 733 }, { kind: 'pipes', label: 'work', w: 640, h: 427 }],
    note: 'few reviews (3) → no rating claims; one photo too small; sparse page' },
  { id: 'demo-ironwood', name: 'Ironwood Plumbing & Heating', city: 'Spokane', state: 'WA', zip: '99201', street: '601 W 1st Ave', lat: 47.656, lng: -117.42,
    phone: '(509) 555-0122', rating: 4.8, reviewCount: 64, website: '{{BASE}}/demo-sites/ironwood-plumbing/',
    towns: ['Spokane', 'Spokane Valley', 'Liberty Lake', 'Cheney'], hours: hours(7, 17),
    reviews: [['Grace Moreno', 5, 'Gas line for our new range, permit and inspection handled. Very professional.'],
      ['Dylan Ward', 5, 'Sewer camera inspection before we bought the house saved us a fortune. Clear report.'],
      ['Ruth Becker', 5, 'Drain cleaning and a new garbage disposal. On time and polite.']],
    shots: [{ kind: 'pipes', label: 'work', w: 1800, h: 1200 }, { kind: 'team', label: 'team' }, { kind: 'heater', label: 'work' }, { kind: 'van', label: 'vehicle' }],
    note: 'QA builds it with an explicitly chosen theme (plumbing-trust): the theme stays authoritative' },
  { id: 'demo-larkspur', name: 'Larkspur Plumbing', city: 'Madison', state: 'WI', zip: '53703', street: '25 W Main St', lat: 43.074, lng: -89.384,
    phone: '(608) 555-0185', rating: 4.4, reviewCount: 31, towns: ['Madison', 'Middleton', 'Fitchburg', 'Sun Prairie'], hours: hours(8, 17),
    reviews: [['Alex Novak', 5, 'Replaced our outdoor spigot and fixed a slow bathroom drain. Straightforward and friendly.'],
      ['Jenna Price', 4, 'Toilet repair done right. Would call again.'],
      ['Chris Lowe', 4, 'Good communication on a faucet install.']],
    shots: [{ kind: 'pipes', label: 'work', owner: false, author: 'Jenna Price' }, { kind: 'bath', label: 'work', owner: false, author: 'Alex Novak' }, { kind: 'pipes', label: 'work', owner: false, author: 'Chris Lowe' }],
    note: 'customer photos only (credited); QA asks for Bold & direct without emergency facts → no emergency messaging' },
];

const DEMO_SITES: Record<string, string> = {
  'copperleaf-plumbing': `<h1>Copperleaf Plumbing Co.</h1><p>Serving Portland since 2008. Licensed and insured residential plumbers (CCB #204817). Every job is backed by our two-year workmanship guarantee.</p>
    <h2>Services</h2><ul><li>Tankless water heaters</li><li>Whole-house repiping</li><li>Leak detection and repair</li><li>Drain cleaning</li><li>Fixture installation</li><li>Gas lines</li></ul>
    <p>Proudly serving Portland, Beaverton, Gresham and Lake Oswego.</p>`,
  'bluebird-bath': `<h1>Bluebird Bath &amp; Plumbing</h1><p>Established 2004. Licensed and fully insured. Bathroom and kitchen plumbing for remodels: shower valves, tub fillers, sinks, faucets and fixture installation.</p>
    <p>We start every project with an in-home consultation.</p><p>Serving Sacramento, Elk Grove, Folsom and Davis.</p>`,
  'ironwood-plumbing': `<h1>Ironwood Plumbing &amp; Heating</h1><p>Licensed plumbing contractor, family run since 2001. Gas line installation, sewer camera inspection and repair, drain cleaning, water heaters.</p><p>Serving Spokane, Spokane Valley and Liberty Lake.</p>`,
};

for (const [slug, body] of Object.entries(DEMO_SITES)) {
  fs.mkdirSync(path.join(sitesDir, slug), { recursive: true });
  fs.writeFileSync(path.join(sitesDir, slug, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${slug}</title></head><body>${body}<p>Fictional demo business for Roger QA.</p></body></html>`);
}

for (const s of SPECS) {
  const b: Business & { qaNote: string } = {
    placeId: `mock-${s.id}`, name: s.name, primaryType: 'plumber', primaryTypeLabel: 'Plumber', types: ['plumber', 'point_of_interest', 'establishment'],
    formattedAddress: `${s.street}, ${s.city}, ${s.state} ${s.zip}, USA`, shortAddress: `${s.street}, ${s.city}`, street: s.street, city: s.city, state: s.state, zip: s.zip, country: 'US',
    lat: s.lat, lng: s.lng, phone: s.phone, phoneE164: s.phone ? `+1${s.phone.replace(/\D/g, '')}` : undefined, website: s.website,
    mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(s.name)}`, rating: s.rating, reviewCount: s.reviewCount,
    reviews: s.reviews.map(([author, rating, text], i) => ({ author, rating, text, relativeTime: `${i + 1} month${i ? 's' : ''} ago` })),
    photos: await photos(s.id, s.name, s.shots), hours: s.hours, utcOffsetMinutes: -360, businessStatus: 'OPERATIONAL', nearbyTowns: s.towns, source: 'mock',
    qaNote: s.note,
  };
  fs.writeFileSync(path.join(fxDir, `mock-${s.id}.json`), JSON.stringify(b, null, 2));
}
console.log(`plumbing fixtures: ${SPECS.length} businesses, ${Object.keys(DEMO_SITES).length} demo websites`);
