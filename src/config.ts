import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// DATA_DIR lets QA runs use a throwaway folder instead of adding test builds to the real history
// On Vercel only /tmp is writable (and per instance); lasting copies go to Supabase or Redis (src/remote.ts)
const TMP = process.env.VERCEL ? path.join(os.tmpdir(), 'roger') : '';
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : TMP ? path.join(TMP, 'data') : path.join(ROOT, 'data');

// Executable locations inside a Playwright chromium-<rev> folder, per OS.
const PW_INNER = [
  'chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome',
  'chrome-win64/chrome.exe', 'chrome-win/chrome.exe',
  'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
];

function detectChromium(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const home = process.env.HOME || process.env.USERPROFILE || '';
  // Playwright browser caches: explicit, sandbox, then the per-OS defaults.
  const caches = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/opt/pw-browsers',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright'),
    path.join(home, 'Library', 'Caches', 'ms-playwright'),
    path.join(home, '.cache', 'ms-playwright'),
  ].filter(Boolean) as string[];
  const dirs: string[] = [];
  for (const base of caches) {
    dirs.push(path.join(base, 'chromium'));
    try {
      // newest revision first: chromium-1243 before chromium-1223
      const revs = fs.readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
      dirs.push(...revs.map((r) => path.join(base, r)));
    } catch { /* cache not present */ }
  }
  for (const d of dirs) for (const i of PW_INNER) if (fs.existsSync(path.join(d, i))) return path.join(d, i);
  const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const system = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(Boolean) as string[];
  return system.find((c) => { try { return fs.statSync(c).isFile(); } catch { return false; } });
}

const googleKey = process.env.GOOGLE_MAPS_API_KEY || '';
// OUT_DIR: generated sites, cards and reports (default out/). On a host, point it and DATA_DIR at the persistent disk.
const OUT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : TMP ? path.join(TMP, 'out') : path.join(ROOT, 'out');
// Hosts that announce their public URL: Render (RENDER_EXTERNAL_URL), Railway (RAILWAY_PUBLIC_DOMAIN, no scheme)
// A Vercel preview serves itself (VERCEL_URL): its sites, cards and owner links must not point at the production domain
const hostUrl = process.env.RENDER_EXTERNAL_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`)
  || (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`)
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);

export const config = {
  port: Number(process.env.PORT || 4000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || hostUrl || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, ''),
  /** Password for the Studio, the API and the iMessage demo page (user STUDIO_USER, default "roger"). Unset = open (local). */
  studioPassword: process.env.STUDIO_PASSWORD || '',
  studioUser: process.env.STUDIO_USER || 'roger',
  /** Publishing finished sites to Vercel: an access token (vercel.com/account/tokens) and, for a team, its id */
  vercelToken: process.env.VERCEL_TOKEN || '',
  vercelTeamId: process.env.VERCEL_TEAM_ID || '',
  vercelProjectPrefix: process.env.VERCEL_PROJECT_PREFIX ?? 'roger-',
  vercelApi: (process.env.VERCEL_API_URL || 'https://api.vercel.com').replace(/\/$/, ''), // overridable for tests
  googleKey,
  pagespeedKey: process.env.PAGESPEED_API_KEY || googleKey,
  /** Google PageSpeed Insights in website audits (src/audit/pagespeed.ts). PAGESPEED=0 turns it off. */
  pagespeed: process.env.PAGESPEED !== '0',
  /** Google's Lighthouse run usually takes 10-40 s; a very slow site can take longer */
  pagespeedTimeoutMs: Number(process.env.PAGESPEED_TIMEOUT_MS || 110_000),
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  /** Local demos without an API key: answer through the signed-in Claude Code CLI (`claude -p`). An API key wins. */
  claudeCli: process.env.CLAUDE_CLI === '1',
  claudeCliPath: process.env.CLAUDE_CLI_PATH || 'claude',
  /** Your iMessage gateway's send endpoint: messages Roger sends later (the preview after "On it") are POSTed here as { from, replies } */
  imessageOutboundUrl: process.env.IMESSAGE_OUTBOUND_URL || '',
  mock: process.env.MOCK === '1' || !googleKey,
  /** Personalisation pilot (src/design): automatic plumbing builds get a design plan. DESIGN_PILOT=0 turns it off. */
  designPilot: process.env.DESIGN_PILOT !== '0',
  leadWebhook: process.env.LEAD_WEBHOOK_URL || '',
  /**
   * Demo checkout in the owner preview (src/orders.ts): records a demo order, takes no payment, buys no domain and
   * deploys nothing. The sample package is configurable; it is never the business's own prices.
   */
  demoCheckout: process.env.DEMO_CHECKOUT !== '0',
  demoPackage: {
    name: process.env.DEMO_PACKAGE_NAME || 'Roger Website',
    amount: Number(process.env.DEMO_PACKAGE_PRICE || 29),
    currency: (process.env.DEMO_PACKAGE_CURRENCY || 'USD').toUpperCase(),
    cadence: (process.env.DEMO_PACKAGE_CADENCE || 'month') as 'month' | 'year' | 'one-time',
    features: (process.env.DEMO_PACKAGE_FEATURES || 'Your saved design, hosted and kept online|Connect your own domain, with HTTPS|Customer requests sent to you by text|Edit colours, fonts and prices any time').split('|'),
  },
  /** Roger's iMessage address (phone or Apple ID email). Used for "Claim this site" links on previews. */
  rogerImessage: process.env.ROGER_IMESSAGE_ADDRESS || '',
  chromiumPath: detectChromium(),
  dirs: {
    themes: path.join(ROOT, 'themes'),
    customThemes: path.join(DATA, 'themes'),
    out: OUT,
    sites: path.join(OUT, 'sites'),
    reports: path.join(OUT, 'reports'),
    cards: path.join(OUT, 'cards'),
    orders: path.join(OUT, 'orders'),
    data: DATA, // saved builds, conversations, leads, uploaded themes
    public: path.join(ROOT, 'public'),
    fixtures: path.join(ROOT, 'fixtures'),
  },
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 RogerSiteBuilder/0.1',
};

for (const d of Object.values(config.dirs)) fs.mkdirSync(d, { recursive: true });
