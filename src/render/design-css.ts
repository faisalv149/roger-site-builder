import type { SiteModel } from '../content/model.js';
import { DIRECTION_PRESETS } from '../design/directions.js';

/**
 * Styles for the personalisation pilot's directions (src/render/design-sections.ts). Appended after the regular
 * stylesheet; scoped by body[data-direction] where a direction differs. Uses the same tokens (--brand, --surface,
 * --fs-*, --sp-*), which the direction preset filled in (src/design/directions.ts).
 */
export function designCss(m: SiteModel, DESK: number): string {
  const band = m.design!.band;
  const sc = m.theme.type.scale;
  const sy = m.theme.spacing.sectionY;
  const btnR = DIRECTION_PRESETS[m.design!.plan.direction].buttons.radius;
  // owner appearance hooks (src/design/appearance.ts): text scale, spacing and button shape follow variables the
  // editor can change live; without them every value is the direction's own
  const fs = (k: string, v: number) => `--fs-${k}:calc(${v}px * var(--tk,1))`;
  return `
:root{--band:${band};--btn-r0:${btnR};${fs('xs', sc.xs)};${fs('sm', sc.sm)};${fs('md', sc.md)};${fs('lg', sc.lg)};${fs('xl', sc.xl)};${fs('2xl', sc['2xl'])};${fs('3xl', sc['3xl'])};${fs('4xl', sc['4xl'].phone)};--fs-h2:calc(${sc['2xl']}px * var(--tk,1));--section-y:calc(${sy.phone}px * var(--density,1))}
@media (min-width:${DESK}px){:root{${fs('4xl', sc['4xl'].desktop)};--fs-h2:calc(${sc['3xl']}px * var(--tk,1));--section-y:calc(${sy.desktop}px * var(--density,1))}}
.btn-primary{background:var(--btn-bg,var(--brand));border-color:transparent}
.btn-primary,.btn-secondary,.btn-light,.hdr-call{border-radius:var(--btn-r,var(--btn-r0))}
.d-band{background:var(--band-bg,var(--brand)) !important}
.btn:focus-visible,.link-arrow:focus-visible,.cz-btn:focus-visible,.cz-dot:focus-visible,.cz-track:focus-visible{outline:3px solid var(--brand-text);outline-offset:3px}

/* motion: Off · Subtle (default) · Expressive; reduced motion always wins */
.card,.btn,.link-arrow .ic{transition:transform .2s ease,box-shadow .2s ease,filter .15s ease}
@media (hover:hover){.d-svc-card:hover,.d-plan:hover{transform:translateY(-2px);box-shadow:0 14px 30px -18px rgba(0,0,0,.35)}.link-arrow:hover .ic{transform:translateX(3px)}}
.d-svc-card:focus-within,.d-plan:focus-within{transform:translateY(-2px);box-shadow:0 14px 30px -18px rgba(0,0,0,.35)}
.js body[data-motion=expressive] .reveal{transform:translateY(28px)}
.js body[data-motion=expressive] .reveal.in{transform:none}
@media (hover:hover){body[data-motion=expressive] .d-svc-card:hover,body[data-motion=expressive] .d-plan:hover{transform:translateY(-5px)}body[data-motion=expressive] .lb-open:hover img{transform:scale(1.07)}}
body[data-motion=off] *,body[data-motion=off] *::before,body[data-motion=off] *::after{transition:none !important;animation:none !important}
.js body[data-motion=off] .reveal{opacity:1 !important;transform:none !important}
body[data-motion=off] .d-svc-card:hover,body[data-motion=off] .d-plan:hover,body[data-motion=off] .lb-open:hover img{transform:none}
@media (prefers-reduced-motion:reduce){.card,.btn,.link-arrow .ic,.cz-track{transition:none !important;scroll-behavior:auto !important}.d-svc-card:hover,.d-plan:hover,.d-svc-card:focus-within,.d-plan:focus-within{transform:none}}

/* intro */
.d-intro-lead{font-family:var(--font-heading);font-weight:var(--hw);font-size:var(--fs-2xl);line-height:1.25;letter-spacing:var(--h-track);max-width:30ch}
.d-intro-facts{list-style:none;padding:0;margin:var(--sp-6) 0 0;display:flex;flex-wrap:wrap;gap:10px 28px;font-size:var(--fs-sm);font-weight:600}
.d-intro-facts li{display:inline-flex;gap:8px;align-items:center}.d-intro-facts .ic{color:var(--brand-text)}
.d-intro-grid{display:grid;gap:var(--sp-6)}
@media (min-width:${DESK}px){.d-intro-grid{grid-template-columns:minmax(0,1fr) minmax(0,1.6fr)}.d-intro-lead{font-size:var(--fs-3xl)}}

/* prices */
.d-price{display:inline-block;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ink)}
.d-price.is-quote{font-weight:600;color:var(--ink-muted);font-size:var(--fs-sm)}
.d-sample{display:flex;gap:8px;align-items:center;margin-top:var(--sp-5);font-size:var(--fs-xs);color:var(--ink-muted)}
.d-prices{list-style:none;padding:0;margin:0;display:grid;column-gap:calc(var(--gutter) * 2)}
.d-prices li{display:grid;grid-template-columns:auto 1fr auto;align-items:baseline;gap:4px 12px;padding:16px 0;border-bottom:1px solid rgba(0,0,0,.12)}
.d-prices li>p{grid-column:1 / -1;margin:0}
.d-pl-name{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}
.d-pl-name h3{font-size:var(--fs-lg)}
.d-dur{display:inline-flex;gap:5px;align-items:center;font-size:var(--fs-xs);color:var(--ink-muted)}
.d-pl-dots{border-bottom:1px dotted rgba(0,0,0,.3);transform:translateY(-4px);min-width:16px}
@media (min-width:${DESK}px){.d-prices{grid-template-columns:1fr 1fr}}
.d-plans{display:grid;gap:var(--gutter);grid-template-columns:1fr}
.d-plan{display:grid;gap:12px;align-content:start}
.d-plan.is-focus{border:2px solid var(--brand-text)}
.d-plan h3{font-size:var(--fs-xl)}
.d-plan-price{font-family:var(--font-heading);font-weight:var(--hw);font-size:var(--fs-2xl);line-height:1.1}
.d-plan-price.is-quote{font-size:var(--fs-lg);color:var(--ink-muted)}
.d-plan .btn{margin-top:var(--sp-3);justify-self:start}
@media (min-width:640px){.d-plans{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:${DESK}px){.d-plans{grid-template-columns:repeat(min(var(--n),4),minmax(0,1fr))}}
.d-index-lg li{font-size:var(--fs-xl);font-family:var(--font-heading)}
.d-index li .d-ix-name{flex:1}
.d-focus-price{margin-top:var(--sp-4)}

/* gallery: masonry */
.d-masonry{columns:2 160px;column-gap:var(--gutter)}
.d-masonry figure{break-inside:avoid;margin:0 0 var(--gutter)}
.d-masonry img{width:100%;height:auto;display:block}
@media (min-width:${DESK}px){.d-masonry{columns:3}}
.d-proj figure{overflow:hidden;border-radius:var(--r-md)}

/* carousel hero (without JS: a row that scrolls sideways) */
.cz{position:relative}
.cz-track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;border-radius:var(--r-lg)}
.cz-track::-webkit-scrollbar{display:none}
.cz-slide{flex:0 0 100%;scroll-snap-align:start;position:relative}
.cz-slide img{width:100%;height:auto;display:block;aspect-ratio:16/9;object-fit:cover}
.cz-ctl{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:12px}
.cz-btn{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:999px;border:1px solid rgba(0,0,0,.18);background:var(--surface);color:var(--ink);cursor:pointer}
.cz-btn:hover{background:var(--surface-alt)}
.cz-dots{display:flex;gap:4px}
.cz-dot{width:28px;height:44px;border:0;background:none;cursor:pointer;position:relative;padding:0}
.cz-dot::after{content:"";position:absolute;left:50%;top:50%;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:999px;background:rgba(0,0,0,.25)}
.cz-dot[aria-current=true]::after{background:var(--brand);width:22px;margin-left:-11px}
.dh-carousel{padding-block:calc(var(--section-y) * .7) var(--section-y)}
@media (min-width:${DESK}px){.dh-carousel .dh-grid{grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr)}}
.d-credit{position:absolute;right:10px;bottom:10px;z-index:2;background:rgba(0,0,0,.6);color:#fff;font-size:11px;line-height:1.3;padding:3px 7px;border-radius:4px}
/* hero photo credits sit top-right: the Roger widget covers the bottom-right corner of the first screen */
.dh .d-credit{top:10px;bottom:auto}
.d-note{display:flex;gap:8px;align-items:flex-start;font-size:var(--fs-sm);color:var(--ink-muted);max-width:46ch}
.d-note .ic{flex:none;margin-top:2px}
.d-lead{font-size:var(--fs-lg);color:var(--ink-muted);max-width:56ch}
.d-tag{display:inline-block;font-family:var(--font-body);font-size:var(--fs-xs);font-weight:700;letter-spacing:.06em;text-transform:uppercase;line-height:1;padding:6px 10px;border-radius:999px;background:var(--brand);color:var(--brand-ink);vertical-align:middle}
.d-narrow{max-width:760px}

/* hero */
.dh{position:relative}
.dh h1{max-width:16ch}
.dh .sub{font-size:var(--fs-lg);color:var(--ink-muted);max-width:52ch}
.dh-text>*+*{margin-top:var(--sp-5)}
.dh .dh-ctas{margin-top:var(--sp-6)}
.dh .trust-row{margin-top:var(--sp-5)}
.dh-grid{display:grid;gap:var(--sp-7);align-items:center}
.dh-media{position:relative;z-index:0}
.dh-bg{position:relative}
.dh-media img,.dh-bg img{width:100%;height:auto;display:block}
.dh-split{padding-block:calc(var(--section-y) * .75) var(--section-y)}
.dh-photo .dh-in{padding-block:var(--sp-7)}
.dh-type{padding-block:calc(var(--section-y) * 1.05)}
.dh-label{font-size:var(--fs-sm);font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px}
.dh-phone{display:inline-flex;gap:12px;align-items:center;font-family:var(--font-heading);font-weight:var(--hw);font-size:var(--fs-2xl);line-height:1.05;color:inherit;text-decoration:none;overflow-wrap:anywhere}
.dh-hours{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:6px;font-size:var(--fs-sm)}
.dh-hours li{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid rgba(127,127,127,.25);padding-bottom:6px}
.dh-facts{margin:0;display:grid;gap:14px}
.dh-facts div{display:grid;gap:2px;border-top:1px solid rgba(0,0,0,.12);padding-top:12px}
.dh-facts dt{font-size:var(--fs-xs);font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-muted)}
.dh-facts dd{margin:0;font-size:var(--fs-lg);font-weight:600}
/* phones: keep both calls to action on one row and above the Roger widget dock */
@media (max-width:${DESK - 1}px){
  .dh-text>*+*{margin-top:var(--sp-4)}
  .dh .dh-ctas{margin-top:var(--sp-5);flex-wrap:nowrap;gap:10px}
  .dh .dh-ctas .btn{flex:1 1 0;min-width:0;padding-inline:12px;font-size:var(--fs-sm);white-space:normal;text-align:center}
  .dh .dh-ctas .btn .ic{width:18px;height:18px}
  .dh .dh-ctas .cw{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .dh-split{padding-block:var(--sp-6) var(--section-y)}
  .dh-type{padding-block:var(--sp-7) var(--section-y)}
  .dh-photo .dh-in{padding-block:var(--sp-6)}
}
@media (min-width:${DESK}px){
  .dh-split .dh-grid{grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr)}
  .dh-type .dh-grid{grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);align-items:end}
  .dh-photo{display:flex;align-items:flex-end;min-height:min(86vh,820px)}
  .dh-photo .dh-bg{position:absolute;inset:0}
  .dh-photo .dh-bg img{height:100%;object-fit:cover}
  .dh-photo .dh-bg::after{content:"";position:absolute;inset:0;background:var(--overlay)}
  .dh-photo .dh-in{position:relative;z-index:1;color:#fff;padding-block:var(--section-y)}
  .dh-photo .sub,.dh-photo .eyebrow,.dh-photo .d-note{color:rgba(255,255,255,.92)}
  .dh-photo .btn-secondary{color:#fff;border-color:rgba(255,255,255,.85)}
  .dh-photo .btn-secondary:hover{background:rgba(255,255,255,.12)}
}

/* services */
.d-svc-grid{display:grid;gap:var(--gutter);grid-template-columns:1fr}
.d-svc-card,.d-feat{display:grid;gap:12px;align-content:start}
.d-feat .d-tag{justify-self:start}
.d-feat h3{font-size:var(--fs-xl)}
.d-feat-wide{margin-bottom:var(--gutter)}
.d-feat-body{display:grid;gap:8px;justify-items:start}
@media (min-width:640px){.d-svc-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:${DESK}px){
  .d-svc-grid{grid-template-columns:repeat(var(--n,3),minmax(0,1fr))}
  .d-feat-wide{grid-template-columns:auto minmax(0,1fr) auto;align-items:center;column-gap:var(--sp-6);padding:calc(var(--pad) * 1.25)}
}
.d-feat-row{display:grid;gap:var(--gutter)}
@media (min-width:${DESK}px){.d-feat-row{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);align-items:start}}
.d-dense{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:1fr;column-gap:var(--gutter);border-top:3px solid var(--ink)}
.d-dense li{display:grid;grid-template-columns:48px 1fr;gap:14px;padding:18px 0;border-bottom:1px solid rgba(0,0,0,.14)}
.d-dense h3{font-size:var(--fs-xl);display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
@media (min-width:${DESK}px){.d-dense{grid-template-columns:1fr 1fr}}

/* focus (premium) */
.d-focus-grid{display:grid;gap:var(--sp-7)}
.d-focus h2{font-size:var(--fs-3xl)}
.d-focus .d-lead{margin-top:var(--sp-5)}
.d-focus .link-arrow{margin-top:var(--sp-5)}
.d-index-h{font-family:var(--font-body);font-size:var(--fs-sm);font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:10px}
.d-index{list-style:none;padding:0;margin:0;border-top:1px solid rgba(0,0,0,.18)}
.d-index li{display:flex;gap:18px;align-items:baseline;padding:14px 0;border-bottom:1px solid rgba(0,0,0,.18);font-size:var(--fs-lg)}
.d-index .n{color:var(--brand-text);font-variant-numeric:tabular-nums;font-size:var(--fs-sm)}
@media (min-width:${DESK}px){.d-focus-grid{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);align-items:end}.d-focus-grid.single{grid-template-columns:minmax(0,1fr)}}

/* team */
.d-team-grid,.d-team-row{display:grid;gap:var(--sp-7);align-items:center}
.d-team-img{position:relative}
.d-team-img img{width:100%;height:auto;display:block}
@media (min-width:${DESK}px){.d-team-grid{grid-template-columns:1fr 1fr}.d-team-row{grid-template-columns:minmax(0,380px) 1fr}}

/* projects */
.d-proj .gal figure{position:relative}
.d-large{display:grid;gap:var(--gutter);grid-template-columns:1fr}
.d-large img{aspect-ratio:4/3}
@media (min-width:${DESK}px){.d-large{grid-template-columns:2fr 1fr}.d-large .lead{grid-row:span 2}.d-large .lead img{aspect-ratio:auto;height:100%}.d-large figure:nth-child(n+4){display:none}}

/* process (premium) */
.d-steps{list-style:none;padding:0;margin:0;display:grid;gap:var(--sp-6)}
.d-steps li{border-top:1px solid var(--ink);padding-top:var(--sp-5);display:grid;gap:8px;align-content:start}
.d-steps .n{font-family:var(--font-heading);font-size:var(--fs-2xl);line-height:1;color:var(--brand-text)}
@media (min-width:${DESK}px){.d-steps{grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--gutter)}}

/* proof */
.d-quotes{margin-top:var(--sp-6)}
.d-stat-band{background:var(--band);color:#fff}
.d-stat-band .stat .v{color:#fff}
.d-stat-band .stat .l,.d-stat-band .attrib{color:rgba(255,255,255,.78)}
.d-stat-band .quote-card{color:var(--ink)}
.d-stat-band .chip{background:rgba(255,255,255,.12);color:#fff}.d-stat-band .chip .ic{color:#fff}
.d-pull blockquote{font-family:var(--font-heading);font-size:var(--fs-2xl);line-height:1.25}
.d-pull figcaption{margin-top:var(--sp-5);color:var(--ink-muted);font-size:var(--fs-sm)}
.d-meta{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:var(--sp-6);font-size:var(--fs-sm);color:var(--ink-muted)}
.d-meta span{display:inline-flex;gap:6px;align-items:center}

/* area + quote */
.d-area-cols,.d-quote-grid{display:grid;gap:var(--sp-7);align-items:start}
@media (min-width:${DESK}px){.d-area-cols,.d-quote-grid{grid-template-columns:1fr 1fr}}
.d-quote .steps{margin-top:var(--sp-6)}
.d-quote-inline .form{max-width:820px}
.d-quote-consult .form{margin-top:var(--sp-6)}

/* bold: contact band + emergency band */
.d-band{background:var(--brand);color:var(--brand-ink);padding-block:var(--sp-6)}
.d-band-in{display:flex;flex-wrap:wrap;gap:16px 32px;align-items:center;justify-content:space-between}
.d-band-h{font-size:var(--fs-lg);letter-spacing:.04em}
.d-band-phone{display:inline-flex;gap:12px;align-items:center;margin-top:6px;font-family:var(--font-heading);font-weight:var(--hw);font-size:var(--fs-3xl);line-height:1;color:inherit;text-decoration:none}
.d-band-sub{margin-top:8px;font-size:var(--fs-sm);opacity:.92}
.d-urgent{background:var(--band);color:#fff;padding-block:var(--sp-5)}
.d-urgent .in{display:flex;flex-wrap:wrap;gap:14px 24px;align-items:center;justify-content:space-between}
.d-urgent p{display:flex;gap:12px;align-items:center;font-family:var(--font-heading);font-weight:var(--hw);font-size:var(--fs-xl);text-transform:var(--d-case,none);max-width:none}
.d-band :focus-visible,.d-urgent :focus-visible,.d-stat-band :focus-visible,body[data-direction=bold-direct] .dh-type :focus-visible{outline-color:#fff}

/* ── Local & trusted: warm surfaces, rounded photo, soft cards ── */
body[data-direction=local-trusted] .site-header{border-bottom:1px solid rgba(43,37,33,.09)}
body[data-direction=local-trusted] .dh-split,body[data-direction=local-trusted] .dh-type{background:linear-gradient(180deg,var(--surface) 0%,var(--surface-alt) 100%)}
body[data-direction=local-trusted] .dh-media img{border-radius:28px}
body[data-direction=local-trusted] .dh-media::before{content:"";position:absolute;right:-14px;bottom:-14px;width:62%;height:62%;background:var(--tint-2);border-radius:28px;z-index:-1}
body[data-direction=local-trusted] .dh-aside{background:var(--surface);border-radius:var(--r-lg);padding:var(--pad);box-shadow:var(--shadow)}
body[data-direction=local-trusted] .d-feat{background:var(--tint-1)}
body[data-direction=local-trusted] .d-team-img img{border-radius:28px}
body[data-direction=local-trusted] .site-footer{background:var(--band)}

/* ── Bold & direct: dark bands, square edges, compact type, contact up front ── */
body[data-direction=bold-direct]{--d-case:uppercase}
body[data-direction=bold-direct] .site-header{border-bottom:3px solid var(--ink)}
body[data-direction=bold-direct] .dh-type{background:var(--band);color:#fff}
body[data-direction=bold-direct] .dh-type .sub,body[data-direction=bold-direct] .dh-type .eyebrow,body[data-direction=bold-direct] .dh-type .d-note{color:rgba(255,255,255,.88)}
body[data-direction=bold-direct] .dh-type .btn-secondary{color:#fff;border-color:#fff}
body[data-direction=bold-direct] .dh-type .dh-label,body[data-direction=bold-direct] .dh-type .dh-hours{color:#fff}
body[data-direction=bold-direct] .dh-photo .dh-in{background:var(--band);color:#fff}
body[data-direction=bold-direct] .dh-photo .sub,body[data-direction=bold-direct] .dh-photo .eyebrow,body[data-direction=bold-direct] .dh-photo .d-note{color:rgba(255,255,255,.9)}
body[data-direction=bold-direct] .dh-photo .btn-secondary{color:#fff;border-color:#fff}
body[data-direction=bold-direct] .dh h1{max-width:18ch}
body[data-direction=bold-direct] .eyebrow{letter-spacing:.12em}
body[data-direction=bold-direct] .site-footer{background:var(--band)}
body[data-direction=bold-direct] .card{border:2px solid var(--ink);box-shadow:none}
@media (min-width:${DESK}px){body[data-direction=bold-direct] .dh-photo .dh-in{background:none}body[data-direction=bold-direct] .dh-photo h1{max-width:14ch}}

/* ── Modern & premium: whitespace, hairlines, editorial headings, large photography ── */
body[data-direction=modern-premium] .site-header{border-bottom:1px solid rgba(0,0,0,.08)}
body[data-direction=modern-premium] .dh h1{max-width:13ch}
body[data-direction=modern-premium] .dh-type{padding-block:calc(var(--section-y) * 1.15) var(--section-y)}
body[data-direction=modern-premium] .dh-type h1{font-size:calc(var(--fs-4xl) * 1.08)}
body[data-direction=modern-premium] .dh-aside{border-left:1px solid rgba(0,0,0,.16);padding-left:var(--gutter)}
body[data-direction=modern-premium] .eyebrow{color:var(--ink-muted);letter-spacing:.14em;font-weight:500}
body[data-direction=modern-premium] .btn-secondary{border-width:1px}
body[data-direction=modern-premium] .section.alt{background:var(--surface-alt)}
body[data-direction=modern-premium] .card{box-shadow:none;border:1px solid rgba(0,0,0,.12)}
body[data-direction=modern-premium] .site-footer{background:var(--surface-alt);color:var(--ink-muted)}
body[data-direction=modern-premium] .site-footer a,body[data-direction=modern-premium] .site-footer h3,body[data-direction=modern-premium] .site-footer .wordmark{color:var(--ink)}
body[data-direction=modern-premium] .f-bottom{border-top-color:rgba(0,0,0,.12)}
@media (min-width:${DESK}px){body[data-direction=modern-premium] .dh-split .dh-grid{grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr)}}
/* premium phones: the headline sits on the lower part of the photo, so the buttons stay on the first screen */
@media (max-width:${DESK - 1}px){
  body[data-direction=modern-premium] .dh-photo{display:grid;min-height:min(74vh,620px)}
  body[data-direction=modern-premium] .dh-photo>.dh-bg,body[data-direction=modern-premium] .dh-photo>.dh-in{grid-area:1/1}
  body[data-direction=modern-premium] .dh-photo .dh-bg img{height:100%;object-fit:cover}
  body[data-direction=modern-premium] .dh-photo .dh-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(15,15,14,.92) 0%,rgba(15,15,14,.72) 42%,rgba(15,15,14,.12) 72%,rgba(15,15,14,0) 100%)}
  body[data-direction=modern-premium] .dh-photo .dh-in{align-self:end;position:relative;z-index:1;color:#fff;padding-block:var(--sp-6)}
  body[data-direction=modern-premium] .dh-photo .sub,body[data-direction=modern-premium] .dh-photo .eyebrow,body[data-direction=modern-premium] .dh-photo .d-note{color:rgba(255,255,255,.9)}
  body[data-direction=modern-premium] .dh-photo .btn-secondary{color:#fff;border-color:rgba(255,255,255,.85)}
  body[data-direction=modern-premium] .dh-photo .sub{font-size:var(--fs-md)}
}

/* ── Clean professional: white and cool greys, crisp cards, balanced sans ── */
body[data-direction=clean-professional] .site-header{border-bottom:1px solid #EAECF0}
body[data-direction=clean-professional] .dh-split,body[data-direction=clean-professional] .dh-type,body[data-direction=clean-professional] .dh-carousel{background:linear-gradient(180deg,#fff 0%,var(--surface-alt) 100%)}
body[data-direction=clean-professional] .dh-media img,body[data-direction=clean-professional] .cz-track{border-radius:var(--r-lg)}
body[data-direction=clean-professional] .dh-split .dh-media img{box-shadow:0 24px 48px -24px rgba(16,24,40,.35)}
body[data-direction=clean-professional] .card{border:1px solid #EAECF0;box-shadow:var(--shadow)}
body[data-direction=clean-professional] .dh-aside{background:#fff;border:1px solid #EAECF0;border-radius:var(--r-lg);padding:var(--pad);box-shadow:var(--shadow)}
body[data-direction=clean-professional] .site-footer{background:#0C111D}
body[data-direction=clean-professional] .d-intro{border-bottom:1px solid #EAECF0}
`;
}
