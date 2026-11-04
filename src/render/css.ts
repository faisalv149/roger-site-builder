import type { SiteModel } from '../content/model.js';
import { WIDGETS_CSS } from './widgets.js';
import { designCss } from './design-css.js';
import { withAlpha } from '../color/oklch.js';

const DESK = 900; // desktop breakpoint (px)
const TAB = 640;

/** Theme tokens → CSS custom properties + the component stylesheet. */
export function buildCss(m: SiteModel): string {
  const t = m.theme;
  const b = m.brand;
  const ty = t.type;
  const sc = ty.scale;
  const pad = t.spacing.density === 'compact' ? 18 : t.spacing.density === 'spacious' ? 32 : 24;
  const r = t.radius;
  const btn = t.buttons;
  const btnRadius = (k: string) => (k in r ? `var(--r-${k})` : k);
  const fill = (k: string) => (k === 'brand' ? 'var(--brand)' : k === 'transparent' ? 'transparent' : k === 'brand-ink' ? 'var(--brand-ink)' : k);
  const ink = (k: string) => (k === 'brand-ink' ? 'var(--brand-ink)' : k === 'brand' ? 'var(--brand-text)' : k);
  const border = (k: string) => (k === 'none' ? '0' : k === 'brand' ? '2px solid var(--brand-text)' : k);
  const focus = btn.focusRing.replace(/shade-(\d)/, 'var(--shade-$1)').replace(/tint-(\d)/, 'var(--tint-$1)').replace(/\bbrand\b/, 'var(--brand)');
  const ov = t.overlayAlpha;
  const overlay =
    t.overlayStyle === 'gradient-left'
      ? `linear-gradient(90deg, ${withAlpha(t.palette.ink, Math.min(0.92, ov + 0.2))} 0%, ${withAlpha(t.palette.ink, ov)} 45%, ${withAlpha(t.palette.ink, Math.max(0.12, ov - 0.4))} 100%)`
      : t.overlayStyle === 'gradient-bottom'
        ? `linear-gradient(0deg, ${withAlpha(t.palette.ink, Math.min(0.92, ov + 0.25))} 0%, ${withAlpha(t.palette.ink, ov)} 45%, ${withAlpha(t.palette.ink, Math.max(0.15, ov - 0.35))} 100%)`
        : withAlpha(t.palette.ink, ov);
  const caseCss = (c: string) => (c === 'uppercase' ? 'uppercase' : c === 'title' ? 'capitalize' : 'none');
  const heroL = t.sectionLayout.hero || ({} as any);
  const ratio = (s: string) => s.replace(':', ' / ');

  return `
:root{
  --brand:${b.brand};--brand-ink:${b.brandInk};--brand-text:${m.brandText};
  --tint-1:${b.tints[0]};--tint-2:${b.tints[1]};--tint-3:${b.tints[2]};
  --shade-1:${b.shades[0]};--shade-2:${b.shades[1]};--shade-3:${b.shades[2]};
  --ink:${t.palette.ink};--ink-muted:${t.palette.inkMuted};--surface:${t.palette.surface};--surface-alt:${t.palette.surfaceAlt};
  --font-heading:${m.fonts.heading};--font-body:${m.fonts.body};
  --fs-xs:${sc.xs}px;--fs-sm:${sc.sm}px;--fs-md:${sc.md}px;--fs-lg:${sc.lg}px;--fs-xl:${sc.xl}px;--fs-2xl:${sc['2xl']}px;--fs-3xl:${sc['3xl']}px;--fs-4xl:${sc['4xl'].phone}px;
  --fs-h2:${sc['2xl']}px;
  --lh-h:${ty.lineHeight.heading};--lh-b:${ty.lineHeight.body};--hw:${ty.headingWeight};--bw:${ty.bodyWeight};--h-track:${ty.headingTracking};--measure:${ty.measure}ch;
  --r-sm:${r.sm}px;--r-md:${r.md}px;--r-lg:${r.lg}px;--shadow:${t.shadow.card};
  --section-y:${t.spacing.sectionY.phone}px;--gutter:${Math.min(t.grid.gutter, 20)}px;--margin:${t.grid.margin.phone}px;--maxw:${t.grid.maxWidth}px;--cols:${t.grid.columns};
  ${t.spacing.scale.map((v, i) => `--sp-${i + 1}:${v}px`).join(';')};
  --pad:${pad}px;--tap:${btn.minTapTarget}px;
  --overlay:${overlay};
  --hero-h:${heroL.height?.phone || 'auto'};
  --hero-ratio:${ratio(t.images.hero.ratio.phone)};--gal-ratio:${ratio(t.images.gallery.ratio)};
  color-scheme:${t.colorScheme};
}
@media (min-width:${DESK}px){:root{
  --fs-4xl:${sc['4xl'].desktop}px;--fs-h2:${sc['3xl']}px;--section-y:${t.spacing.sectionY.desktop}px;--gutter:${t.grid.gutter}px;--margin:${t.grid.margin.desktop}px;
  --hero-h:${heroL.height?.desktop || 'auto'};--hero-ratio:${ratio(t.images.hero.ratio.desktop)};
}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--surface);color:var(--ink);font-family:var(--font-body);font-size:var(--fs-md);font-weight:var(--bw);line-height:var(--lh-b);-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto;display:block}
figure,blockquote{margin:0}
a{color:var(--brand-text)}
h1,h2,h3,.h{font-family:var(--font-heading);font-weight:var(--hw);line-height:var(--lh-h);letter-spacing:var(--h-track);text-transform:${caseCss(ty.headingCase)};margin:0;color:inherit;text-wrap:balance}
h1{font-size:var(--fs-4xl)}h2{font-size:var(--fs-h2)}h3{font-size:var(--fs-lg)}
p{margin:0;max-width:var(--measure)}
.muted{color:var(--ink-muted)}
.small{font-size:var(--fs-sm)}
.xs{font-size:var(--fs-xs)}
.eyebrow{font-size:var(--fs-sm);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--brand-text);display:inline-flex;gap:8px;align-items:center}
.ic{flex:none;vertical-align:middle}
.skip{position:absolute;left:-999px;top:0;background:var(--ink);color:#fff;padding:8px 12px;z-index:100}
.skip:focus{left:8px}
:focus-visible{outline:${focus};outline-offset:2px}
.visually-hidden{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* ── grid ── */
.wrap{width:100%;max-width:calc(var(--maxw) + 2*var(--margin));margin-inline:auto;padding-inline:var(--margin)}
.grid{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));column-gap:var(--gutter);row-gap:var(--sp-6)}
.gi{grid-column:1/-1}
@media (min-width:${DESK}px){.gi{grid-column:var(--start,auto)/span var(--s,var(--cols))}}
.cols{display:grid;gap:var(--gutter);grid-template-columns:repeat(var(--cp,1),minmax(0,1fr))}
@media (min-width:${DESK}px){.cols{grid-template-columns:repeat(var(--cd,var(--cp,1)),minmax(0,1fr))}}
.section{padding-block:var(--section-y)}
.section.alt{background:var(--surface-alt)}
.section.tint{background:var(--tint-1)}
.sec-head{display:grid;gap:var(--sp-3);margin-bottom:var(--sp-6)}
.sec-head.center{text-align:center;justify-items:center}
.sec-head.center p{margin-inline:auto}
.stack>*+*{margin-top:var(--sp-4)}

/* ── buttons ── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:max(var(--tap),var(--bh));padding:0 22px;font-family:inherit;font-size:var(--fs-md);text-decoration:none;cursor:pointer;transition:filter .15s, transform .15s;white-space:nowrap;line-height:1.1}
.btn:hover{filter:brightness(.94)}
.btn:active{transform:translateY(1px)}
.btn-primary{--bh:${btn.primary.height}px;background:${fill(btn.primary.fill)};color:${ink(btn.primary.ink)};border:${border(btn.primary.border)};border-radius:${btnRadius(String(btn.primary.radius))};text-transform:${caseCss(String(btn.primary.case))};font-weight:${btn.primary.weight}}
.btn-secondary{--bh:${btn.secondary.height}px;background:${fill(btn.secondary.fill)};color:${ink(btn.secondary.ink)};border:${border(btn.secondary.border)};border-radius:${btnRadius(String(btn.secondary.radius))};text-transform:${caseCss(String(btn.secondary.case))};font-weight:${btn.secondary.weight}}
.on-dark .btn-secondary{color:#fff;border-color:rgba(255,255,255,.85)}
.on-dark .btn-secondary:hover{background:rgba(255,255,255,.12)}
.btn-light{--bh:${btn.primary.height}px;background:#fff;color:var(--shade-3);border:0;border-radius:${btnRadius(String(btn.primary.radius))};font-weight:${btn.primary.weight};text-transform:${caseCss(String(btn.primary.case))}}
.btn-row{display:flex;flex-wrap:wrap;gap:12px}
.btn-block{width:100%}
.link-arrow{display:inline-flex;align-items:center;gap:6px;font-weight:600;text-decoration:none}
.link-arrow:hover{text-decoration:underline}

/* ── preview banner / header ── */
.preview{background:var(--ink);color:#fff;font-size:var(--fs-xs);text-align:center;padding:8px var(--margin)}
.preview a{color:#fff;font-weight:600}
.site-header{background:var(--surface);border-bottom:1px solid rgba(0,0,0,.07)}
.hdr{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px;padding-block:${t.logo.padding}px}
.logo img{height:${t.logo.maxHeight.phone}px;width:auto;max-width:200px;object-fit:contain}
@media (min-width:${DESK}px){.logo img{height:${t.logo.maxHeight.desktop}px;max-width:280px}}
.logo{display:flex;align-items:center;text-decoration:none;color:var(--brand-text);min-width:0}
.wordmark{font-family:var(--font-heading);font-weight:var(--hw);font-size:var(--fs-lg);line-height:1.1;letter-spacing:var(--h-track);display:-webkit-box;-webkit-line-clamp:${t.logo.wordmark.maxLines};-webkit-box-orient:vertical;overflow:hidden;max-width:18ch;text-transform:none}
.wordmark.long{font-size:var(--fs-md)}
@media (min-width:${DESK}px){.wordmark{font-size:var(--fs-xl)}.wordmark.long{font-size:var(--fs-lg)}}
.nav{display:none;gap:24px}
.nav a{color:var(--ink);text-decoration:none;font-size:var(--fs-sm);font-weight:600;white-space:nowrap}
.nav a:hover{color:var(--brand-text)}
@media (min-width:${DESK}px){.nav{display:${t.grid.maxWidth >= 1000 ? 'flex' : 'none'}}}
.hdr-call .num{display:none}
@media (min-width:${TAB}px){.hdr-call .num{display:inline}}
.hdr-call{--bh:44px;padding:0 14px;font-size:var(--fs-sm)}

/* ── hero ── */
.hero{position:relative}
.hero h1{max-width:20ch}
.hero .sub{font-size:var(--fs-lg);color:var(--ink-muted)}
.hero .stack>*+*{margin-top:var(--sp-5)}
.hero .btn-row{margin-top:var(--sp-6)}
.trust-row{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:var(--sp-6);padding:0;list-style:none;font-size:var(--fs-sm);font-weight:600}
.trust-row li{display:inline-flex;align-items:center;gap:6px}
.trust-row .ic{color:var(--brand-text)}
.on-dark{color:#fff}
.on-dark .sub,.on-dark .muted{color:rgba(255,255,255,.88)}
.on-dark .trust-row .ic,.on-dark .eyebrow{color:#fff}
.bg-photo{position:absolute;inset:0;overflow:hidden}
.bg-photo img{width:100%;height:100%;object-fit:cover}
.bg-photo::after{content:"";position:absolute;inset:0;background:var(--overlay)}
.hero-fb{display:flex;align-items:center;min-height:var(--hero-h);padding-block:calc(var(--section-y) * 1.2)}
.hero-fb .content{position:relative;text-align:center;display:grid;justify-items:center}
.hero-fb .content p{margin-inline:auto}
.hero-fb h1{max-width:18ch;margin-inline:auto}
.hero-fb .btn-row,.hero-fb .trust-row{justify-content:center}
.hero-split{padding-block:var(--section-y)}
.hero-split .media img{width:100%;aspect-ratio:var(--hero-ratio);object-fit:cover;border-radius:var(--r-lg)}
@media (min-width:${DESK}px){.hero-split .grid{align-items:center}.hero-split .media img{aspect-ratio:auto;height:min(72vh,620px)}}
.hero-bleed{display:grid;grid-template-columns:1fr}
.hero-bleed .text{padding:var(--section-y) var(--margin)}
.hero-bleed .media img{width:100%;height:100%;aspect-ratio:var(--hero-ratio);object-fit:cover}
@media (min-width:${DESK}px){
  .hero-bleed{grid-template-columns:minmax(0,var(--fa)) minmax(0,var(--fb));min-height:min(80vh,720px)}
  .hero-bleed .text{align-self:center;padding-left:max(var(--margin), calc((100vw - var(--maxw)) / 2));padding-right:calc(var(--gutter)*2)}
  .hero-bleed.media-left .text{padding-left:calc(var(--gutter)*2);padding-right:max(var(--margin), calc((100vw - var(--maxw)) / 2))}
  .hero-bleed .media img{aspect-ratio:auto;min-height:100%}
}
.hero-form{padding-block:calc(var(--section-y) * 1.1)}
.hero-form .grid{position:relative;align-items:center}
.hero-stack{padding-block:var(--section-y) 0}
.hero-stack .text{display:grid;gap:var(--sp-5)}
.hero-stack.center .text{text-align:center;justify-items:center}
.hero-stack.center p,.hero-stack.center h1{margin-inline:auto}
.hero-stack.center .btn-row,.hero-stack.center .trust-row{justify-content:center}
.hero-stack .inset{margin-top:var(--section-y)}
.hero-stack .inset img{width:100%;aspect-ratio:var(--hero-ratio);object-fit:cover;border-radius:var(--r-lg)}
.hero-stack + .section{padding-top:var(--section-y)}
.badge-rating{display:inline-flex;align-items:center;gap:8px;font-size:var(--fs-sm);font-weight:600}
.stars{color:#E8A317;letter-spacing:1px;display:inline-flex}
.on-dark .stars{color:#FFC94D}

/* ── cards / forms ── */
.card{background:var(--surface);border-radius:var(--r-md);box-shadow:var(--shadow);padding:var(--pad);${t.shadow.card === 'none' ? 'border:1px solid rgba(0,0,0,.1);' : ''}}
.card h3{margin-bottom:6px}
.form{display:grid;gap:14px;color:var(--ink)}
.form .row2{display:grid;gap:14px}
@media (min-width:${TAB}px){.form .row2{grid-template-columns:1fr 1fr}}
.form label{display:grid;gap:6px;font-size:var(--fs-sm);font-weight:600}
.form input,.form select,.form textarea{font:inherit;font-size:16px;color:var(--ink);background:#fff;border:1px solid rgba(0,0,0,.22);border-radius:var(--r-sm);min-height:var(--tap);padding:10px 12px;width:100%}
.form textarea{min-height:96px;resize:vertical}
.form input:focus,.form select:focus,.form textarea:focus{outline:${focus};outline-offset:1px;border-color:transparent}
.form .consent{font-size:var(--fs-xs);color:var(--ink-muted);max-width:none}
.form .ok{display:none;padding:14px;border-radius:var(--r-sm);background:var(--tint-1);color:var(--shade-3);font-weight:600}
.form.sent .ok{display:block}.form.sent .fields{display:none}
.form .fields{display:grid;gap:14px;position:relative}
.hp{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);left:0;top:0}
.form-title{margin-bottom:var(--sp-3)}
.steps{list-style:none;padding:0;margin:var(--sp-6) 0 0;display:grid;gap:var(--sp-5)}
.steps li{display:grid;grid-template-columns:40px 1fr;gap:14px;align-items:start}
.steps .n{width:40px;height:40px;border-radius:999px;background:var(--tint-2);color:var(--shade-2);display:grid;place-items:center;font-weight:700}

/* ── urgent ── */
.urgent-bar{background:var(--brand);color:var(--brand-ink);padding-block:var(--sp-5)}
.urgent-bar .in{display:flex;flex-wrap:wrap;gap:14px 24px;align-items:center;justify-content:space-between}
.urgent-bar p{font-family:var(--font-heading);font-weight:var(--hw);font-size:var(--fs-xl);text-transform:${caseCss(ty.headingCase)};display:flex;gap:12px;align-items:center;max-width:none}
.urgent-bar .btn-light{color:${b.brandInk === '#FFFFFF' ? 'var(--shade-3)' : 'var(--ink)'}}
.callout{border-left:4px solid var(--brand);background:var(--tint-1);border-radius:var(--r-md);padding:var(--pad);display:flex;flex-wrap:wrap;gap:14px 20px;align-items:center;justify-content:space-between}
.callout p{font-weight:700;font-size:var(--fs-lg);display:flex;gap:10px;align-items:center}
.callout .ic{color:var(--brand-text)}

/* ── services ── */
.tile{display:grid;gap:12px;align-content:start;padding:var(--pad);background:var(--surface);border-radius:var(--r-md);${t.shadow.card === 'none' ? 'border:1px solid rgba(0,0,0,.1)' : 'box-shadow:var(--shadow)'}}
.tile .ic,.svc-ic{color:${t.icons.color === 'brand' ? 'var(--brand-text)' : t.icons.color}}
.tile b{font-size:var(--fs-md);font-weight:700;line-height:1.25}
.svc-ic{width:48px;height:48px;border-radius:var(--r-md);background:var(--tint-1);display:grid;place-items:center}
.svc-card{display:grid;gap:14px;align-content:start}
.svc-row{display:grid;grid-template-columns:48px 1fr;gap:16px;align-items:start}
.checklist{list-style:none;padding:0;margin:0}
.checklist li{display:flex;gap:12px;align-items:flex-start;padding:14px 0;border-bottom:1px solid rgba(0,0,0,.08)}
.checklist .ic{color:var(--brand-text);margin-top:2px}
.numbered{list-style:none;padding:0;margin:0;counter-reset:n}
.numbered li{display:grid;grid-template-columns:64px 1fr;gap:16px;padding:var(--sp-5) 0;border-top:1px solid rgba(0,0,0,.1)}
.numbered li:last-child{border-bottom:1px solid rgba(0,0,0,.1)}
.numbered .num{font-family:var(--font-heading);font-size:var(--fs-2xl);color:var(--brand-text);line-height:1}
.zig{display:grid;gap:var(--gutter);align-items:center;padding-block:var(--sp-5)}
.zig img{width:100%;aspect-ratio:var(--gal-ratio);object-fit:cover;border-radius:var(--r-lg)}
@media (min-width:${DESK}px){.zig{grid-template-columns:minmax(0,var(--za)) minmax(0,var(--zb))}.zig.flip .zmedia{order:2}}
.zig .ztext{display:grid;gap:12px;align-content:center}
.zig h3{font-size:var(--fs-xl)}
.also{display:flex;flex-wrap:wrap;gap:10px;margin-top:var(--sp-6);padding:0;list-style:none}
.overflow{margin-top:var(--sp-6)}

/* ── proof ── */
.stat{display:grid;gap:4px}
.stat .v{font-family:var(--font-heading);font-size:var(--fs-2xl);font-weight:var(--hw);line-height:1;color:var(--brand-text);overflow-wrap:anywhere}
.stat .v.word{font-size:var(--fs-xl)}
@media (min-width:${DESK}px){.stat .v{font-size:var(--fs-3xl)}.stat .v.word{font-size:var(--fs-2xl)}}
.stat .l{font-size:var(--fs-sm);color:var(--ink-muted)}
.quote-card{display:grid;gap:12px;align-content:start}
.quote-card blockquote,.pull blockquote{margin:0}
.quote-card blockquote{font-size:var(--fs-md)}
.quote-card figcaption,.pull figcaption{font-size:var(--fs-sm);color:var(--ink-muted)}
.quotes{margin-top:var(--sp-7)}
.chips{display:flex;flex-wrap:wrap;gap:10px;list-style:none;padding:0;margin:0}
.chip{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:999px;background:var(--tint-1);color:var(--shade-3);font-size:var(--fs-sm);font-weight:600}
.chip .ic{color:var(--brand-text)}
.pull{text-align:center}
.pull blockquote{font-family:var(--font-heading);font-size:var(--fs-2xl);line-height:1.3;font-weight:var(--hw);text-transform:none}
.pull figcaption{margin-top:var(--sp-5)}
.pull .meta{margin-top:var(--sp-6);display:flex;justify-content:center;flex-wrap:wrap;gap:8px 20px;font-size:var(--fs-sm);font-weight:600}
.attrib{margin-top:var(--sp-5);font-size:var(--fs-xs);color:var(--ink-muted)}
.tint .attrib{text-align:center;max-width:none}

/* ── gallery ── */
.gal img{width:100%;height:100%;object-fit:cover;border-radius:var(--r-md);aspect-ratio:var(--gal-ratio)}
.gal figure{margin:0;position:relative}
.gal figcaption{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;padding:2px 6px;border-radius:4px}
.bento{display:grid;gap:12px;grid-template-columns:repeat(var(--cp),1fr);grid-auto-rows:minmax(140px,1fr)}
.bento img{aspect-ratio:auto}
@media (min-width:${DESK}px){.bento{grid-template-columns:repeat(var(--cd),1fr);grid-auto-rows:220px}.bento .s2x2{grid-column:span 2;grid-row:span 2}.bento .s2x1{grid-column:span 2}.bento .s1x2{grid-row:span 2}}
.scroller{display:grid;grid-auto-flow:column;grid-auto-columns:calc((100% - (var(--pvp) - 1) * 12px) / var(--pvp));gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:8px;scrollbar-width:thin}
.scroller>*{scroll-snap-align:start}
@media (min-width:${DESK}px){.scroller{grid-auto-columns:calc((100% - (var(--pvd) - 1) * 12px) / var(--pvd))}}

/* ── area / hours ── */
.map{width:100%;border:0;border-radius:var(--r-md);min-height:280px;height:100%;background:var(--surface-alt)}
.towns{list-style:none;padding:0;margin:0;display:grid;gap:10px 24px}
.towns li{display:flex;gap:8px;align-items:center}
.towns .ic{color:var(--brand-text)}
.hours{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
.hours td{padding:6px 0;border-bottom:1px solid rgba(0,0,0,.07)}
.hours td+td{text-align:right}
.hours tr.today td{font-weight:700}
.open-now{display:inline-flex;align-items:center;gap:8px;font-size:var(--fs-sm);font-weight:700}
.open-now::before{content:"";width:9px;height:9px;border-radius:9px;background:#9AA3AD}
.open-now.is-open::before{background:#16A34A}
.addr{display:flex;gap:10px;align-items:flex-start}

/* ── maintenance ── */
.plan{display:flex;flex-wrap:wrap;gap:var(--sp-5);align-items:center;justify-content:space-between;padding:var(--sp-7) var(--pad);background:var(--tint-1);border-radius:var(--r-lg)}
.plan .ic{color:var(--brand-text)}
.plan h2{font-size:var(--fs-2xl)}

/* ── footer ── */
.site-footer{background:var(--shade-3);color:rgba(255,255,255,.86);padding-block:calc(var(--section-y) * .8) var(--sp-6);font-size:var(--fs-sm)}
.site-footer a{color:#fff}
.site-footer h3{font-size:var(--fs-md);color:#fff;margin-bottom:12px;text-transform:none;letter-spacing:0}
.site-footer ul{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.site-footer .wordmark{color:#fff;font-size:var(--fs-xl)}
.site-footer .logo-chip{display:inline-flex;background:#fff;padding:8px 12px;border-radius:var(--r-md)}
.site-footer .logo-chip img{height:36px;width:auto}
.f-bottom{margin-top:var(--sp-7);padding-top:var(--sp-5);border-top:1px solid rgba(255,255,255,.15);display:flex;flex-wrap:wrap;gap:8px 20px;justify-content:space-between;font-size:var(--fs-xs)}
.f-center{text-align:center;display:grid;justify-items:center;gap:var(--sp-4)}
.f-center .inline{display:flex;flex-wrap:wrap;gap:10px 22px;justify-content:center}
.socials{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:12px}
.socials a{display:inline-flex;align-items:center;gap:6px}

/* ── estimate layout (sidebar-12) ── */
.layout{display:flex;flex-direction:column}
.layout>.main{display:contents}
@media (min-width:${DESK}px){
  .layout{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));column-gap:var(--gutter);align-items:start}
  .layout>.main{display:block;grid-column:var(--main-col)}
  .layout>.aside{grid-column:var(--aside-col);grid-row:1;position:${t.grid.sidebar?.sticky ? 'sticky' : 'static'};top:24px;margin-block:var(--section-y);order:0!important}
  .layout .main .section{--cols:8}
}
.layout .main .section{padding-block:calc(var(--section-y) * .75)}

/* ── Roger components ── */
.sticky-bar{position:fixed;left:0;right:0;bottom:0;z-index:40;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:1px;background:rgba(0,0,0,.12);box-shadow:0 -4px 18px rgba(0,0,0,.12);padding-bottom:env(safe-area-inset-bottom)}
.sticky-bar a{display:flex;align-items:center;justify-content:center;gap:8px;min-height:56px;background:var(--surface);color:var(--ink);text-decoration:none;font-weight:700;font-size:var(--fs-sm)}
.sticky-bar a.primary{background:var(--brand);color:var(--brand-ink)}
@media (min-width:${DESK}px){.sticky-bar{display:none}}
body.has-bar{padding-bottom:64px}
@media (min-width:${DESK}px){body.has-bar{padding-bottom:0}}
.bubble{position:fixed;right:18px;bottom:80px;z-index:41;display:inline-flex;align-items:center;gap:8px;padding:0 18px;min-height:52px;border-radius:999px;background:var(--brand);color:var(--brand-ink);text-decoration:none;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.22)}
.bubble .t{display:none}
@media (min-width:${DESK}px){.bubble{bottom:24px}.bubble .t{display:inline}}
@media (max-width:${DESK - 1}px){.has-bar .bubble{display:none}}
.credit{opacity:.75}
img[src^="/gphoto/"]{object-fit:cover}
${WIDGETS_CSS(DESK)}
${m.design ? designCss(m, DESK) : ''}

/* ── motion ── */
${t.motion !== 'none' ? `.js .reveal{opacity:0;transform:translateY(14px);transition:opacity .5s ease, transform .5s ease}.js .reveal.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.js .reveal{opacity:1;transform:none;transition:none}html{scroll-behavior:auto}}` : ''}
`;
}
