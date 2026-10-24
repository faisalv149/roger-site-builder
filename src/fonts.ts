import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './config.js';

/**
 * Text in the generated images (iMessage cards, og.jpg, the audit score card) is drawn by sharp/librsvg through
 * fontconfig. Vercel's runtime has no fonts and no fontconfig file, so the text came out blank ("Fontconfig error:
 * Cannot load default config file"). There, point fontconfig at the Inter files bundled in fonts/ (OFL, fonts/OFL.txt)
 * and map the families the images ask for onto it. Must run before the first image is drawn (server.ts imports this
 * first). Locally the system fonts are used; BUNDLED_FONTS=1 forces the bundled ones.
 */
const FONTS_DIR = path.join(ROOT, 'fonts');
if ((process.env.VERCEL || process.env.BUNDLED_FONTS === '1') && !process.env.FONTCONFIG_FILE && fs.existsSync(FONTS_DIR)) {
  const conf = path.join(process.env.VERCEL ? os.tmpdir() : path.join(ROOT, 'out'), 'roger-fonts.conf');
  const alias = (family: string) => `<alias><family>${family}</family><prefer><family>Inter</family></prefer></alias>`;
  fs.mkdirSync(path.dirname(conf), { recursive: true });
  fs.writeFileSync(conf, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>${FONTS_DIR}</dir>
  <cachedir>${path.join(path.dirname(conf), 'roger-fontconfig-cache')}</cachedir>
  ${['sans-serif', 'system-ui', 'Arial', 'Helvetica', 'Helvetica Neue', 'DejaVu Sans', 'Segoe UI', 'Roboto'].map(alias).join('\n  ')}
</fontconfig>
`);
  process.env.FONTCONFIG_FILE = conf;
}

let check: Promise<boolean> | null = null;
/** Can sharp draw text here? Draws "Ag" and looks for dark pixels. Shown as `fonts` in /api/health. */
export function textRendering(): Promise<boolean> {
  check ||= import('sharp').then(async ({ default: sharp }) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="44"><rect width="120" height="44" fill="#fff"/><text x="6" y="34" font-family="Inter, sans-serif" font-weight="700" font-size="30" fill="#000">Ag</text></svg>';
    const { data } = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true });
    let dark = 0;
    for (const v of data) if (v < 128) dark++;
    return dark > 40;
  }).catch(() => false);
  return check;
}
