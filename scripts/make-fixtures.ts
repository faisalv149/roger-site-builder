// Generates: public/stock/*.svg placeholders, mock Google Business fixtures (+photos),
// and a deliberately outdated demo website used to exercise the audit.
// Run: npx tsx scripts/make-fixtures.ts
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from '../src/config.js';
import type { Business, OpeningPeriod } from '../src/types.js';
import { flyerSvg, sceneSvg } from './art.js';

const stockDir = path.join(ROOT, 'public', 'stock');
const fxDir = path.join(ROOT, 'fixtures', 'places');
const photoDir = path.join(fxDir, 'photos');
const siteDir = path.join(ROOT, 'fixtures', 'sites', 'summit-peak-roofing');
for (const d of [stockDir, fxDir, photoDir, siteDir]) fs.mkdirSync(d, { recursive: true });

// 1) Stock placeholders referenced by every theme: /stock/<vertical>-hero.svg, -1..3.svg
for (const v of ['roofing', 'hvac', 'plumbing', 'electrical', 'landscaping']) {
  fs.writeFileSync(path.join(stockDir, `${v}-hero.svg`), sceneSvg(v, 0, 1920, 1080, 'Placeholder image'));
  for (let i = 1; i <= 3; i++) fs.writeFileSync(path.join(stockDir, `${v}-${i}.svg`), sceneSvg(v, i, 1200, 900, 'Placeholder image'));
}

const weekdays = (open: number, close: number, satClose?: number): OpeningPeriod[] => {
  const p: OpeningPeriod[] = [1, 2, 3, 4, 5].map((d) => ({ open: { day: d, hour: open, minute: 0 }, close: { day: d, hour: close, minute: 0 } }));
  if (satClose) p.push({ open: { day: 6, hour: 8, minute: 0 }, close: { day: 6, hour: satClose, minute: 0 } });
  return p;
};
const fmt = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;
const weekText = (open: number, close: number, satClose?: number) => [
  ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => `${d}: ${fmt(open)} – ${fmt(close)}`),
  `Saturday: ${satClose ? `${fmt(8)} – ${fmt(satClose)}` : 'Closed'}`,
  'Sunday: Closed',
];

async function photos(id: string, vertical: string, n: number, opts: { flyer?: boolean; small?: boolean; customer?: boolean } = {}) {
  const out: Business['photos'] = [];
  for (let i = 0; i < n; i++) {
    const file = path.join(photoDir, `${id}-${i}.jpg`);
    await sharp(Buffer.from(sceneSvg(vertical, i + 1, 1600, 1066))).jpeg({ quality: 80 }).toFile(file);
    out.push({ ref: `file:fixtures/places/photos/${id}-${i}.jpg`, width: 1600, height: 1066, authors: [{ name: '__OWNER__' }] });
  }
  if (opts.customer) {
    const file = path.join(photoDir, `${id}-cust.jpg`);
    await sharp(Buffer.from(sceneSvg(vertical, 7, 1400, 1050))).jpeg({ quality: 80 }).toFile(file);
    out.push({ ref: `file:fixtures/places/photos/${id}-cust.jpg`, width: 1400, height: 1050, authors: [{ name: 'Dana R.' }] });
  }
  if (opts.flyer) {
    const file = path.join(photoDir, `${id}-flyer.jpg`);
    await sharp(Buffer.from(flyerSvg())).jpeg({ quality: 85 }).toFile(file);
    out.push({ ref: `file:fixtures/places/photos/${id}-flyer.jpg`, width: 1200, height: 1200, authors: [{ name: '__OWNER__' }] });
  }
  if (opts.small) {
    const file = path.join(photoDir, `${id}-small.jpg`);
    await sharp(Buffer.from(sceneSvg(vertical, 2, 480, 320))).jpeg({ quality: 80 }).toFile(file);
    out.push({ ref: `file:fixtures/places/photos/${id}-small.jpg`, width: 480, height: 320, authors: [{ name: '__OWNER__' }] });
  }
  return out;
}

function finalize(b: Business): Business {
  b.photos = b.photos.map((p) => ({ ...p, authors: p.authors.map((a) => (a.name === '__OWNER__' ? { name: b.name } : a)), isOwner: p.authors[0]?.name === '__OWNER__' }));
  return b;
}

