import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { persistDir } from '../files.js';
import type { BusinessCandidate } from '../types.js';
import type { AuditResult } from '../audit/audit.js';
import { downloadPhoto } from '../sources/places.js';
import { createHash } from 'node:crypto';
import { esc, slugify, truncateWords } from '../util/text.js';

/**
 * What Roger sends in iMessage. iMessage builds the rich "card" itself from the
 * link's Open Graph tags (og:title / og:image), so every card here = text + a URL
 * whose page carries a purpose-made 1200×630 og:image.
 */
export interface IMessageCard {
  kind: 'confirm-business' | 'audit' | 'site-preview' | 'no-website';
  text: string; // message body, plain text (send the url as its own message for the best rich preview)
  url?: string;
  image?: string;
  /** og:title of the linked page (what iMessage shows under the image) */
  title?: string;
  quickReplies?: string[];
}

const FONT = "'Inter', 'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif";

/** Step 1: "Is this you?" — a share page per Google place with a photo/name/address card. */
export async function confirmBusinessCard(c: BusinessCandidate): Promise<IMessageCard> {
  const id = `${slugify(c.name)}-${createHash('sha1').update(c.placeId).digest('hex').slice(0, 6)}`;
  const dir = path.join(config.dirs.cards, id);
  fs.mkdirSync(dir, { recursive: true });
  const url = `${config.publicBaseUrl}/cards/${id}/`;
  const image = `${url}card.jpg`;
  let photo: Buffer | undefined;
  // a Google photo may not be stored, so it isn't composited into the card image (Maps Platform terms)
  void downloadPhoto;
  const base = photo
    ? await sharp(photo).resize(1200, 630, { fit: 'cover' }).toBuffer()
    : await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#1E293B' } }).png().toBuffer();
  const rating = c.rating ? `★ ${c.rating.toFixed(1)}${c.reviewCount ? `  ·  ${c.reviewCount} Google reviews` : ''}` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset=".2" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".82"/></linearGradient></defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <text x="60" y="440" font-family="${FONT}" font-weight="800" font-size="60" fill="#fff">${esc(truncateWords(c.name, 34))}</text>
    <text x="60" y="500" font-family="${FONT}" font-size="32" fill="#fff" fill-opacity=".9">${esc(truncateWords((c.address || '').replace(/, USA$/, ''), 60))}</text>
    <text x="60" y="560" font-family="${FONT}" font-weight="600" font-size="30" fill="#FFD166">${esc(rating)}</text>
  </svg>`;
  await sharp(base).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 82 }).toFile(path.join(dir, 'card.jpg'));
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.name)}</title><meta name="robots" content="noindex">
<meta property="og:title" content="${esc(c.name)}"><meta property="og:description" content="${esc([c.address, rating].filter(Boolean).join(' · '))}">
<meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
${c.mapsUrl ? `<meta http-equiv="refresh" content="0;url=${esc(c.mapsUrl)}">` : ''}</head>
<body style="font-family:system-ui;padding:24px"><img src="card.jpg" alt="" style="max-width:100%;border-radius:12px"><h1>${esc(c.name)}</h1><p>${esc(c.address || '')}</p>${c.mapsUrl ? `<p><a href="${esc(c.mapsUrl)}">Open in Google Maps</a></p>` : ''}</body></html>`);
  await persistDir(dir); // on Vercel: so any server instance can serve the card
  return {
    kind: 'confirm-business',
    text: `Is this you?\n${c.name}\n${(c.address || '').replace(/, USA$/, '')}${rating ? `\n${rating}` : ''}${c.fromWebsite ? "\n(These details are from your website. I couldn't find a matching Google listing.)" : ''}`,
    url,
    image,
    title: c.name,
    quickReplies: ['Yes, that\'s me', 'No, not us'],
  };
}

/** Step 2a (has a website): the audit result. */
export function auditCard(a: AuditResult, reportUrl: string, image: string): IMessageCard {
  const bullets = a.summary.bullets.map((b) => `• ${b}`).join('\n');
  return {
    kind: 'audit',
    text: `${a.summary.headline}\n\n${bullets}\n\n${a.summary.pitch}`.trim(),
    url: reportUrl,
    image,
    title: `${(() => { try { return new URL(a.finalUrl).host.replace(/^www\./, ''); } catch { return 'Your website'; } })()} scored ${a.score}/100`,
    quickReplies: ['Show me the new site', 'Call me'],
  };
}

/** Step 2b (no website): offer to build one. No time is promised: the preview is sent when it is ready. */
export function noWebsiteCard(name: string): IMessageCard {
  return {
    kind: 'no-website',
    text: `I couldn't find a website for ${name}. Most customers look at a website before they call.\n\nWant me to build you a free website preview from your Google profile? There's no cost and nothing to sign up for.`,
    quickReplies: ['Yes, build it', 'Not now'],
  };
}

/** Step 3: the generated site. */
export function siteCard(opts: { name: string; url: string; image: string; minutes?: string; hadWebsite: boolean; personalisable?: boolean; /** the message, written from what the build actually obtained (src/content/summary.ts) */ text?: string; /** the build found things that need a person's check before it goes live */ needsReview?: boolean }): IMessageCard {
  return {
    kind: 'site-preview',
    text: opts.text ?? (opts.hadWebsite
      ? `Here's a preview of a new site for ${opts.name}. It fixes the issues above and uses your Google photos, reviews and hours.`
      : `Your free website preview for ${opts.name} is ready. It uses your Google photos, reviews and hours.`),
    url: opts.url,
    image: opts.image,
    title: opts.name,
    // the owner can answer three optional questions to shape the site; a preview with open checks isn't offered for publishing yet
    quickReplies: [...(opts.needsReview ? [] : ['Looks great, publish it']), opts.needsReview ? 'Check the details' : opts.personalisable ? 'Personalize it' : 'Change something'],
  };
}
