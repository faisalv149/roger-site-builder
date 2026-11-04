import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { esc, truncateWords } from '../util/text.js';

// libvips keeps recently read files open (process-wide). On Windows an open file blocks deleting
// the site folder, so every rebuild of an existing slug failed with EPERM. Don't hold files open.
sharp.cache({ files: 0 });

const FONT = "'Inter', 'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif";

export function monogramSvg(name: string, bg: string, fg: string): string {
  const letters = name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'R';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/><text x="32" y="42" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${letters.length > 1 ? 26 : 32}" fill="${fg}">${esc(letters)}</text></svg>`;
}

export async function writeIcons(dir: string, opts: { name: string; brand: string; ink: string; logoFile?: string }) {
  const mono = monogramSvg(opts.name, opts.brand, opts.ink);
  fs.writeFileSync(path.join(dir, 'favicon.svg'), mono);
  const touch = opts.logoFile
    ? await sharp({ create: { width: 180, height: 180, channels: 4, background: '#FFFFFF' } })
        .composite([{ input: await sharp(opts.logoFile).resize(150, 150, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer(), gravity: 'center' }])
        .png().toBuffer()
    : await sharp(Buffer.from(mono)).resize(180, 180).png().toBuffer();
  fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), touch);
}

/** Branded 1200×630 share image: hero photo + name + rating. Used for og:image / iMessage rich links. */
export async function writeOgCard(file: string, opts: { heroFile: string | Buffer; name: string; line2?: string; line3?: string; brand: string; ink: string }) {
  const W = 1200, H = 630;
  const base = await sharp(opts.heroFile, { density: 144 }).resize(W, H, { fit: 'cover' }).toBuffer();
  const name = truncateWords(opts.name, 42);
  const size = name.length > 26 ? 56 : 68;
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset=".25" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".78"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <rect x="0" y="${H - 14}" width="${W}" height="14" fill="${opts.brand}"/>
    <text x="64" y="${H - 150}" font-family="${FONT}" font-weight="800" font-size="${size}" fill="#fff">${esc(name)}</text>
    ${opts.line2 ? `<text x="64" y="${H - 92}" font-family="${FONT}" font-weight="600" font-size="34" fill="#fff" fill-opacity=".92">${esc(opts.line2)}</text>` : ''}
    ${opts.line3 ? `<text x="64" y="${H - 48}" font-family="${FONT}" font-size="26" fill="#fff" fill-opacity=".8">${esc(opts.line3)}</text>` : ''}
  </svg>`;
  await sharp(base).composite([{ input: Buffer.from(overlay) }]).jpeg({ quality: 82, mozjpeg: true }).toFile(file);
}

/** Chromium for screenshots: the local install (Playwright cache, Chrome, Edge) or, on Vercel, @sparticuz/chromium. */
export const screenshotsAvailable = () => !!config.chromiumPath || !!process.env.VERCEL;

export async function launchBrowser() {
  const { chromium } = await import('playwright-core');
  if (!config.chromiumPath && process.env.VERCEL) {
    const { default: serverless } = await import('@sparticuz/chromium'); // a Chromium build for serverless Linux
    serverless.setGraphicsMode = false; // no GPU there; skipping it starts faster
    return chromium.launch({ executablePath: await serverless.executablePath(), args: serverless.args, headless: true });
  }
  return chromium.launch({ executablePath: config.chromiumPath, args: ['--no-sandbox'] });
}

/** Real screenshot of the generated site (needs Chromium). Returns false if unavailable. */
export async function screenshot(htmlFile: string, outFile: string, opts: { width?: number; height?: number; fullPage?: boolean; mobile?: boolean } = {}): Promise<boolean> {
  if (!screenshotsAvailable()) return false;
  try {
    const browser = await launchBrowser();
    try {
      const ctx = await browser.newContext({
        viewport: { width: opts.width ?? 1200, height: opts.height ?? 630 },
        deviceScaleFactor: opts.mobile ? 2 : 1,
        isMobile: !!opts.mobile,
        hasTouch: !!opts.mobile,
        reducedMotion: 'reduce',
      });
      const page = await ctx.newPage();
      // Keep it offline and fast: block third-party requests (maps embed, fonts CDN).
      await page.route('**/*', (r) => (/^(file:|data:)/.test(r.request().url()) || r.request().url().startsWith(config.publicBaseUrl) ? r.continue() : r.abort()));
      await page.goto(htmlFile.startsWith('http') ? htmlFile : `file://${htmlFile}`, { waitUntil: 'load', timeout: 20000 });
      await page.addStyleTag({ content: '.reveal{opacity:1!important;transform:none!important}.bubble,.sticky-bar,.preview,.rw{display:none!important}' });
      await page.screenshot({ path: outFile, fullPage: !!opts.fullPage, type: outFile.endsWith('.png') ? 'png' : 'jpeg', ...(outFile.endsWith('.png') ? {} : { quality: 82 }) });
      return true;
    } finally {
      await browser.close();
    }
  } catch (e) {
    console.warn(`[screenshot] ${(e as Error).message.split('\n')[0]}`);
    return false;
  }
}