const businesses: Business[] = [
  finalize({
    placeId: 'mock-summit-peak-roofing',
    name: 'Summit Peak Roofing',
    primaryType: 'roofing_contractor',
    primaryTypeLabel: 'Roofing contractor',
    types: ['roofing_contractor', 'general_contractor', 'point_of_interest', 'establishment'],
    formattedAddress: '2417 S Lamar Blvd, Austin, TX 78704, USA',
    shortAddress: '2417 S Lamar Blvd, Austin',
    street: '2417 S Lamar Blvd', city: 'Austin', state: 'TX', zip: '78704', country: 'US',
    lat: 30.2457, lng: -97.7801,
    phone: '(512) 555-0142', phoneE164: '+15125550142',
    website: '{{BASE}}/demo-sites/summit-peak-roofing/',
    mapsUrl: 'https://maps.google.com/?cid=1234567890',
    rating: 4.8, reviewCount: 126,
    reviews: [
      { author: 'Maria Gonzalez', rating: 5, relativeTime: '2 weeks ago', text: 'After the hail storm in March we had three leaks. Summit Peak came out the next morning, tarped the roof and handled the whole insurance claim. The new roof looks fantastic and the crew cleaned up every nail.' },
      { author: 'James Whitfield', rating: 5, relativeTime: 'a month ago', text: 'Honest inspection, no upsell. They found a flashing problem around our chimney that two other companies missed and fixed it for a fair price.' },
      { author: 'Priya Natarajan', rating: 5, relativeTime: '2 months ago', text: 'Full roof replacement with architectural shingles. On time, on budget, and they explained the warranty clearly. Highly recommend for anyone in South Austin.' },
      { author: 'Tom Becker', rating: 4, relativeTime: '3 months ago', text: 'Good work replacing our gutters and repairing storm damage. Scheduling took a few days longer than hoped but the quality is great.' },
      { author: 'Leah Kim', rating: 5, relativeTime: '5 months ago', text: 'Quick leak repair before a big rain. Friendly, licensed and insured, and they sent photos of everything they fixed.' },
    ],
    photos: [],
    hours: { periods: weekdays(7, 18, 13), weekdayText: weekText(7, 18, 13) },
    utcOffsetMinutes: -300,
    businessStatus: 'OPERATIONAL',
    editorialSummary: 'Family-owned roofer offering repairs, replacements and storm damage restoration.',
    nearbyTowns: ['Austin', 'Sunset Valley', 'Rollingwood', 'West Lake Hills', 'Round Rock', 'Pflugerville', 'Buda', 'Kyle', 'Cedar Park', 'Lakeway'],
    source: 'mock',
  }),
  finalize({
    placeId: 'mock-blueline-plumbing',
    name: 'BlueLine Plumbing & Drain',
    primaryType: 'plumber',
    primaryTypeLabel: 'Plumber',
    types: ['plumber', 'point_of_interest', 'establishment'],
    formattedAddress: '880 Kalamath St, Denver, CO 80204, USA',
    shortAddress: '880 Kalamath St, Denver',
    street: '880 Kalamath St', city: 'Denver', state: 'CO', zip: '80204', country: 'US',
    lat: 39.7302, lng: -105.0001,
    phone: '(303) 555-0187', phoneE164: '+13035550187',
    mapsUrl: 'https://maps.google.com/?cid=2234567890',
    rating: 4.6, reviewCount: 58,
    reviews: [
      { author: 'Chris Allen', rating: 5, relativeTime: '1 week ago', text: 'Pipe burst at 2am and they picked up on the first ring. Emergency plumber was here in 40 minutes and stopped the leak. Lifesavers.' },
      { author: 'Hannah Lee', rating: 5, relativeTime: '3 weeks ago', text: 'Replaced our old water heater with a tankless unit the same day. Clean work and fair pricing.' },
      { author: 'Marcus Johnson', rating: 4, relativeTime: '2 months ago', text: 'Drain cleaning and a camera inspection of our sewer line. They showed me the video and explained everything.' },
      { author: 'Sofia Ramirez', rating: 5, relativeTime: '4 months ago', text: 'Fixed a leaking toilet and a dripping faucet. Friendly and quick.' },
      { author: 'Dev Patel', rating: 3, relativeTime: '6 months ago', text: 'Work was fine but the price was higher than I expected for a clogged drain.' },
    ],
    photos: [],
    hours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }], weekdayText: ['Monday: Open 24 hours', 'Tuesday: Open 24 hours', 'Wednesday: Open 24 hours', 'Thursday: Open 24 hours', 'Friday: Open 24 hours', 'Saturday: Open 24 hours', 'Sunday: Open 24 hours'] },
    utcOffsetMinutes: -360,
    businessStatus: 'OPERATIONAL',
    nearbyTowns: ['Denver', 'Lakewood', 'Englewood', 'Edgewater', 'Wheat Ridge', 'Arvada', 'Aurora', 'Littleton'],
    source: 'mock',
  }),
  finalize({
    placeId: 'mock-greenway-landscape',
    name: 'Greenway Lawn & Landscape',
    primaryType: 'landscaper',
    primaryTypeLabel: 'Landscaper',
    types: ['landscaper', 'lawn_care_service', 'point_of_interest', 'establishment'],
    formattedAddress: '4120 Monroe Rd, Charlotte, NC 28205, USA',
    shortAddress: '4120 Monroe Rd, Charlotte',
    street: '4120 Monroe Rd', city: 'Charlotte', state: 'NC', zip: '28205', country: 'US',
    lat: 35.1942, lng: -80.7889,
    phone: '(704) 555-0119', phoneE164: '+17045550119',
    mapsUrl: 'https://maps.google.com/?cid=3234567890',
    rating: 4.9, reviewCount: 212,
    reviews: [
      { author: 'Rachel Moore', rating: 5, relativeTime: '1 week ago', text: 'They redesigned our backyard with a paver patio, new planting beds and landscape lighting. Neighbors keep stopping to ask who did it.' },
      { author: 'Kevin Brooks', rating: 5, relativeTime: '2 weeks ago', text: 'Weekly lawn mowing has been perfect all season. Always on schedule and the edges are crisp.' },
      { author: 'Angela Torres', rating: 5, relativeTime: 'a month ago', text: 'Fall cleanup and mulch install done in one day. The seasonal care plan is a great value.' },
      { author: 'Ben Carter', rating: 5, relativeTime: '2 months ago', text: 'Fixed our irrigation system and re-sodded the front yard. Grass has never looked better.' },
      { author: 'Mei Chen', rating: 5, relativeTime: '3 months ago', text: 'Tree pruning and shrub care for our whole property, very careful crew and great communication.' },
    ],
    photos: [],
    hours: { periods: weekdays(7, 17, 12), weekdayText: weekText(7, 17, 12) },
    utcOffsetMinutes: -240,
    businessStatus: 'OPERATIONAL',
    nearbyTowns: ['Charlotte', 'Matthews', 'Mint Hill', 'Pineville', 'Huntersville', 'Concord', 'Cornelius', 'Indian Trail'],
    source: 'mock',
  }),
  finalize({
    placeId: 'mock-comfortpro-hvac',
    name: 'ComfortPro Heating & Air',
    primaryType: 'hvac_contractor',
    primaryTypeLabel: 'HVAC contractor',
    types: ['hvac_contractor', 'air_conditioning_contractor', 'point_of_interest', 'establishment'],
    formattedAddress: '1550 W University Dr, Tempe, AZ 85281, USA',
    shortAddress: '1550 W University Dr, Tempe',
    street: '1550 W University Dr', city: 'Tempe', state: 'AZ', zip: '85281', country: 'US',
    lat: 33.4218, lng: -111.9619,
    phone: '(480) 555-0163', phoneE164: '+14805550163',
    mapsUrl: 'https://maps.google.com/?cid=4234567890',
    rating: 4.4, reviewCount: 23,
    reviews: [
      { author: 'Luis Herrera', rating: 5, relativeTime: '3 weeks ago', text: 'AC died in July and they had a new heat pump installed in two days. Great financing options too.' },
      { author: 'Karen Wu', rating: 4, relativeTime: '2 months ago', text: 'Annual maintenance tune-up was thorough. They also cleaned our ducts.' },
      { author: 'Omar Haddad', rating: 5, relativeTime: '4 months ago', text: 'Furnace repair done right the first time. Fair and honest.' },
    ],
    photos: [],
    hours: { periods: weekdays(8, 17), weekdayText: weekText(8, 17) },
    utcOffsetMinutes: -420,
    businessStatus: 'OPERATIONAL',
    nearbyTowns: ['Tempe', 'Mesa', 'Chandler', 'Scottsdale', 'Phoenix', 'Gilbert', 'Guadalupe'],
    source: 'mock',
  }),
];

