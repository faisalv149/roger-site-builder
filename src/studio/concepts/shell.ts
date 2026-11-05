import fs from 'node:fs';
import path from 'node:path';
import { MENU_JS, baseCss } from './library.js';
import type { DesignTokens } from './types.js';

/**
 * Inner pages in the chosen concept's design: its header (with the phone menu) and footer replace the builder's, and its
 * tokens (colours, typefaces, corners, section spacing) replace the builder's on the page itself. The page's own
 * content, forms, SEO head and scripts are the builder's, untouched. The concept's styles are scoped to its header and
 * footer (".cx"), so they can't restyle the builder's content.
 */
const SCOPE = '.cx';

/** Every selector of a stylesheet put under one scope; the page-level ones (:root, html, body) become the scope itself. */
export function scopeCss(css: string, scope = SCOPE): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    // find the matching close brace
    let depth = 1, j = open + 1;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    const body = css.slice(open + 1, j - 1);
    const sel = head.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (/^@(media|supports|container)/.test(sel)) out += `${sel}{${scopeCss(body, scope)}}`;
    else if (/^@/.test(sel)) out += `${sel}{${body}}`;
    else if (sel) {
      out += `${sel.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
        if (/^(:root|html|body)$/.test(s)) return scope;
        if (/^(html|body)\s+/.test(s)) return s.replace(/^(html|body)\s+/, `${scope} `);
        return `${scope} ${s}`;
      }).join(',')}{${body}}`;
    }
    i = j;
  }
  return out;
}

/** Point a home-page fragment's links and pictures at the right place from a page `depth` folders down. */
function rebase(html: string, depth: number): string {
  if (!depth) return html;
  const up = '../'.repeat(depth);
  return html
    .replace(/href="#/g, `href="${up}#`)
    .replace(/(href|src)="(?!https?:|tel:|mailto:|sms:|data:|#|\/|\.\.\/)([^"]+)"/g, `$1="${up}$2"`);
}

// the builder's page families: fw / fe / fb, and the classic one
const BUILDER_HEAD = /<header class="(?:f[a-z]-head|site-header)[^"]*"[\s\S]*?<\/header>/;
const BUILDER_FOOT = /<footer class="(?:f[a-z]-foot|site-footer)[^"]*"[\s\S]*?<\/footer>/;

/** The token block for the builder's own variables: colours, typefaces, corners and section spacing. */
function tokenCss(t: DesignTokens): string {
  const c = t.colors;
  const y = (px: number) => `${Math.round(px * t.space)}px`;
  return `:root:root{--brand:${c.action};--brand-ink:${c.onAction};--brand-text:${c.brandText};--ink:${c.ink};--ink-muted:${c.muted};--surface:${c.bg};--surface-alt:${c.surface};--tint-1:${c.surface};--tint-2:${c.surface};--tint-3:${c.line};--band:${c.surface};--font-heading:${t.fonts.heading.css};--font-body:${t.fonts.body.css};--r-sm:${Math.round(t.radius / 2)}px;--r-md:${t.radius}px;--r-lg:${Math.round(t.radius * 1.5)}px;--section-y:${y(56)}}@media (min-width:900px){:root:root{--section-y:${y(96)}}}`;
}

/**
 * Write the concept's shell into every inner page: header and footer from the concept homepage (as rendered, with its
 * menu of every page), its scoped styles, the tokens and the menu script. Each run starts from the builder's page
 * (inner pages are rewritten by every save), so it never stacks.
 */
export function applyConceptShell(siteDir: string, homeFile: string, homeHtml: string, t: DesignTokens): { pages: number; shelled: number } {
  const header = homeHtml.match(/<header class="site-head[\s\S]*?<\/header>/)?.[0];
  const footer = homeHtml.match(/<footer class="site-foot[\s\S]*?<\/footer>/)?.[0];
  const style = `<link rel="stylesheet" href="${t.fonts.href}" data-concept-tokens><style id="concept-tokens">${tokenCss(t)}</style><style id="concept-shell">${scopeCss(baseCss(t))}</style>`;
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'assets' ? [] : walk(path.join(dir, e.name))) : e.name.endsWith('.html') ? [path.join(dir, e.name)] : []));
  let pages = 0, shelled = 0;
  for (const f of walk(siteDir)) {
    if (f === homeFile) continue;
    pages++;
    const depth = path.relative(siteDir, path.dirname(f)).split(path.sep).filter(Boolean).length;
    let html = fs.readFileSync(f, 'utf8')
      .replace(/<link rel="stylesheet" href="[^"]*" data-concept-tokens><style id="concept-tokens">[\s\S]*?<\/style>(<style id="concept-shell">[\s\S]*?<\/style>)?/, '')
      .replace(/<script id="concept-menu">[\s\S]*?<\/script>/, '');
    if (header && footer && BUILDER_HEAD.test(html) && BUILDER_FOOT.test(html) && !html.includes('class="cx cx-head"')) {
      html = html.replace(BUILDER_HEAD, `<div class="cx cx-head">${rebase(header, depth)}</div>`).replace(BUILDER_FOOT, `<div class="cx cx-foot">${rebase(footer, depth)}</div>`);
      shelled++;
    }
    html = html.replace('</head>', `${style}</head>`).replace('</body>', `<script id="concept-menu">${MENU_JS}</script></body>`);
    fs.writeFileSync(f, html);
  }
  return { pages, shelled };
}
