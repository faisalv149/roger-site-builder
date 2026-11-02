// Ten fictional local businesses across categories, for category-adapted content and design QA: trades, salons, a
// café, a restaurant, a gym, a consultant, a shop and a sparse unknown business. Names, 555 / 0117 496 phone
// numbers, reviews and prices are made up. Prices are clearly labelled sample data (source "sample"), never real.
// Covers: known prices, unknown prices, no phone, weak photos and no photos, a non-USD currency.
// Photos are illustrations; each carries `analysis.kind`, the stand-in for the vision step.
// Run: npx tsx scripts/make-category-fixtures.ts
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from '../src/config.js';
import type { Business, OpeningPeriod, PhotoKind } from '../src/types.js';
import { categorySceneSvg, type CategoryScene } from './art.js';

const fxDir = path.join(ROOT, 'fixtures', 'places');
const photoDir = path.join(fxDir, 'photos');
fs.mkdirSync(photoDir, { recursive: true });

const fmt = (h: number, m = 0) => `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** open → close on the given weekdays (0 = Sunday) */
function hours(open: number, close: number, days: number[]): Business['hours'] {
  const periods: OpeningPeriod[] = days.map((d) => ({ open: { day: d, hour: open, minute: 0 }, close: { day: d, hour: close, minute: 0 } }));
  const weekdayText = [1, 2, 3, 4, 5, 6, 0].map((d) => `${DAYS[d]}: ${days.includes(d) ? `${fmt(open)} – ${fmt(close)}` : 'Closed'}`);
  return { periods, weekdayText };
}

type Shot = { scene: CategoryScene; label: PhotoKind; w?: number; h?: number };
async function photos(id: string, owner: string, shots: Shot[]): Promise<Business['photos']> {
  const out: Business['photos'] = [];
  for (const [i, s] of shots.entries()) {
    const w = s.w ?? 1800, h = s.h ?? 1200;
    const file = path.join(photoDir, `${id}-${i}.jpg`);
    await sharp(Buffer.from(categorySceneSvg(s.scene, i, w, h))).jpeg({ quality: 82 }).toFile(file);
    out.push({ ref: `file:fixtures/places/photos/${id}-${i}.jpg`, width: w, height: h, authors: [{ name: owner }], isOwner: true, analysis: { kind: s.label } });
  }
  return out;
}

type Offer = NonNullable<Business['offerings']>[number];
const sample = (name: string, price: Offer['price'] | undefined, extra: Partial<Offer> = {}): Offer => ({ name, price, source: 'sample', ...extra });
const listed = (name: string, description?: string): Offer => ({ name, description, source: 'business' }); // the business lists it, no price

interface Spec {
  id: string; name: string; type: string; typeLabel: string; types: string[]; city: string; state: string; zip: string; country?: string; street: string;
  phone?: string; e164?: string; rating?: number; reviewCount?: number; reviews: [string, number, string][]; towns?: string[];
  hours?: Business['hours']; shots: Shot[]; offerings?: Offer[]; currency?: string; summary?: string; note: string; utc?: number;
}

const SPECS: Spec[] = [
  { id: 'cat-velvet', name: 'Velvet & Vine Hair Studio', type: 'hair_salon', typeLabel: 'Hair salon', types: ['hair_salon', 'beauty_salon'], city: 'Austin', state: 'TX', zip: '78704', street: '1508 S Congress Ave',
    phone: '(512) 555-0187', rating: 4.8, reviewCount: 212, hours: hours(9, 19, [2, 3, 4, 5, 6]),
    reviews: [['Maya Torres', 5, 'Best balayage I have had. They took time to understand what I wanted and the colour lasted for months.'], ['Jordan Lee', 5, 'Calm studio, great music, and a precise cut. Booking a visit was easy.'], ['Ana Pierce', 4, 'Lovely blow-dry before a wedding. Ran ten minutes late but worth the wait.']],
    shots: [{ scene: 'salon', label: 'storefront', w: 2400, h: 1600 }, { scene: 'team', label: 'team', w: 2000, h: 1333 }, { scene: 'salon', label: 'work', w: 2000, h: 1333 }, { scene: 'shop', label: 'work' }, { scene: 'salon', label: 'work' }],
    offerings: [sample('Women\'s cut & style', { kind: 'from', amount: 65 }, { duration: '60 min', description: 'Consultation, wash, cut and finish.' }), sample('Men\'s cut', { kind: 'fixed', amount: 38 }, { duration: '30 min' }),
      sample('Colour', { kind: 'from', amount: 95 }, { duration: '2 h' }), sample('Balayage', { kind: 'range', amount: 180, max: 260 }, { duration: '3 h', description: 'Hand-painted highlights, toner included.' }),
      sample('Blow-dry', { kind: 'fixed', amount: 45 }, { duration: '45 min' }), sample('Bridal styling', undefined, { description: 'Priced after a trial.' })],
    note: 'salon, sample prices (fixed / from / range / on request), strong photos and a team photo' },
  { id: 'cat-lumen', name: 'Lumen Nail & Brow Bar', type: 'nail_salon', typeLabel: 'Nail salon', types: ['nail_salon', 'beauty_salon'], city: 'Phoenix', state: 'AZ', zip: '85004', street: '22 E Roosevelt St',
    phone: '(602) 555-0144', rating: 4.5, reviewCount: 37, hours: hours(10, 19, [1, 2, 3, 4, 5, 6]),
    reviews: [['Keisha Brown', 5, 'My gel manicure lasted three weeks. Friendly team.'], ['Lena Park', 4, 'Brow tint and shape done well, small but clean space.']],
    shots: [{ scene: 'salon', label: 'work', w: 1400, h: 933 }, { scene: 'shop', label: 'work', w: 1400, h: 933 }],
    offerings: [listed('Gel manicure'), listed('Pedicure'), listed('Brow shape & tint'), listed('Lash lift')],
    note: 'salon, services listed without prices → "Price on request", modest photos' },
  { id: 'cat-juniper', name: 'Juniper Street Café', type: 'cafe', typeLabel: 'Café', types: ['cafe', 'coffee_shop', 'food'], city: 'Burlington', state: 'VT', zip: '05401', street: '88 Church St',
    phone: '(802) 555-0171', rating: 4.7, reviewCount: 389, hours: hours(7, 15, [0, 1, 2, 3, 4, 5, 6]),
    reviews: [['Sam Doyle', 5, 'Great flat white and the cinnamon buns sell out early for a reason.'], ['Priya Nair', 5, 'Cosy spot for breakfast. The avocado toast is generous.'], ['Will Chen', 4, 'Busy at weekends but the line moves.']],
    shots: [{ scene: 'cafe', label: 'storefront', w: 2400, h: 1600 }, { scene: 'plate', label: 'work', w: 2000, h: 1333 }, { scene: 'cafe', label: 'work', w: 2000, h: 1333 }, { scene: 'plate', label: 'work' }, { scene: 'storefront', label: 'storefront' }],
    offerings: [sample('Flat white', { kind: 'fixed', amount: 4.5 }), sample('Oat latte', { kind: 'fixed', amount: 5.25 }), sample('Breakfast sandwich', { kind: 'fixed', amount: 9 }, { description: 'Egg, cheddar and greens on a toasted bun.' }),
      sample('Avocado toast', { kind: 'fixed', amount: 11 }), sample('Cinnamon bun', { kind: 'fixed', amount: 4 }), sample('Soup of the day', undefined)],
    note: 'café: menu with sample prices, hours first, strong photos' },
  { id: 'cat-bellacasa', name: 'Osteria Bellacasa', type: 'italian_restaurant', typeLabel: 'Italian restaurant', types: ['italian_restaurant', 'restaurant', 'food'], city: 'Providence', state: 'RI', zip: '02903', street: '310 Atwells Ave',
    phone: '(401) 555-0129', rating: 4.6, reviewCount: 158, hours: hours(17, 22, [2, 3, 4, 5, 6, 0]),
    reviews: [['Gina Russo', 5, 'Handmade pasta, attentive service. The cacio e pepe is a must.'], ['Mark Ellis', 4, 'Lovely evening, a little loud on Saturday.']],
    shots: [{ scene: 'plate', label: 'work', w: 2000, h: 1333 }, { scene: 'plate', label: 'work', w: 1800, h: 1200 }, { scene: 'storefront', label: 'storefront', w: 1800, h: 1200 }, { scene: 'cafe', label: 'work' }],
    offerings: [sample('Cacio e pepe', { kind: 'fixed', amount: 19 }), sample('Tagliatelle al ragù', { kind: 'fixed', amount: 24 }), sample('Margherita', { kind: 'fixed', amount: 16 }),
      sample('Tasting menu', { kind: 'unit', amount: 65, unit: 'person' }, { description: 'Five courses, the kitchen\'s choice.' }), sample('Tiramisu', { kind: 'fixed', amount: 9 })],
    note: 'restaurant: menu with a per-person tasting price, evening hours' },
  { id: 'cat-forge', name: 'Forge Strength Club', type: 'gym', typeLabel: 'Gym', types: ['gym', 'fitness_center'], city: 'Denver', state: 'CO', zip: '80205', street: '2901 Larimer St',
    phone: '(720) 555-0163', rating: 4.9, reviewCount: 96, hours: hours(5, 21, [0, 1, 2, 3, 4, 5, 6]),
    reviews: [['Chris Vega', 5, 'Coaches actually watch your form. Strongest I have been.'], ['Dana Wu', 5, 'Classes are tough but welcoming for beginners.'], ['Eli Ford', 5, 'Clean, well-equipped, never too crowded at 6am.']],
    shots: [{ scene: 'gym', label: 'work', w: 2400, h: 1600 }, { scene: 'gym', label: 'work', w: 2000, h: 1333 }, { scene: 'team', label: 'team' }, { scene: 'gym', label: 'work' }, { scene: 'storefront', label: 'storefront' }],
    offerings: [sample('Monthly membership', { kind: 'unit', amount: 59, unit: 'month' }, { description: 'Open gym, all equipment, 5am to 9pm.' }), sample('Class pack', { kind: 'fixed', amount: 150 }, { description: 'Ten coached classes, use within three months.' }),
      sample('Drop-in', { kind: 'unit', amount: 20, unit: 'session' }), sample('Personal training', { kind: 'from', amount: 65 }, { description: 'One-to-one coaching sessions.' })],
    note: 'gym: memberships and classes with billing cadence (no trial offered, so none shown)' },
  { id: 'cat-northpoint', name: 'Northpoint Advisory', type: 'consultant', typeLabel: 'Business consultant', types: ['consultant', 'business_consultant'], city: 'Columbus', state: 'OH', zip: '43215', street: '41 S High St, Suite 900',
    phone: '(614) 555-0108', rating: 5, reviewCount: 14, hours: hours(9, 17, [1, 2, 3, 4, 5]),
    reviews: [['Harriet Cole', 5, 'Clear, practical advice that helped us plan our first hire.'], ['Omar Said', 5, 'Structured process and honest about what we did not need.']],
    shots: [{ scene: 'office', label: 'work', w: 1300, h: 866 }, { scene: 'team', label: 'team', w: 1300, h: 866 }],
    offerings: [sample('Strategy session', { kind: 'fixed', amount: 250 }, { duration: '90 min', description: 'A focused session on one business question, with written notes.' }),
      sample('Monthly advisory', { kind: 'unit', amount: 1200, unit: 'month' }, { description: 'Ongoing support, a monthly review and email access.' }), sample('Growth project', undefined, { description: 'Scoped and quoted after an initial conversation.' })],
    note: 'consultant: packages, a process, weak photos (small)' },
  { id: 'cat-thimble', name: 'Thimble & Thread', type: 'fabric_store', typeLabel: 'Fabric store', types: ['fabric_store', 'store'], city: 'Asheville', state: 'NC', zip: '28801', street: '17 Lexington Ave',
    phone: '(828) 555-0152', rating: 4.8, reviewCount: 64, hours: hours(10, 18, [1, 2, 3, 4, 5, 6]),
    reviews: [['Ruth Allen', 5, 'Beautiful quilting cottons and patient staff who helped me pick a palette.'], ['Nina Ortiz', 5, 'Took the beginner sewing class and loved it.']],
    shots: [{ scene: 'shop', label: 'work', w: 2200, h: 1466 }, { scene: 'shop', label: 'work', w: 1800, h: 1200 }, { scene: 'storefront', label: 'storefront', w: 1800, h: 1200 }, { scene: 'shop', label: 'work' }],
    offerings: [sample('Fat quarter bundles', { kind: 'from', amount: 28 }), sample('Beginner sewing class', { kind: 'unit', amount: 45, unit: 'class' }, { duration: '2 h' }), sample('Quilting cottons', undefined, { description: 'Ask about current colours in store.' }), sample('Notions & thread', undefined)],
    note: 'shop: catalogue with enquiry, only supported claims' },
  { id: 'cat-brightline', name: 'Brightline Electric', type: 'electrician', typeLabel: 'Electrician', types: ['electrician'], city: 'Tampa', state: 'FL', zip: '33602', street: '501 E Kennedy Blvd',
    phone: '(813) 555-0136', rating: 4.7, reviewCount: 58, towns: ['Tampa', 'Brandon', 'Clearwater', 'St. Petersburg'], hours: hours(7, 17, [1, 2, 3, 4, 5]),
    reviews: [['Rob Klein', 5, 'Upgraded our panel cleanly and explained the permit process.'], ['Lia Gomez', 4, 'EV charger installed in a day. Good communication.']],
    shots: [{ scene: 'electric', label: 'work', w: 2000, h: 1333 }, { scene: 'team', label: 'team' }, { scene: 'electric', label: 'work' }, { scene: 'storefront', label: 'vehicle' }],
    offerings: [sample('Service call', { kind: 'fixed', amount: 89 }), sample('Panel upgrades', { kind: 'range', amount: 1800, max: 3200 }), sample('EV charger installation', { kind: 'from', amount: 650 }), sample('Lighting and fixtures', undefined)],
    note: 'trades: sample prices, team photo, service area' },
  { id: 'cat-riverside', name: 'Riverside Heating, Cooling & Indoor Air Quality Specialists', type: 'hvac_contractor', typeLabel: 'HVAC contractor', types: ['hvac_contractor'], city: 'Sacramento', state: 'CA', zip: '95814', street: '1415 L St',
    phone: '(916) 555-0174', rating: 4.4, reviewCount: 23, towns: ['Sacramento', 'West Sacramento', 'Elk Grove', 'Roseville', 'Folsom', 'Davis'], hours: hours(7, 18, [1, 2, 3, 4, 5, 6]),
    reviews: [['Gabe Ortiz', 5, 'Replaced our furnace quickly and walked us through the thermostat.'], ['Mina Shah', 4, 'Good AC tune-up, arrived in the window they gave.']],
    shots: [{ scene: 'storefront', label: 'vehicle', w: 1600, h: 1066 }, { scene: 'electric', label: 'work', w: 1400, h: 933 }],
    offerings: [listed('Furnace repair and replacement', 'Gas and electric furnaces, same-day diagnosis where possible.'), listed('Air conditioning service'), listed('Heat pumps'), listed('Indoor air quality testing'), listed('Duct cleaning and sealing'), listed('Thermostats and zoning'), listed('Maintenance plans'), listed('Commercial HVAC')],
    note: 'long business name, many offerings without prices, modest photos, wide service area' },
  { id: 'cat-marlow', name: 'Marlow & Finch Studio', type: 'establishment', typeLabel: '', types: ['point_of_interest', 'establishment'], city: 'Savannah', state: 'GA', zip: '31401', street: '12 W Jones St',
    reviews: [], shots: [],
    note: 'unknown category, sparse: no phone, no photos, no reviews, no hours → clean general page' },
  { id: 'cat-lantern', name: 'The Lantern Barber', type: 'barber_shop', typeLabel: 'Barber shop', types: ['barber_shop'], city: 'Bristol', state: '', zip: 'BS1 5DS', country: 'GB', street: '9 Park Row',
    phone: '0117 496 0123', e164: '+441174960123', rating: 4.6, reviewCount: 41, hours: hours(9, 18, [2, 3, 4, 5, 6]), currency: 'GBP', utc: 0,
    reviews: [['Tom Hughes', 5, 'Sharp skin fade and a proper hot towel shave.'], ['Ade Okon', 4, 'Good cut, worth the short wait.']],
    shots: [{ scene: 'salon', label: 'work', w: 900, h: 600 }, { scene: 'storefront', label: 'storefront', w: 900, h: 600 }],
    offerings: [sample('Skin fade', { kind: 'fixed', amount: 22 }, { duration: '40 min' }), sample('Beard trim', { kind: 'fixed', amount: 12 }, { duration: '20 min' }), sample('Hot towel shave', { kind: 'fixed', amount: 28 }, { duration: '45 min' }), sample('Kids\' cut', { kind: 'fixed', amount: 15 })],
    note: 'UK barber: GBP prices, weak photos (900px)' },
];

for (const s of SPECS) {
  const b: Business & { qaNote: string } = {
    placeId: `mock-${s.id}`, name: s.name, primaryType: s.type, primaryTypeLabel: s.typeLabel || undefined, types: [...s.types, 'point_of_interest', 'establishment'].filter((v, i, a) => a.indexOf(v) === i),
    formattedAddress: `${s.street}, ${s.city}${s.state ? `, ${s.state}` : ''} ${s.zip}, ${s.country === 'GB' ? 'UK' : 'USA'}`, shortAddress: `${s.street}, ${s.city}`, street: s.street, city: s.city, state: s.state || undefined, zip: s.zip, country: s.country || 'US',
    phone: s.phone, phoneE164: s.e164 ?? (s.phone ? `+1${s.phone.replace(/\D/g, '')}` : undefined),
    mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(s.name)}`, rating: s.rating, reviewCount: s.reviewCount,
    reviews: s.reviews.map(([author, rating, text], i) => ({ author, rating, text, relativeTime: `${i + 1} month${i ? 's' : ''} ago` })),
    photos: await photos(s.id, s.name, s.shots), hours: s.hours, utcOffsetMinutes: s.utc ?? -300, businessStatus: 'OPERATIONAL', nearbyTowns: s.towns || [], source: 'mock',
    offerings: s.offerings?.map((o) => (o.price ? { ...o, price: { ...o.price, currency: s.currency || 'USD' } } : o)), currency: s.currency,
    editorialSummary: s.summary, qaNote: s.note,
  };
  fs.writeFileSync(path.join(fxDir, `mock-${s.id}.json`), JSON.stringify(b, null, 2));
}
console.log(`category fixtures: ${SPECS.length} businesses`);