businesses[0].photos = await photos('summit', 'roofing', 7, { flyer: true, small: true, customer: true });
businesses[1].photos = await photos('blueline', 'plumbing', 3);
businesses[2].photos = await photos('greenway', 'landscaping', 9, { customer: true });
businesses[3].photos = await photos('comfortpro', 'hvac', 2);
for (const b of businesses) fs.writeFileSync(path.join(fxDir, `${b.placeId}.json`), JSON.stringify(finalize(b), null, 2));

// 2) A deliberately outdated website for Summit Peak Roofing (audit demo)
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="140" viewBox="0 0 520 140">
  <polygon points="10,110 70,30 130,110" fill="#1D3F6E"/><polygon points="60,110 100,58 140,110" fill="#E8742B"/>
  <text x="155" y="78" font-family="Arial Black, Arial" font-weight="900" font-size="46" fill="#1D3F6E">SUMMIT PEAK</text>
  <text x="158" y="116" font-family="Arial" font-weight="700" font-size="28" letter-spacing="9" fill="#E8742B">ROOFING</text></svg>`;
await sharp(Buffer.from(logoSvg)).png().toFile(path.join(siteDir, 'logo.png'));
// A huge, unoptimized hero image (~1.5MB+) to trip the page-weight check
await sharp(Buffer.from(sceneSvg('roofing', 2, 1500, 900))).png({ compressionLevel: 0 }).toFile(path.join(siteDir, 'header-photo.png'));
fs.writeFileSync(path.join(siteDir, 'style.css'), `
body { font-family: 'Open Sans', Arial; background: #f2f2f2; color: #333; margin: 0; }
h1, h2 { font-family: 'Oswald', sans-serif; color: #1D3F6E; }
#header { background: #fff; border-bottom: 4px solid #E8742B; }
#nav a { color: #1D3F6E; font-weight: bold; text-decoration: none; padding: 8px 14px; }
#nav a:hover { color: #E8742B; }
.box { background: #fff; border: 1px solid #ddd; padding: 12px; }
.btn { background: #1D3F6E; color: #fff; padding: 6px 10px; }
.footer { background: #1D3F6E; color: #ccc; font-size: 11px; }
.highlight { color: #E8742B; }
`);
fs.writeFileSync(path.join(siteDir, 'index.html'), `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>Home</title>
<link href="https://fonts.googleapis.com/css?family=Oswald:400,700|Open+Sans:400,700" rel="stylesheet" type="text/css">
<link rel="stylesheet" href="style.css">
<script src="https://code.jquery.com/jquery-1.8.3.min.js"></script>
</head>
<body>
<table width="960" align="center" cellpadding="0" cellspacing="0" id="header"><tr>
<td><img src="logo.png" class="logo" width="260"></td>
<td id="nav" align="right"><a href="index.html">HOME</a> <a href="services.html">SERVICES</a> <a href="#">GALLERY</a> <a href="#">CONTACT US</a></td>
</tr></table>
<table width="960" align="center"><tr><td><img src="header-photo.png" width="960"></td></tr></table>
<table width="960" align="center" class="box"><tr><td valign="top" width="640">
<h1>Welcome to Our Website!</h1>
<p>Summit Peak Roofing has been serving Austin since 2004. We are a family owned company and we do all kinds of roofing. We are licensed and insured and every job comes with our 10 year workmanship warranty.</p>
<p>We do roof repair, roof replacement, storm damage and hail repair, leak repair, gutters and metal roofing. We work with all insurance companies.</p>
<p>Serving Austin, Round Rock, Pflugerville, Cedar Park, Buda and Kyle.</p>
<img src="header-photo.png" width="300"> <img src="logo.png" width="120">
</td><td valign="top" class="box">
<h2>Contact Us</h2>
<p>Call: 512-555-0199<br>
Office: 1102 Barton Springs Rd<br>Austin TX 78704<br>
Email: summitpeakroofing@yahoo.com</p>
</td></tr></table>
<table width="960" align="center" class="footer"><tr><td>&copy; 2016 Summit Peak Roofing. All rights reserved. | <a href="https://www.facebook.com/summitpeakroofing">Facebook</a></td></tr></table>
</body>
</html>`);
fs.writeFileSync(path.join(siteDir, 'services.html'), `<!DOCTYPE html><html><head><title>Services</title><link rel="stylesheet" href="style.css"></head><body>
<h1>Our Services</h1><ul><li>Roof Repair</li><li>Roof Replacement</li><li>Storm &amp; Hail Damage</li><li>Leak Repair</li><li>Gutters</li><li>Metal Roofing</li><li>Free Inspections</li></ul></body></html>`);

console.log(`fixtures: ${businesses.length} businesses, stock placeholders for 5 verticals, demo site at fixtures/sites/summit-peak-roofing`);
