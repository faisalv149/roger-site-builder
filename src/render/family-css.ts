/**
 * Styles for the version 2 page families (src/render/families.ts). Each family is scoped by body[data-family] and
 * built on the direction tokens it was assigned (src/design/directions.ts) plus the owner's appearance variables
 * (--btn-bg, --btn-r, --tk, --density...). Shared f-* pieces (menu, steps, team, crumbs) come first.
 */
const DESK = 900;
const FE = 'body[data-family=editorial-showcase]';
const FW = 'body[data-family=warm-local]';
const FB = 'body[data-family=bold-practical]';

export function familyCss(): string {
  return `
/* ── shared ── */
body[data-family]{background:var(--surface)}
body[data-family] h1,body[data-family] h2,body[data-family] h3{text-wrap:balance}
body[data-family] p{text-wrap:pretty}
body[data-family] section{scroll-margin-top:80px}
.f-menu{display:none;position:relative}
.f-menu summary{list-style:none;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 12px;border-radius:999px;border:1px solid currentColor;cursor:pointer;font-weight:600;font-size:var(--fs-sm)}
.f-menu summary::-webkit-details-marker{display:none}
.f-menu-nav{position:absolute;right:0;top:calc(100% + 8px);z-index:50;display:grid;min-width:220px;padding:8px;background:var(--surface);color:var(--ink);border-radius:var(--r-md);box-shadow:0 18px 40px -16px rgba(0,0,0,.35);border:1px solid rgba(0,0,0,.08)}
.f-menu-nav a{padding:12px 14px;border-radius:8px;text-decoration:none;color:var(--ink);font-weight:600}
.f-menu-nav a:hover,.f-menu-nav a:focus-visible{background:var(--surface-alt)}
@media (max-width:${DESK - 1}px){.f-menu{display:block}}
.f-more{display:inline-flex;align-items:center;gap:6px;min-height:44px;font-weight:700;text-decoration:none;color:var(--brand-text)}
.f-more:hover{text-decoration:underline}
.f-note{font-size:var(--fs-sm);color:var(--ink-muted);margin:var(--sp-3) 0 0;line-height:1.5}
.f-visit-act{margin:var(--sp-4) 0 var(--sp-5)}
.f-visit-act .btn-row{display:flex;flex-wrap:wrap;gap:var(--sp-3)}
a.f-book{text-decoration:none;font-weight:700;color:var(--brand-text);white-space:nowrap}
a.f-book:hover,a.f-book:focus-visible{text-decoration:underline}
.f-videos{padding-block:var(--section-y)}
.f-videos h2{margin:0 0 var(--sp-5)}
.f-video-grid{display:grid;gap:var(--sp-5);grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))}
.f-video h3{font-size:var(--fs-md);margin:var(--sp-3) 0 0}
.f-video-frame{position:relative;aspect-ratio:16/9;background:var(--surface-alt);border-radius:var(--radius-md,12px);overflow:hidden}
.f-video-frame img,.f-video-frame video,.f-video-frame iframe{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border:0;background:#000}
.f-video-play{position:absolute;inset:0;margin:auto;width:64px;height:64px;border-radius:50%;border:0;background:var(--brand);color:var(--brand-ink);display:grid;place-items:center;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)}
.f-video-play:hover,.f-video-play:focus-visible{outline:3px solid var(--brand-text);outline-offset:3px}
.f-video-fail{position:absolute;inset:auto 0 0 0;margin:0;padding:var(--sp-3) var(--sp-4);background:rgba(0,0,0,.78);color:#fff;font-size:var(--fs-sm)}
.f-video-fail a{color:#fff;text-decoration:underline}
.f-video-note{margin-top:var(--sp-4)}
.f-svc-link{display:inline-flex;align-items:center;gap:6px;min-height:44px;margin-top:auto;font-weight:700;color:var(--heading,var(--ink));text-decoration:underline;text-underline-offset:3px;align-self:flex-start}
.f-svc-link:hover{color:var(--brand-text,var(--heading))}
.f-svc-also{margin-top:var(--sp-6)}
.f-svc-also h3{font-size:var(--fs-lg);margin:0 0 var(--sp-3)}
.f-svc-also ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:12px}
.f-svc-also li{border-radius:999px;background:var(--surface-alt);font-weight:600}
.f-svc-also li a{display:block;padding:10px 16px;color:var(--heading,var(--ink));text-decoration:none;min-height:44px;line-height:24px}
.f-svc-also li a:hover{text-decoration:underline}
/* touch targets: the logo link and a phone number in the footer are at least 44px tall */
:is(.fe-logo,.fw-logo,.fb-logo){display:inline-flex;align-items:center;min-height:44px}
:is(.fe-foot,.fw-foot,.fb-foot) a[href^="tel:"]{display:inline-flex;align-items:center;min-height:44px}
.credit{opacity:.85}
.f-svc-also li span{font-weight:400;color:var(--ink-muted);margin-left:6px}
/* image-led service cards */
.f-svc{padding-block:var(--section-y)}
.f-svc-head{display:flex;justify-content:space-between;align-items:flex-end;gap:var(--sp-4);margin-bottom:var(--sp-6)}
.f-svc-head h2{margin:0}
.f-svc-grid{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;justify-content:center;gap:24px}
.f-svc-card{flex:0 1 calc((100% - 48px)/3);min-width:0;display:flex;flex-direction:column;background:#fff;color:var(--ink);border-radius:20px;overflow:hidden;border:1px solid rgba(15,23,42,.08);box-shadow:0 1px 2px rgba(15,23,42,.06),0 10px 28px -14px rgba(15,23,42,.22);transition:transform .2s ease,box-shadow .2s ease}
.f-svc-card:hover,.f-svc-card:focus-within{transform:translateY(-2px);box-shadow:0 2px 4px rgba(15,23,42,.08),0 16px 34px -14px rgba(15,23,42,.3)}
.f-svc-media{aspect-ratio:16/10;background:var(--surface-alt);display:grid;place-items:center;overflow:hidden}
.f-svc-media img{display:block;width:100%;height:100%;object-fit:cover}
.f-svc-media.is-icon{color:var(--heading,var(--brand-text))}
.f-svc-body{display:flex;flex-direction:column;gap:var(--sp-3);padding:24px;flex:1}
.f-svc-body h3{margin:0;font-size:var(--fs-xl);line-height:1.2;color:var(--heading,var(--ink))}
.f-svc-body h3 a{color:inherit;text-decoration:none}
.f-svc-body h3 a:hover,.f-svc-body h3 a:focus-visible{text-decoration:underline}
.f-svc-body p{text-wrap:pretty;margin:0;max-width:none;line-height:1.55}
.f-svc-note,.f-svc-price{font-size:var(--fs-sm);color:var(--ink-muted)}
.f-svc-btn{margin-top:auto;align-self:flex-start}
@media (max-width:899px){.f-svc-card{flex-basis:calc((100% - 24px)/2)}}
@media (max-width:599px){.f-svc-card{flex-basis:100%}.f-svc-head{flex-direction:column;align-items:flex-start}}
@media (prefers-reduced-motion:reduce){.f-svc-card{transition:none}.f-svc-card:hover,.f-svc-card:focus-within{transform:none}}
.f-sample{display:flex;gap:8px;align-items:center;margin-top:var(--sp-5);font-size:var(--fs-xs);color:var(--ink-muted)}
.f-price{font-weight:700;font-variant-numeric:tabular-nums}.f-price.is-quote{font-weight:600;color:var(--ink-muted)}
.f-crumbs ol{list-style:none;display:flex;flex-wrap:wrap;gap:6px;padding:0;margin:0 0 var(--sp-4);font-size:var(--fs-sm)}
.f-crumbs li+li::before{content:"/";margin-right:6px;opacity:.6}
.f-crumbs a{color:inherit}
.f-facts{display:grid;gap:12px;margin:var(--sp-5) 0}
.f-facts div{display:grid;gap:2px;border-top:1px solid rgba(127,127,127,.3);padding-top:10px}
.f-facts dt{font-size:var(--fs-xs);font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-muted)}
.f-facts dd{margin:0;font-size:var(--fs-lg);font-weight:600}
.f-checks{list-style:none;padding:0;margin:var(--sp-5) 0 0;display:grid;gap:8px}
.f-checks li{display:flex;gap:8px;align-items:center;font-weight:600}
.f-checks .ic{color:var(--brand-text)}
.f-team{padding-block:var(--section-y)}
.f-team-grid{display:grid;gap:var(--sp-7);align-items:center}
.f-team-img{margin:0;position:relative}.f-team-img img{width:100%;height:auto;display:block}
.f-team-text p{font-size:var(--fs-lg);color:var(--ink-muted);max-width:52ch}
@media (min-width:${DESK}px){.f-team-grid{grid-template-columns:1fr 1fr}}
.f-process{padding-block:var(--section-y)}
.f-steps{list-style:none;padding:0;margin:var(--sp-6) 0 0;display:grid;gap:var(--sp-6)}
.f-steps h3{font-size:var(--fs-xl);margin:6px 0}
.f-steps p{color:var(--ink-muted)}
.f-step-n{font-family:var(--font-heading);font-size:var(--fs-2xl);color:var(--brand-text);line-height:1}
@media (min-width:${DESK}px){.f-steps{grid-template-columns:repeat(3,minmax(0,1fr))}}
.f-urgent{background:var(--band);color:#fff;padding-block:var(--sp-4)}
.f-urgent-in{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center;justify-content:space-between}
.f-urgent .btn-light,.f-urgent .btn-light span{color:#14161a}
.f-urgent p{display:flex;gap:10px;align-items:center;font-weight:700;margin:0}
.f-detail{padding-block:var(--section-y)}
.f-detail-grid{display:grid;gap:var(--sp-7)}
.f-detail-text{font-size:var(--fs-xl);line-height:1.5;max-width:60ch}
.f-related h2{font-size:var(--fs-lg)}
.f-related ul{list-style:none;padding:0;margin:var(--sp-4) 0;display:grid;gap:0}
.f-related li{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid rgba(127,127,127,.25)}
.f-related a{font-weight:600}
@media (min-width:${DESK}px){.f-detail-grid{grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)}}
.f-404{padding-block:var(--section-y)}
.gal figure{margin:0}
.lb-open img{width:100%;height:100%;object-fit:cover;display:block}

/* ══════════ Editorial Showcase: restrained nav, asymmetric hero, hairlines, numbered offerings, big gallery ══════════ */
${FE}{--fe-rule:rgba(20,20,18,.14)}
${FE} .fe-head{border-bottom:1px solid var(--fe-rule);background:var(--surface)}
${FE} .fe-head-in{display:flex;align-items:center;gap:var(--sp-6);min-height:76px}
${FE} .fe-logo{text-decoration:none;color:var(--ink);margin-right:auto}
${FE} .fe-word{font-family:var(--font-heading);font-size:var(--fs-xl);font-weight:var(--hw);letter-spacing:-.01em}
${FE} .fe-logo-img{max-height:44px;width:auto;max-width:100%;object-fit:contain}
${FE} .fe-nav{display:flex;gap:var(--sp-6)}
${FE} .fe-nav a{color:var(--ink);text-decoration:none;font-size:var(--fs-sm);letter-spacing:.04em}
${FE} .fe-nav a:hover,${FE} .fe-nav a[aria-current]{text-decoration:underline;text-underline-offset:6px}
${FE} .fe-head-cta{display:inline-flex;align-items:center;gap:6px;color:var(--ink);font-weight:600;font-size:var(--fs-sm);text-decoration:none;border-bottom:1.5px solid var(--ink);padding:10px 0 4px;min-height:44px}
@media (max-width:${DESK - 1}px){${FE} .fe-nav,${FE} .fe-head-cta{display:none}${FE} .fe-head-in{min-height:64px}}
${FE} .fe-kicker,${FE} .fe-label{font-size:var(--fs-xs);font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-muted);margin:0}
${FE} h2.fe-label{font-family:var(--font-body)}
${FE} .fe-hero{padding-block:calc(var(--section-y) * .7) var(--section-y)}
${FE} .fe-hero h1{font-size:clamp(calc(40px * var(--tk,1)),6.2vw,calc(88px * var(--tk,1)));line-height:1.02;letter-spacing:-.02em;margin:var(--sp-4) 0;max-width:14ch}
${FE} .fe-lede{font-size:var(--fs-lg);color:var(--ink-muted);max-width:46ch;line-height:1.55}
${FE} .fe-actions{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;margin-top:var(--sp-6)}
${FE} .fe-textlink{color:var(--ink);font-weight:600;text-underline-offset:5px;min-height:44px;display:inline-flex;align-items:center}
${FE} .fe-hero-grid{display:grid;gap:var(--sp-7);align-items:start}
${FE} .fe-hero-img{margin:0;position:relative}
${FE} .fe-hero-img img{width:100%;height:auto;display:block}
@media (min-width:${DESK}px){
  ${FE} .fe-hero-grid{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:var(--sp-8,72px)}
  ${FE} .fe-hero-text{padding-top:var(--sp-7)}
  ${FE} .fe-hero-img{margin-top:var(--sp-6);margin-right:calc(var(--margin) * -1)}
}
${FE} .fe-facts{list-style:none;display:flex;flex-wrap:wrap;gap:0;padding:0;margin:var(--sp-7) 0 0;border-top:1px solid var(--fe-rule)}
${FE} .fe-facts li{padding:14px 24px 0 0;margin-right:24px;font-size:var(--fs-sm);color:var(--ink);font-weight:500}
${FE} .fe-facts li+li{border-left:1px solid var(--fe-rule);padding-left:24px}
@media (max-width:${DESK - 1}px){${FE} .fe-facts li+li{border-left:0;padding-left:0}${FE} .fe-facts li{flex:1 1 100%;padding-bottom:10px;border-bottom:1px solid var(--fe-rule);margin:0}}
${FE} .fe-hero-full{padding-top:0}
${FE} .fe-hero-bleed{margin:0;position:relative}
${FE} .fe-hero-bleed img{width:100%;height:auto;display:block;max-height:78vh;object-fit:cover}
/* phones: a short photo so the headline and the main action are on the first screen */
@media (max-width:${DESK - 1}px){${FE} .fe-hero-bleed img{aspect-ratio:16/9;max-height:34vh}${FE} .fe-hero-img img{aspect-ratio:4/3;object-fit:cover;max-height:46vh}${FE} .fe-hero{padding-top:var(--sp-5)}${FE} .fe-hero h1{margin:var(--sp-3) 0}${FE} .fe-actions{margin-top:var(--sp-4)}}
${FE} .fe-hero-panel{position:relative;background:var(--surface);padding:var(--sp-6) 0 0}
@media (min-width:${DESK}px){${FE} .fe-hero-panel{margin-top:-160px;max-width:760px;padding:var(--sp-7) var(--sp-7) 0 0}}
@media (max-width:${DESK - 1}px){${FE} .fe-hero-panel{padding-top:var(--sp-4)}}
@media (max-width:${DESK - 1}px){${FE} .fe-word{font-size:clamp(19px,5.4vw,24px);line-height:1.15}${FE} .fe-lede{font-size:1.0625rem;line-height:1.5}${FE} .fe-hero h1{font-size:clamp(calc(34px * var(--tk,1)),9vw,calc(48px * var(--tk,1)))}${FE} .fe-hero-bleed img{max-height:30vh}}
${FE} .fe-hero-type h1{font-size:clamp(calc(44px * var(--tk,1)),8vw,calc(112px * var(--tk,1)));max-width:16ch}
${FE} .fe-intro{padding-block:var(--section-y);border-top:1px solid var(--fe-rule)}
${FE} .fe-intro-grid{display:grid;gap:var(--sp-5)}
${FE} .fe-intro-text{font-family:var(--font-heading);font-size:clamp(calc(24px * var(--tk,1)),2.6vw,calc(38px * var(--tk,1)));line-height:1.3;max-width:28ch;margin:0}
${FE} .fe-intro-text p{margin:0 0 .7em}
${FE} .fe-intro-text p + p{font-family:var(--font-body);font-size:var(--fs-lg);line-height:1.65;max-width:56ch}
@media (min-width:${DESK}px){${FE} .fe-intro-grid{grid-template-columns:minmax(0,4fr) minmax(0,8fr)}}
${FE} .fe-offers{padding-block:var(--section-y);background:var(--surface-alt)}
${FE} .fe-offers-grid{display:grid;gap:var(--sp-6)}
${FE} .fe-sec-head h2{font-size:clamp(calc(30px * var(--tk,1)),3.6vw,calc(52px * var(--tk,1)));line-height:1.05;margin:var(--sp-3) 0 var(--sp-4)}
${FE} .fe-sec-head-row{display:grid;gap:4px;margin-bottom:var(--sp-6)}
@media (min-width:${DESK}px){${FE} .fe-offers-grid{grid-template-columns:minmax(0,4fr) minmax(0,8fr)}${FE} .fe-sec-head{position:sticky;top:24px;align-self:start}}
${FE} .fe-list{list-style:none;padding:0;margin:0;border-top:1px solid var(--fe-rule)}
${FE} .fe-list li{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:6px 16px;align-items:baseline;padding:22px 0;border-bottom:1px solid var(--fe-rule)}
${FE} .fe-num{font-variant-numeric:tabular-nums;color:var(--ink-muted);font-size:var(--fs-sm)}
${FE} .fe-li-main h3{font-size:var(--fs-xl);margin:0}
${FE} .fe-li-main h3 a{color:inherit;text-decoration:none}
${FE} .fe-li-main h3 a:hover{text-decoration:underline;text-underline-offset:5px}
${FE} .fe-li-main p{margin:6px 0 0;color:var(--ink-muted);max-width:56ch}
${FE} .fe-dur{font-size:var(--fs-sm)}
${FE} .fe-li-price{font-family:var(--font-heading);font-size:var(--fs-lg);white-space:nowrap}
${FE} .fe-li-price.is-quote{font-family:var(--font-body);font-size:var(--fs-sm);color:var(--ink-muted)}
@media (max-width:640px){${FE} .fe-list li{grid-template-columns:32px minmax(0,1fr)}${FE} .fe-li-price{grid-column:2}}
${FE} .fe-gallery{padding-block:var(--section-y)}
${FE} .fe-feature{display:grid;gap:12px;grid-template-columns:1fr 1fr}
${FE} .fe-feature figure{aspect-ratio:4/3;overflow:hidden}
${FE} .fe-feature .lead{grid-column:1/-1;aspect-ratio:16/9}
@media (min-width:${DESK}px){${FE} .fe-feature{grid-template-columns:2fr 1fr 1fr;grid-auto-rows:240px}${FE} .fe-feature figure{aspect-ratio:auto}${FE} .fe-feature .lead{grid-column:1;grid-row:span 2;aspect-ratio:auto}${FE} .fe-feature:has(figure:nth-child(3):last-child){grid-template-columns:2fr 1fr}${FE} .fe-feature.is-pair{grid-template-columns:1fr 1fr;grid-auto-rows:auto}${FE} .fe-feature.is-pair figure{aspect-ratio:4/3}${FE} .fe-feature.is-pair .lead{grid-row:auto}}
${FE} .fe-masonry{columns:2 200px;column-gap:12px}${FE} .fe-masonry figure{break-inside:avoid;margin-bottom:12px}
@media (min-width:${DESK}px){${FE} .fe-masonry{columns:3}}
${FE} .lb-open{border-radius:0}
${FE} .fe-proof{padding-block:var(--section-y);border-top:1px solid var(--fe-rule)}
${FE} .fe-pull{margin:var(--sp-6) 0}
${FE} .fe-pull blockquote{margin:0;font-family:var(--font-heading);font-size:clamp(calc(26px * var(--tk,1)),3.4vw,calc(48px * var(--tk,1)));line-height:1.18;max-width:24ch}
${FE} .fe-pull figcaption,${FE} .fe-quotes figcaption{margin-top:var(--sp-4);color:var(--ink-muted);font-size:var(--fs-sm)}
${FE} .fe-quotes{display:grid;gap:var(--sp-6);margin-top:var(--sp-6);border-top:1px solid var(--fe-rule);padding-top:var(--sp-6)}
${FE} .fe-quotes blockquote{margin:0;font-size:var(--fs-lg)}
@media (min-width:${DESK}px){${FE} .fe-quotes{grid-template-columns:1fr 1fr}}
${FE} .fe-proof-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:var(--ink-muted);font-size:var(--fs-sm);margin-top:var(--sp-6)}
${FE} .f-process{background:var(--surface-alt)}
${FE} .f-steps li{border-top:1px solid var(--ink);padding-top:var(--sp-5)}
${FE} .f-team-img img{filter:saturate(.92)}
${FE} .fe-cta{padding-block:calc(var(--section-y) * 1.1);background:var(--ink);color:#fff}
${FE} .fe-cta-grid{display:grid;gap:var(--sp-6);align-items:end}
${FE} .fe-cta h2{font-size:clamp(calc(34px * var(--tk,1)),5vw,calc(72px * var(--tk,1)));line-height:1;max-width:14ch;color:#fff}
${FE} .fe-cta p{color:rgba(255,255,255,.86)}
${FE} .fe-cta .fe-textlink{color:#fff}
${FE} .fe-cta .btn-primary{background:#fff;color:var(--ink)}
@media (min-width:${DESK}px){${FE} .fe-cta-grid{grid-template-columns:minmax(0,7fr) minmax(0,5fr)}}
${FE} .fe-contact{padding-block:var(--section-y)}
${FE} .fe-contact-grid{display:grid;gap:var(--sp-7)}
${FE} .fe-contact h2{font-size:clamp(calc(30px * var(--tk,1)),3.6vw,calc(52px * var(--tk,1)));line-height:1.05;margin:var(--sp-3) 0}
${FE} .fe-form{border-top:1px solid var(--ink);padding-top:var(--sp-5)}
@media (min-width:${DESK}px){${FE} .fe-contact-grid{grid-template-columns:minmax(0,5fr) minmax(0,7fr)}}
${FE} .fe-visit{padding-block:var(--section-y);border-top:1px solid var(--fe-rule)}
${FE} .fe-visit-grid{display:grid;gap:var(--sp-6)}
${FE} .fe-visit h2{font-size:var(--fs-2xl);margin:var(--sp-3) 0}
@media (min-width:${DESK}px){${FE} .fe-visit-grid{grid-template-columns:1fr 1fr}}
${FE} .fe-page-hero{padding-block:calc(var(--section-y) * .8) calc(var(--section-y) * .5);border-bottom:1px solid var(--fe-rule)}
${FE} .fe-page-hero h1{font-size:clamp(calc(38px * var(--tk,1)),5.4vw,calc(76px * var(--tk,1)));line-height:1.02;max-width:18ch;margin:0 0 var(--sp-4)}
${FE} .fe-foot{background:var(--surface);border-top:1px solid var(--ink);padding-block:var(--sp-7) var(--sp-5)}
${FE} .fe-foot-name{font-family:var(--font-heading);font-size:clamp(28px,4vw,56px);line-height:1;margin:0 0 var(--sp-6)}
${FE} .fe-foot-grid{display:grid;gap:var(--sp-5)}
${FE} .fe-foot h2{font-family:var(--font-body);font-size:var(--fs-xs);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-muted);margin:0 0 8px}
${FE} .fe-foot ul{list-style:none;padding:0;margin:0}
${FE} .fe-foot a{color:var(--ink)}
${FE} .fe-foot-small{font-size:var(--fs-xs);color:var(--ink-muted);margin-top:var(--sp-6)}
@media (min-width:${DESK}px){${FE} .fe-foot-grid{grid-template-columns:repeat(3,1fr)}}

/* ══════════ Warm Local: utility strip, welcome hero with framed collage, menu rows, people and proof, visit card ══════════ */
${FW} .fw-strip{background:var(--band);color:#fff;font-size:var(--fs-xs)}
${FW} .fw-strip-in{display:flex;flex-wrap:wrap;gap:6px 22px;min-height:36px;align-items:center}
${FW} .fw-strip-item{display:inline-flex;gap:6px;align-items:center}
${FW} .fw-strip a{color:#fff}
${FW} .fw-head{background:var(--surface);border-bottom:1px solid rgba(43,37,33,.08);position:sticky;top:0;z-index:30}
${FW} .fw-head-in{display:flex;align-items:center;gap:var(--sp-5);min-height:72px}
${FW} .fw-logo{margin-right:auto;text-decoration:none;color:var(--ink)}
${FW} .fw-word{font-family:var(--font-heading);font-weight:var(--hw);font-size:var(--fs-xl)}
${FW} .fw-logo-img{max-height:48px;width:auto;max-width:100%;object-fit:contain}
${FW} .fw-nav{display:flex;gap:var(--sp-5)}
${FW} .fw-nav a{color:var(--ink);text-decoration:none;font-weight:600;font-size:var(--fs-sm);padding:8px 2px}
${FW} .fw-nav a:hover,${FW} .fw-nav a[aria-current]{color:var(--brand-text);box-shadow:inset 0 -2px 0 currentColor}
${FW} .fw-head-cta{--bh:44px;font-size:var(--fs-sm);padding-inline:18px}
@media (max-width:${DESK - 1}px){${FW} .fw-nav{display:none}${FW} .fw-head-cta{display:none}${FW} .fw-head-in{min-height:62px}}
${FW} .fw-hero{padding-block:calc(var(--section-y) * .7) var(--section-y);background:linear-gradient(180deg,var(--surface) 0%,var(--surface-alt) 100%);overflow:hidden}
${FW} .fw-hero-grid{display:grid;gap:var(--sp-7);align-items:center}
${FW} .fw-badge{display:inline-flex;gap:8px;align-items:center;background:var(--surface);border-radius:999px;padding:6px 14px;font-size:var(--fs-sm);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.06);margin:0}
${FW} .fw-hero h1{font-size:clamp(calc(36px * var(--tk,1)),5vw,calc(64px * var(--tk,1)));line-height:1.08;margin:var(--sp-5) 0 var(--sp-4);max-width:16ch}
${FW} .fw-lede{font-size:var(--fs-lg);color:var(--ink-muted);max-width:48ch}
${FW} .fw-actions{margin-top:var(--sp-6)}
${FW} .fw-collage{position:relative;padding:12px 12px 48px}
${FW} .fw-frame{margin:0;background:#fff;padding:10px;border-radius:22px;box-shadow:0 24px 48px -24px rgba(43,37,33,.45);transform:rotate(-1.2deg);position:relative}
${FW} .fw-frame img{width:100%;height:auto;display:block;border-radius:14px}
${FW} .fw-polaroid{position:absolute;width:38%;left:-4%;bottom:0;margin:0;background:#fff;padding:8px 8px 22px;border-radius:6px;box-shadow:0 18px 30px -18px rgba(43,37,33,.5);transform:rotate(3deg)}
${FW} .fw-polaroid img{width:100%;height:auto;display:block;aspect-ratio:1;object-fit:cover}
${FW} .fw-card{background:var(--surface);border-radius:16px;padding:14px 18px;box-shadow:0 14px 34px -16px rgba(43,37,33,.4);display:grid;gap:8px;font-size:var(--fs-sm)}
${FW} .fw-card p{margin:0;display:grid;gap:2px}
${FW} .fw-card b{font-size:var(--fs-xs);letter-spacing:.06em;text-transform:uppercase;color:var(--brand-text)}
${FW} .fw-collage .fw-card{position:absolute;right:0;bottom:8px;max-width:62%}
@media (min-width:${DESK}px){${FW} .fw-hero-grid{grid-template-columns:minmax(0,1fr) minmax(0,1.05fr)}}
@media (max-width:${DESK - 1}px){${FW} .fw-collage{padding:4px 4px 0}${FW} .fw-polaroid{display:none}${FW} .fw-collage .fw-card{position:static;max-width:none;margin-top:var(--sp-4)}}
${FW} .fw-hero-type .fw-center{text-align:center;display:grid;justify-items:center}
${FW} .fw-hero-type .fw-lede{margin-inline:auto}
${FW} .fw-hero-type .fw-actions{justify-content:center}
${FW} .fw-cards{display:flex;justify-content:center;margin-top:var(--sp-6)}
${FW} .fw-intro{padding-block:var(--section-y)}
${FW} .fw-intro-card{max-width:860px;margin:0 auto;text-align:center}
/* a story of several sentences reads left-aligned on a phone; centring suits a line or two */
@media (max-width:${DESK - 1}px){${FW} .fw-intro-card p{text-align:left}}
${FW} .fw-intro h2{font-size:var(--fs-2xl)}
${FW} .fw-intro p{font-size:var(--fs-xl);line-height:1.55;color:var(--ink)}
${FW} .fw-chips{list-style:none;display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:var(--sp-5) 0 0}
${FW} .fw-intro .fw-chips{justify-content:center}
${FW} .fw-chips li{display:inline-flex;gap:6px;align-items:center;background:var(--tint-1);color:var(--ink);border-radius:999px;padding:7px 14px;font-size:var(--fs-sm);font-weight:600}
${FW} .fw-sec-head{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:baseline;justify-content:space-between;margin-bottom:var(--sp-6)}
${FW} .fw-sec-head h2{font-size:clamp(calc(28px * var(--tk,1)),3vw,calc(42px * var(--tk,1)));margin:0}
${FW} .fw-offers{padding-block:var(--section-y);background:var(--surface-alt)}
${FW} .fw-menu-card{background:var(--surface);border-radius:24px;padding:clamp(18px,3vw,40px);box-shadow:0 1px 2px rgba(43,37,33,.06)}
${FW} .fw-menu{list-style:none;padding:0;margin:0;display:grid;column-gap:56px}
${FW} .fw-menu li{padding:16px 0;border-bottom:1px dashed rgba(43,37,33,.2)}
${FW} .fw-row{display:flex;align-items:baseline;gap:10px}
${FW} .fw-row h3{font-size:var(--fs-lg);margin:0}
${FW} .fw-row h3 a{color:inherit}
${FW} .fw-dots{flex:1;border-bottom:2px dotted rgba(43,37,33,.28);transform:translateY(-4px);min-width:20px}
${FW} .fw-price{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}
${FW} .fw-price.is-quote{font-weight:600;color:var(--ink-muted);font-size:var(--fs-sm)}
${FW} .fw-menu p{margin:4px 0 0;color:var(--ink-muted);font-size:var(--fs-sm)}
@media (min-width:${DESK}px){${FW} .fw-menu{grid-template-columns:1fr 1fr}}
${FW} .fw-proof{padding-block:var(--section-y)}
${FW} .fw-quotes{display:grid;gap:var(--gutter)}
${FW} .fw-quote{margin:0;background:var(--tint-1);border-radius:22px;padding:24px;display:grid;gap:10px;align-content:start}
${FW} .fw-quote blockquote{margin:0;font-size:var(--fs-md);line-height:1.55}
${FW} .fw-quote figcaption{font-size:var(--fs-sm);color:var(--ink-muted);font-weight:600}
${FW} .fw-avatar{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:var(--brand);color:var(--brand-ink);font-weight:700}
@media (min-width:${DESK}px){${FW} .fw-quotes{grid-template-columns:repeat(3,minmax(0,1fr))}}
${FW} .fw-gallery{padding-block:var(--section-y);background:var(--surface-alt)}
${FW} .fw-grid{display:grid;gap:18px;grid-template-columns:1fr 1fr}
${FW} .fw-grid figure{background:#fff;padding:8px;border-radius:14px;box-shadow:0 10px 24px -16px rgba(43,37,33,.45);aspect-ratio:4/3}
${FW} .fw-grid .lb-open{border-radius:8px}
@media (min-width:${DESK}px){${FW} .fw-grid{grid-template-columns:repeat(3,1fr)}}
${FW} .f-team{background:var(--surface)}
${FW} .f-team-img img{border-radius:24px}
${FW} .f-process li{background:var(--surface-alt);border-radius:20px;padding:22px}
${FW} .fw-cta{padding-block:var(--section-y)}
${FW} .fw-cta-card{display:flex;flex-wrap:wrap;gap:var(--sp-5);align-items:center;justify-content:space-between;background:var(--tint-2);border-radius:28px;padding:clamp(22px,4vw,48px)}
${FW} .fw-cta h2{font-size:clamp(calc(26px * var(--tk,1)),3vw,calc(40px * var(--tk,1)));margin:0 0 6px}
${FW} .fw-cta p{margin:0;color:var(--ink)}
${FW} .fw-contact{padding-block:var(--section-y)}
${FW} .fw-contact-grid{display:grid;gap:var(--sp-7)}
${FW} .fw-contact h2{font-size:clamp(calc(28px * var(--tk,1)),3vw,calc(42px * var(--tk,1)))}
${FW} .fw-steps{list-style:none;padding:0;margin:var(--sp-5) 0;display:grid;gap:14px}
${FW} .fw-steps li{display:flex;gap:14px;align-items:flex-start}
${FW} .fw-steps span{flex:none;width:34px;height:34px;border-radius:50%;background:var(--tint-2);display:grid;place-items:center;font-weight:700}
${FW} .fw-steps p{margin:2px 0 0;color:var(--ink-muted);font-size:var(--fs-sm)}
${FW} .fw-form-card{background:var(--surface);border-radius:24px;padding:clamp(18px,3vw,32px);box-shadow:0 18px 40px -24px rgba(43,37,33,.45)}
@media (min-width:${DESK}px){${FW} .fw-contact-grid{grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);align-items:start}}
${FW} .fw-visit{padding-block:var(--section-y);background:var(--surface-alt)}
${FW} .fw-visit-grid{display:grid;gap:var(--gutter)}
${FW} .fw-visit-card{background:var(--surface);border-radius:24px;padding:clamp(18px,3vw,32px);display:grid;gap:var(--sp-4);align-content:start}
${FW} .fw-visit h2{font-size:var(--fs-2xl);margin:0}
/* a photo's credit sits on its top-left corner, clear of the cards stacked over the bottom of the hero picture */
${FW} .fw-hero .d-credit{top:10px;bottom:auto;right:auto;left:10px}
/* a visit card with no map beside it is centred, not left alone in an empty row */
${FW} .fw-visit-grid.is-single{justify-content:center}
${FW} .fw-addr{display:flex;gap:10px;margin:0}
${FW} .fw-map iframe,${FW} .fw-map img{border-radius:24px}
@media (min-width:${DESK}px){${FW} .fw-visit-grid{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)}${FW} .fw-visit-grid.is-single{grid-template-columns:minmax(0,760px)}}
${FW} .fw-page-hero{padding-block:calc(var(--section-y) * .7);background:var(--tint-1);border-radius:0 0 40px 40px}
${FW} .fw-page-hero h1{font-size:clamp(calc(34px * var(--tk,1)),4.4vw,calc(56px * var(--tk,1)));margin:0 0 var(--sp-3)}
${FW} .fw-foot{background:var(--band);color:rgba(255,255,255,.9);padding-block:var(--sp-7) var(--sp-5);margin-top:0}
${FW} .fw-foot-grid{display:grid;gap:var(--sp-6)}
${FW} .fw-foot-name{font-family:var(--font-heading);font-size:var(--fs-xl);color:#fff;margin:0 0 8px}
${FW} .fw-foot h2{font-size:var(--fs-sm);letter-spacing:.06em;text-transform:uppercase;color:#fff;margin:0 0 10px}
${FW} .fw-foot ul{list-style:none;padding:0;margin:0;display:grid;gap:4px}
${FW} .fw-foot li{display:flex;justify-content:space-between;gap:16px;max-width:280px}
${FW} .fw-foot a{color:#fff}
${FW} .fw-foot-small{margin-top:var(--sp-6);font-size:var(--fs-xs);color:rgba(255,255,255,.75)}
@media (min-width:${DESK}px){${FW} .fw-foot-grid{grid-template-columns:1.4fr 1fr 1fr}}

/* ══════════ Bold Practical: dark bar, purpose-first hero with action panel, rules, price table, closing band ══════════ */
${FB}{--fb-line:3px solid var(--ink)}
${FB} .fb-head{background:var(--band);color:#fff;position:sticky;top:0;z-index:30}
${FB} .fb-head-in{display:flex;align-items:center;gap:var(--sp-5);min-height:70px}
${FB} .fb-logo{margin-right:auto;color:#fff;text-decoration:none}
${FB} .fb-word{font-family:var(--font-heading);font-weight:var(--hw);font-size:var(--fs-xl);text-transform:uppercase;letter-spacing:.02em}
${FB} .fb-logo-img{max-height:42px;width:auto;max-width:100%;object-fit:contain;background:#fff;padding:4px 8px;border-radius:4px}
${FB} .fb-nav{display:flex;gap:var(--sp-5)}
${FB} .fb-nav a{color:#fff;text-decoration:none;font-weight:700;font-size:var(--fs-sm);text-transform:uppercase;letter-spacing:.06em}
${FB} .fb-nav a:hover,${FB} .fb-nav a[aria-current]{box-shadow:inset 0 -3px 0 var(--brand)}
${FB} .fb-phone{display:grid;color:#fff;text-decoration:none;line-height:1.1;font-family:var(--font-heading);font-size:var(--fs-lg);font-weight:var(--hw)}
${FB} .fb-phone-l{font-family:var(--font-body);font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.85;font-weight:700}
${FB} .fb-head-cta{--bh:44px;font-size:var(--fs-sm)}
${FB} .f-menu summary{color:#fff}
@media (max-width:${DESK - 1}px){${FB} .fb-nav,${FB} .fb-head-cta{display:none}${FB} .fb-head-in{min-height:60px;gap:12px}${FB} .fb-phone{font-size:var(--fs-md)}}
${FB} .fb-phone-ic{display:none}
@media (max-width:${DESK - 1}px){
  ${FB} .fb-phone{width:44px;height:44px;display:grid;place-items:center;border:2px solid rgba(255,255,255,.7);border-radius:var(--btn-r,var(--btn-r0))}
  ${FB} .fb-phone-l,${FB} .fb-phone-n{display:none}${FB} .fb-phone-ic{display:block;line-height:0}
  ${FB} .fb-word{font-size:var(--fs-md);line-height:1.15}
}
${FB} .fb-hero{background:var(--band);color:#fff;padding-block:calc(var(--section-y) * .7) var(--section-y)}
${FB} .fb-hero-grid{display:grid;gap:var(--sp-6);align-items:start}
${FB} .fb-kicker{font-size:var(--fs-sm);font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.85);margin:0}
${FB} .fb-hero h1{font-size:clamp(calc(44px * var(--tk,1)),7.4vw,calc(108px * var(--tk,1)));line-height:.95;text-transform:uppercase;margin:var(--sp-4) 0;max-width:12ch;color:#fff}
${FB} .fb-hero h1.is-long{font-size:clamp(calc(34px * var(--tk,1)),4.4vw,calc(68px * var(--tk,1)));max-width:19ch;line-height:1.02}
${FB} .fb-lede{font-size:var(--fs-lg);color:rgba(255,255,255,.88);max-width:46ch;line-height:1.55}
/* a sentence reads in even lines: no one-word last line, and on a phone a size that keeps about 36 characters to a line */
:is(.fe-lede,.fw-lede,.fb-lede){text-wrap:pretty;overflow-wrap:break-word;hyphens:manual}
@media (max-width:${DESK - 1}px){${FB} .fb-lede{font-size:clamp(16px,4.4vw,19px);max-width:none}}
${FB} .fb-hero .d-note{color:rgba(255,255,255,.85)}
${FB} .fb-panel{background:var(--surface);color:var(--ink);padding:var(--sp-6);border-top:6px solid var(--brand);display:grid;gap:14px}
${FB} .fb-panel-h{font-family:var(--font-heading);font-weight:var(--hw);text-transform:uppercase;font-size:var(--fs-xl);margin:0}
${FB} .fb-panel-phone{display:inline-flex;gap:10px;align-items:center;white-space:nowrap;font-family:var(--font-heading);font-weight:var(--hw);font-size:clamp(24px,7vw,var(--fs-2xl));color:var(--ink);text-decoration:none;min-height:44px}
${FB} .fb-panel-hours{display:flex;gap:8px;align-items:center;margin:0;font-weight:600}
${FB} .fb-checks{list-style:none;padding:0;margin:0;display:grid;gap:8px;border-top:2px solid var(--ink);padding-top:14px}
${FB} .fb-checks li{display:flex;gap:8px;align-items:center;font-weight:700}
@media (min-width:${DESK}px){${FB} .fb-hero-grid{grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:var(--sp-8,64px)}}
${FB} .fb-photo-wrap{margin-top:var(--sp-7)}
${FB} .fb-photo{margin:0;position:relative}
${FB} .fb-photo img{width:100%;height:auto;display:block;aspect-ratio:21/9;object-fit:cover}
@media (max-width:${DESK - 1}px){${FB} .fb-photo img{aspect-ratio:16/10}}
${FB} .fb-hero-type{padding-bottom:calc(var(--section-y) * .6)}
${FB} .fb-nums{list-style:none;padding:0;margin:var(--sp-7) 0 0;display:grid;grid-template-columns:repeat(2,1fr);border-top:2px solid rgba(255,255,255,.5)}
${FB} .fb-nums li{padding:18px 16px 0 0;display:grid;gap:4px}
${FB} .fb-nums b{font-family:var(--font-heading);font-size:clamp(40px,5vw,72px);line-height:1;color:#fff}
${FB} .fb-nums span{font-size:var(--fs-sm);text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.85);font-weight:700}
@media (min-width:${DESK}px){${FB} .fb-nums{grid-template-columns:repeat(4,1fr)}}
${FB} .fb-intro{padding-block:var(--section-y);border-bottom:var(--fb-line)}
${FB} .fb-intro-grid{display:grid;gap:var(--sp-4)}
${FB} .fb-intro h2{font-size:var(--fs-sm);letter-spacing:.14em;text-transform:uppercase;margin:0}
${FB} .fb-intro p{font-size:var(--fs-xl);font-weight:600;line-height:1.4;max-width:46ch;margin:0}
${FB} .fb-intro .fb-intro-text p{font-size:var(--fs-lg);font-weight:400;line-height:1.65;max-width:62ch;margin:0 0 var(--sp-4)}
${FB} .fb-intro .fb-intro-text p:last-child{margin-bottom:0}
@media (min-width:${DESK}px){${FB} .fb-intro-grid{grid-template-columns:200px 1fr}}
${FB} .fb-sec-head{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:end;justify-content:space-between;border-bottom:var(--fb-line);padding-bottom:12px;margin-bottom:0}
${FB} .fb-sec-head h2{font-size:clamp(calc(30px * var(--tk,1)),4vw,calc(56px * var(--tk,1)));text-transform:uppercase;line-height:1;margin:0}
${FB} .fb-offers{padding-block:var(--section-y)}
${FB} .fb-table{list-style:none;padding:0;margin:0}
${FB} .fb-table li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 24px;align-items:center;padding:18px 0;border-bottom:1px solid rgba(0,0,0,.18)}
${FB} .fb-table h3{font-size:var(--fs-lg);text-transform:uppercase;margin:0}
${FB} .fb-table h3 a{color:inherit}
${FB} .fb-table p{margin:4px 0 0;color:var(--ink-muted);font-size:var(--fs-sm)}
${FB} .fb-price{font-family:var(--font-heading);font-weight:var(--hw);font-size:var(--fs-xl);font-variant-numeric:tabular-nums;white-space:nowrap}
${FB} .fb-price.is-quote{font-family:var(--font-body);font-size:var(--fs-sm);font-weight:700;text-transform:uppercase;color:var(--ink-muted)}
${FB} .fb-plans{display:grid;gap:var(--gutter);margin-top:var(--sp-6)}
${FB} .fb-plan{border:3px solid var(--ink);padding:var(--sp-5);display:grid;gap:10px;align-content:start}
${FB} .fb-plan.is-first{border-color:var(--brand);box-shadow:8px 8px 0 var(--brand)}
${FB} .fb-plan h3{text-transform:uppercase;font-size:var(--fs-lg);margin:0}
${FB} .fb-plan-price{font-family:var(--font-heading);font-weight:var(--hw);font-size:var(--fs-2xl);margin:0}
${FB} .fb-plan .btn{justify-self:start}
@media (min-width:640px){${FB} .fb-plans{grid-template-columns:repeat(2,1fr)}}
@media (min-width:${DESK}px){${FB} .fb-plans{grid-template-columns:repeat(4,1fr)}}
${FB} .f-process{background:var(--surface-alt)}
${FB} .f-process h2{text-transform:uppercase}
${FB} .f-steps li{border-top:6px solid var(--ink);padding-top:var(--sp-4)}
${FB} .f-step-n{font-size:var(--fs-3xl);color:var(--ink)}
${FB} .fb-proof{padding-block:var(--section-y);background:var(--surface-alt)}
${FB} .fb-proof-grid{display:grid;gap:var(--sp-7);align-items:center}
${FB} .fb-proof h2{text-transform:uppercase;font-size:var(--fs-2xl)}
${FB} .fb-rating{display:flex;gap:16px;align-items:center;margin:var(--sp-4) 0}
${FB} .fb-rating b{font-family:var(--font-heading);font-size:clamp(64px,8vw,112px);line-height:.9}
${FB} .fb-quote{margin:0;border-left:6px solid var(--brand);padding-left:var(--sp-5)}
${FB} .fb-quote blockquote{margin:0;font-size:var(--fs-xl);font-weight:600;line-height:1.4}
${FB} .fb-quote figcaption{margin-top:12px;color:var(--ink-muted);font-size:var(--fs-sm)}
@media (min-width:${DESK}px){${FB} .fb-proof-grid{grid-template-columns:1fr 1.4fr}}
${FB} .fb-gallery{padding-block:var(--section-y)}
${FB} .fb-grid{display:grid;gap:8px;grid-template-columns:1fr 1fr;margin-top:var(--sp-6)}
${FB} .fb-grid figure{aspect-ratio:1}
${FB} .fb-grid .lb-open{border-radius:0}
@media (min-width:${DESK}px){${FB} .fb-grid{grid-template-columns:repeat(4,1fr)}}
${FB} .f-team-img img{border:3px solid var(--ink)}
${FB} .fb-cta{background:var(--btn-bg,var(--brand));color:var(--brand-ink);padding-block:var(--section-y)}
${FB} .fb-cta-in{display:flex;flex-wrap:wrap;gap:var(--sp-5);align-items:center;justify-content:space-between}
${FB} .fb-cta h2{font-size:clamp(calc(34px * var(--tk,1)),5vw,calc(72px * var(--tk,1)));text-transform:uppercase;line-height:.95;margin:0;color:inherit;max-width:14ch}
${FB} .fb-btn-outline{--bh:52px;border:3px solid currentColor;color:inherit;background:transparent;font-weight:800;text-transform:uppercase}
${FB} .fb-contact{padding-block:var(--section-y)}
${FB} .fb-contact-grid{display:grid;gap:var(--sp-7)}
${FB} .fb-contact h2{text-transform:uppercase;font-size:clamp(calc(30px * var(--tk,1)),4vw,calc(52px * var(--tk,1)));line-height:1}
${FB} .fb-steps{list-style:none;padding:0;margin:var(--sp-5) 0;display:grid;gap:10px}
${FB} .fb-steps li{display:flex;gap:12px;align-items:center;font-weight:700}
${FB} .fb-steps b{width:34px;height:34px;display:grid;place-items:center;background:var(--ink);color:#fff}
@media (min-width:${DESK}px){${FB} .fb-contact-grid{grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)}}
${FB} .fb-visit{padding-block:var(--section-y);border-top:var(--fb-line)}
${FB} .fb-visit-grid{display:grid;gap:var(--sp-6)}
${FB} .fb-visit h2{text-transform:uppercase;font-size:var(--fs-2xl)}
${FB} .fb-areas{list-style:none;display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:var(--sp-4) 0 0}
${FB} .fb-areas li{border:2px solid var(--ink);padding:6px 12px;font-weight:700;font-size:var(--fs-sm);text-transform:uppercase}
@media (min-width:${DESK}px){${FB} .fb-visit-grid{grid-template-columns:1fr 1fr}}
${FB} .fb-page-hero{background:var(--band);color:#fff;padding-block:calc(var(--section-y) * .7)}
${FB} .fb-page-hero h1{text-transform:uppercase;font-size:clamp(calc(38px * var(--tk,1)),6vw,calc(84px * var(--tk,1)));line-height:.95;margin:0 0 var(--sp-3);color:#fff}
${FB} .fb-page-hero .f-crumbs{color:rgba(255,255,255,.85)}
${FB} .fb-foot{background:#0b0e12;color:rgba(255,255,255,.88);padding-block:var(--sp-7) var(--sp-5)}
${FB} .fb-foot-grid{display:grid;gap:var(--sp-6)}
${FB} .fb-foot-name{font-family:var(--font-heading);font-weight:var(--hw);text-transform:uppercase;font-size:var(--fs-xl);color:#fff;margin:0 0 8px}
${FB} .fb-foot h2{font-size:var(--fs-sm);text-transform:uppercase;letter-spacing:.1em;color:#fff;margin:0 0 10px}
${FB} .fb-foot ul{list-style:none;padding:0;margin:0;display:grid;gap:4px}
${FB} .fb-foot a{color:#fff}
${FB} .fb-foot-small{margin-top:var(--sp-6);font-size:var(--fs-xs);color:rgba(255,255,255,.72)}
@media (min-width:${DESK}px){${FB} .fb-foot-grid{grid-template-columns:repeat(3,1fr)}}

/* motion: one language per family; hover is never the only way to see something */
@media (hover:hover){
  ${FE} .fe-list li{transition:background .2s ease}${FE} .fe-list li:hover{background:rgba(255,255,255,.55)}
  ${FW} .fw-quote,${FW} .fw-grid figure{transition:transform .2s ease}${FW} .fw-quote:hover,${FW} .fw-grid figure:hover{transform:translateY(-3px)}
  ${FB} .fb-table li{transition:padding-left .15s ease}${FB} .fb-table li:hover{padding-left:8px}
}
${FB} .fb-table li:focus-within{padding-left:8px}
body[data-family][data-motion=off] *{transition:none !important;animation:none !important}
@media (prefers-reduced-motion:reduce){body[data-family] *{transition:none !important;animation:none !important}${FW} .fw-frame,${FW} .fw-polaroid{transform:none}}
`;
}
