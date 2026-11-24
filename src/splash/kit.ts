/**
 * The Roger kit: the modern pieces a splash page is composed from, so Claude chooses and combines them per business
 * instead of writing every rule from scratch. Claude marks elements with data-rk-* attributes and kit classes; Roger
 * supplies the CSS (here), the motion (Motion, motion.dev, driven by KIT_JS), the big footer and the marquee loops.
 *
 *   heroes      section#hero[data-rk-hero="full|split|collage|type|marquee"] with .rk-hero__copy and .rk-hero__media
 *   buttons     .rk-btn [data-rk-style="solid|outline|glass|light"] [data-rk-hover="sweep|lift|fill|glow|shine|arrow|magnetic"]
 *   links       .rk-link [data-rk-underline="draw|slide|highlight"]
 *   cards       .rk-card [data-rk-depth="1|2|3"] [data-rk-tilt]
 *   frames      .rk-frame (a photo's frame: one img, its credit inside)
 *   marquee     .rk-marquee > .rk-marquee__track > .rk-marquee__item (Roger repeats the track for a seamless loop)
 *   motion      [data-rk-anim="fade-up|fade|scale|slide-left|slide-right|stagger|words|parallax|count"] [data-rk-delay]
 *   nav         header[data-rk-nav="glass|over"] (over: transparent over a full-bleed hero, glass once scrolled)
 *   type        .rk-display .rk-title .rk-lead .rk-eyebrow .rk-container .rk-section .rk-grid
 *
 * Everything reads with no JavaScript: hidden starting states apply only once the script has marked the page (html.rk-js),
 * and nothing moves for a visitor who asked for reduced motion, or on a calm trade's page.
 */
import { MOTION_JS } from './vendor/motion.js';

export const HERO_VARIANTS = ['full', 'split', 'collage', 'type', 'marquee'] as const;
export type HeroVariant = typeof HERO_VARIANTS[number];
/** The hero's choreography is chosen for the business independently of its photo layout. */
export const HERO_SEQUENCES = ['editorial', 'scene-first', 'direct'] as const;
/**
 * How the hero and one important section move (data-rk-treatment), each different in kind:
 *   subtle  the quiet reveal (fade, rise, stagger) any page can use
 *   spread  a collage of three or more photos opens out from a stack into its places (still slots hold each place and
 *           any photo credit, so nothing a visitor reads moves)
 *   unveil  each photo is uncovered by a panel in the brand colour sliding off it, the photo settling as it appears
 *   track   a horizontal sequence: a row of items (a swipeable row on phones) uncovered one after another, left to
 *           right, each photo panning sideways into place
 * Frames that hold credits never move or clip in unveil and track: only the photo inside and the panel over it do.
 */
export const TREATMENTS = ['subtle', 'spread', 'unveil', 'track'] as const;
export type Treatment = typeof TREATMENTS[number];

const hex = (v: string | undefined) => (v && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : undefined);
const lum = (h: string) => { const [r, g, b] = [1, 3, 5].map((i) => { const x = parseInt(h.slice(i, i + 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** the text colour that reads on a colour: white or near-black, whichever contrasts more */
export const onColour = (bg: string) => (ratio(bg, '#ffffff') >= ratio(bg, '#111111') ? '#ffffff' : '#111111');

/** the page's tokens as CSS variables, from Claude's design tokens (safe values only; sensible defaults) */
export function kitTokens(t: Record<string, string>, fonts: string[]): string {
  const dark = (t.mood ?? '').toLowerCase() === 'dark';
  const bg = hex(t.background) ?? (dark ? '#0e0f11' : '#fbfaf8');
  const text = hex(t.text) ?? (dark ? '#f4f2ee' : '#121212');
  const primary = hex(t.primary) ?? '#1f2937';
  const accent = hex(t.accent) ?? primary;
  const surface = hex(t.neutral_1) ?? (dark ? '#17191c' : '#ffffff');
  const muted = hex(t.neutral_2) ?? (dark ? '#a7a39b' : '#5b5b5b');
  const q = (f?: string) => (f && /^[A-Za-z][A-Za-z0-9 -]{0,59}$/.test(f) ? `'${f}',` : '');
  const display = q(t.display_font) || q(fonts[0]);
  const body = q(t.text_font) || q(fonts[1]) || q(fonts[0]);
  const radius = { sharp: '6px', soft: '18px', round: '28px' }[(t.radius ?? 'soft').toLowerCase()] ?? '18px';
  return `:root{--rk-bg:${bg};--rk-text:${text};--rk-primary:${primary};--rk-on-primary:${onColour(primary)};--rk-accent:${accent};--rk-on-accent:${onColour(accent)};--rk-surface:${surface};--rk-muted:${muted};--rk-radius:${radius};--rk-display:${display}ui-serif,Georgia,serif;--rk-body:${body}ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;--rk-footer-bg:${dark ? surface : text};--rk-footer-text:${dark ? text : bg};color-scheme:${dark ? 'dark' : 'light'}}`;
}

export const KIT_CSS = `
:root{--rk-ease:cubic-bezier(.22,1,.36,1);--rk-shadow-1:0 1px 2px rgb(0 0 0/.06),0 6px 16px -8px rgb(0 0 0/.16);--rk-shadow-2:0 2px 6px rgb(0 0 0/.06),0 18px 40px -16px rgb(0 0 0/.26);--rk-shadow-3:0 4px 10px rgb(0 0 0/.08),0 34px 70px -28px rgb(0 0 0/.42);--rk-nav-h:72px}
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--rk-bg);color:var(--rk-text);font-family:var(--rk-body);font-size:clamp(17px,1.05vw + 12px,19px);line-height:1.6;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
:where(h1,h2,h3){font-family:var(--rk-display);line-height:1.04;letter-spacing:-.02em;margin:0 0 .45em;text-wrap:balance}
:where(p){margin:0 0 1em}
:where(img){max-width:100%;display:block}
.rk-container{width:min(1200px,100% - 40px);margin-inline:auto}
.rk-section{padding-block:clamp(64px,9vw,136px)}
.rk-display{font-family:var(--rk-display);font-size:clamp(2.6rem,min(7.4vw,10.5vh),6.6rem);line-height:.96;letter-spacing:-.035em;margin:0 0 .3em}
.rk-title{font-size:clamp(2rem,4.4vw,3.8rem)}
.rk-lead{font-size:clamp(1.08rem,1.3vw + .6rem,1.35rem);color:var(--rk-muted);max-width:38ch}
.rk-eyebrow{display:inline-flex;align-items:center;gap:.5em;font-size:.92rem;font-weight:600;letter-spacing:.01em;color:var(--rk-muted);margin-bottom:1em}
.rk-eyebrow::before{content:"";width:22px;height:2px;background:var(--rk-accent);border-radius:2px}
.rk-grid{display:grid;gap:clamp(16px,2.4vw,28px)}
@media (min-width:768px){.rk-grid[data-rk-cols="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}.rk-grid[data-rk-cols="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}.rk-grid[data-rk-cols="4"]{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:1100px){.rk-grid[data-rk-cols="4"]{grid-template-columns:repeat(4,minmax(0,1fr))}}

/* frames: one photo each, cropped to its subject; a dark fallback so text over it reads before it loads */
.rk-frame{position:relative;overflow:hidden;border-radius:var(--rk-radius);background:#1b1c1f;isolation:isolate}
.rk-frame>img{width:100%;height:100%;object-fit:cover}

/* ── heroes ── */
#hero[data-rk-hero]{position:relative;overflow:clip}
.rk-hero__copy{position:relative;z-index:2}
.rk-hero__copy>*:last-child{margin-bottom:0}
.rk-hero__actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:1.6em}
.rk-hero__meta{display:flex;flex-wrap:wrap;gap:.4em 1em;align-items:center;font-size:.95rem;margin-top:1.2em;color:var(--rk-muted)}
/* full: the photo fills the screen, the words sit on it */
#hero[data-rk-hero="full"]{min-height:min(100svh,940px);display:grid;align-items:end;padding:calc(var(--rk-nav-h) + 40px) 0 clamp(40px,7vw,96px);color:#fff;background:#141518}
#hero[data-rk-hero="full"] .rk-hero__media{position:absolute;inset:0;z-index:0}
#hero[data-rk-hero="full"] .rk-hero__media .rk-frame{position:absolute;inset:0;border-radius:0}
#hero[data-rk-hero="full"] .rk-hero__media::after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(90deg,rgb(0 0 0/.55) 0%,rgb(0 0 0/.18) 55%,transparent 78%),linear-gradient(180deg,rgb(0 0 0/.45) 0%,rgb(0 0 0/.06) 30%,rgb(0 0 0/.2) 55%,rgb(0 0 0/.8) 100%)}
#hero[data-rk-hero="full"] .rk-lead,#hero[data-rk-hero="full"] .rk-hero__meta,#hero[data-rk-hero="full"] .rk-eyebrow{color:rgb(255 255 255/.9)}
/* a hero always shows its actions on the first screen: its headline is sized by the screen's height too (the type
   hero, made of oversized words, has its own scale), and on phones a full hero's words stay clear of the dock (the
   kit holds these over the page's own rules) */
#hero[data-rk-hero]:not([data-rk-hero="type"]) h1{font-size:clamp(2.3rem,min(7.4vw,8.6vh),6rem)!important}
#hero[data-rk-hero="full"] h1{max-width:16ch}
#hero[data-rk-hero="full"] .rk-hero__copy{padding-top:0!important}
@media (max-width:1023.98px){#hero[data-rk-hero="full"]{min-height:100svh;padding-bottom:calc(108px + env(safe-area-inset-bottom))!important}}
#hero[data-rk-hero="full"] .gcredit{top:calc(var(--rk-nav-h) + 8px);bottom:auto;right:12px;left:auto;z-index:3}
/* split: words beside a tall photo, a glass badge on the photo */
#hero[data-rk-hero="split"]{padding:calc(var(--rk-nav-h) + 24px) 0 clamp(56px,8vw,112px)}
#hero[data-rk-hero="split"] .rk-hero__inner{display:grid;gap:clamp(28px,5vw,72px);align-items:center}
#hero[data-rk-hero="split"] .rk-hero__media .rk-frame{aspect-ratio:4/5;box-shadow:var(--rk-shadow-3)}
@media (min-width:960px){#hero[data-rk-hero="split"] .rk-hero__inner{grid-template-columns:1.08fr .92fr}}
/* collage: several photos, offset and overlapping */
#hero[data-rk-hero="collage"]{padding:calc(var(--rk-nav-h) + 24px) 0 clamp(56px,8vw,112px)}
#hero[data-rk-hero="collage"] .rk-hero__inner{display:grid;gap:clamp(32px,5vw,72px);align-items:center}
.rk-collage{display:grid;grid-template-columns:repeat(6,1fr);grid-auto-rows:clamp(54px,7vw,92px);gap:12px}
.rk-collage>.rk-frame,.rk-collage>.rk-slot>.rk-frame{box-shadow:var(--rk-shadow-2)}
/* default places, only for items the page has not styled itself (an item with its own class keeps the page's own
   layout, grid or absolute: a grid area here would become an absolute item's containing block) */
:where(.rk-collage>:is([class="rk-frame"],[class="rk-slot"]):nth-child(1)){grid-column:1/5;grid-row:1/5}
:where(.rk-collage>:is([class="rk-frame"],[class="rk-slot"]):nth-child(2)){grid-column:4/7;grid-row:3/7;z-index:1}
:where(.rk-collage>:is([class="rk-frame"],[class="rk-slot"]):nth-child(3)){grid-column:1/4;grid-row:5/8}
:where(.rk-collage>:is([class="rk-frame"],[class="rk-slot"]):nth-child(4)){grid-column:5/7;grid-row:1/3}
:where(.rk-collage>:is([class="rk-frame"],[class="rk-slot"]):nth-child(5)){grid-column:4/6;grid-row:7/9}
@media (min-width:960px){#hero[data-rk-hero="collage"] .rk-hero__inner{grid-template-columns:.95fr 1.05fr}}
/* type: oversized words across the screen, the photo laid into them */
#hero[data-rk-hero="type"]{padding:calc(var(--rk-nav-h) + 24px) 0 clamp(48px,7vw,96px);text-align:center}
#hero[data-rk-hero="type"] .rk-display,#hero[data-rk-hero="type"] h1{font-size:clamp(3rem,min(12.5vw,17vh),11.5rem);line-height:.86;letter-spacing:-.045em;margin:0}
#hero[data-rk-hero="type"] .rk-hero__media{width:min(520px,78%);margin:clamp(-48px,-4vw,-20px) auto 0;position:relative;z-index:3}
#hero[data-rk-hero="type"] .rk-hero__media .rk-frame{aspect-ratio:4/3;box-shadow:var(--rk-shadow-3)}
#hero[data-rk-hero="type"] .rk-lead{margin-inline:auto}
#hero[data-rk-hero="type"] .rk-hero__actions,#hero[data-rk-hero="type"] .rk-hero__meta{justify-content:center}
/* marquee: words beside a photo, the business's own words running beneath */
#hero[data-rk-hero="marquee"]{padding:calc(var(--rk-nav-h) + 24px) 0 0}
#hero[data-rk-hero="marquee"] .rk-hero__inner{display:grid;gap:clamp(28px,5vw,64px);align-items:center;padding-bottom:clamp(32px,5vw,64px)}
#hero[data-rk-hero="marquee"] .rk-hero__media .rk-frame{aspect-ratio:5/4;box-shadow:var(--rk-shadow-2)}
@media (min-width:960px){#hero[data-rk-hero="marquee"] .rk-hero__inner{grid-template-columns:1fr 1fr}}

/* ── marquee ── */
.rk-marquee{overflow:hidden;border-block:1px solid color-mix(in srgb,currentColor 14%,transparent);padding-block:clamp(14px,2vw,22px);-webkit-mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);mask-image:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)}
.rk-marquee__track{display:flex;gap:clamp(28px,4vw,64px);width:max-content;animation:rk-marquee var(--rk-speed,38s) linear infinite}
.rk-marquee:hover .rk-marquee__track{animation-play-state:paused}
.rk-marquee__item{font-family:var(--rk-display);font-size:clamp(1.6rem,4vw,3.4rem);line-height:1.1;white-space:nowrap;display:inline-flex;align-items:center;gap:clamp(28px,4vw,64px)}
.rk-marquee__item::after{content:"";width:.32em;height:.32em;border-radius:50%;background:var(--rk-accent)}
@keyframes rk-marquee{to{transform:translateX(-50%)}}

/* ── buttons ── */
.rk-btn{--b-bg:var(--rk-primary);--b-fg:var(--rk-on-primary);--b-bd:transparent;position:relative;isolation:isolate;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;gap:.6em;min-height:52px;padding:0 1.55em;border-radius:999px;border:1.5px solid var(--b-bd);background:var(--b-bg);color:var(--b-fg);font:600 1rem/1 var(--rk-body);text-decoration:none;cursor:pointer;transition:transform .45s var(--rk-ease),box-shadow .45s var(--rk-ease),background-color .3s,color .3s,border-color .3s;will-change:transform}
.rk-btn:focus-visible{outline:3px solid var(--rk-accent);outline-offset:3px}
.rk-btn[data-rk-style="outline"]{--b-bg:transparent;--b-fg:currentColor;--b-bd:currentColor}
.rk-btn[data-rk-style="glass"]{--b-bg:rgb(255 255 255/.14);--b-fg:#fff;--b-bd:rgb(255 255 255/.36);-webkit-backdrop-filter:blur(14px) saturate(1.4);backdrop-filter:blur(14px) saturate(1.4)}
.rk-btn[data-rk-style="light"]{--b-bg:#fff;--b-fg:#111}
.rk-btn::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;pointer-events:none}
/* sweep: the accent sweeps across from the left */
.rk-btn[data-rk-hover="sweep"]::before{background:var(--rk-accent);transform:scaleX(0);transform-origin:right;transition:transform .55s var(--rk-ease)}
.rk-btn[data-rk-hover="sweep"]:hover{color:var(--rk-on-accent)}
.rk-btn[data-rk-hover="sweep"]:hover::before{transform:scaleX(1);transform-origin:left}
/* fill: an outline button fills from the bottom */
.rk-btn[data-rk-hover="fill"]::before{background:var(--rk-primary);transform:translateY(101%);transition:transform .5s var(--rk-ease)}
.rk-btn[data-rk-hover="fill"]:hover{color:var(--rk-on-primary);border-color:var(--rk-primary)}
.rk-btn[data-rk-hover="fill"]:hover::before{transform:none}
/* lift: it rises, with a deeper shadow */
.rk-btn[data-rk-hover="lift"]:hover{transform:translateY(-3px);box-shadow:var(--rk-shadow-2)}
/* glow: a soft ring of its own colour */
.rk-btn[data-rk-hover="glow"]:hover{box-shadow:0 0 0 6px color-mix(in srgb,var(--b-bg) 22%,transparent),0 14px 34px -10px color-mix(in srgb,var(--b-bg) 80%,transparent)}
/* shine: a sheen passes over it */
.rk-btn[data-rk-hover="shine"]::after{content:"";position:absolute;inset:-20% auto -20% -60%;width:40%;transform:skewX(-20deg);background:linear-gradient(90deg,transparent,rgb(255 255 255/.45),transparent);transition:left .7s var(--rk-ease);pointer-events:none}
.rk-btn[data-rk-hover="shine"]:hover::after{left:130%}
/* arrow: an arrow slides in after the label (drawn by Roger, never typed) */
.rk-btn[data-rk-hover="arrow"]::after{content:"";width:1em;height:1em;margin-right:-.2em;background:currentColor;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 12h13M13 6l6 6-6 6' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 12h13M13 6l6 6-6 6' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/contain no-repeat;transition:transform .45s var(--rk-ease)}
.rk-btn[data-rk-hover="arrow"]:hover::after{transform:translateX(4px)}
/* magnetic: it leans toward the pointer (the script moves it) */
.rk-btn[data-rk-hover="magnetic"]{transition:transform .5s var(--rk-ease),box-shadow .45s var(--rk-ease)}

/* ── links ── */
.rk-link{color:inherit;text-decoration:none;background:linear-gradient(currentColor,currentColor) 0 100%/0 1.5px no-repeat;transition:background-size .45s var(--rk-ease);padding-bottom:2px}
.rk-link:hover,.rk-link:focus-visible{background-size:100% 1.5px}
.rk-link[data-rk-underline="slide"]{background-size:100% 1.5px;background-position:100% 100%}
.rk-link[data-rk-underline="slide"]:hover{animation:rk-slide .6s var(--rk-ease)}
@keyframes rk-slide{0%{background-size:100% 1.5px;background-position:100% 100%}50%{background-size:0 1.5px;background-position:100% 100%}50.01%{background-position:0 100%}100%{background-size:100% 1.5px;background-position:0 100%}}
.rk-link[data-rk-underline="highlight"]{background:linear-gradient(color-mix(in srgb,var(--rk-accent) 38%,transparent),color-mix(in srgb,var(--rk-accent) 38%,transparent)) 0 100%/100% .32em no-repeat;transition:background-size .4s var(--rk-ease)}
.rk-link[data-rk-underline="highlight"]:hover{background-size:100% 100%}

/* ── cards: depth, lift, tilt ── */
.rk-card{position:relative;background:var(--rk-surface);border-radius:var(--rk-radius);padding:clamp(22px,3vw,34px);box-shadow:var(--rk-shadow-1);border:1px solid color-mix(in srgb,var(--rk-text) 7%,transparent);transition:transform .55s var(--rk-ease),box-shadow .55s var(--rk-ease)}
.rk-card[data-rk-depth="2"]{box-shadow:var(--rk-shadow-2)}
.rk-card[data-rk-depth="3"]{box-shadow:var(--rk-shadow-3)}
.rk-card:hover{transform:translateY(-6px);box-shadow:var(--rk-shadow-3)}
.rk-card[data-rk-tilt]{transform-style:preserve-3d;will-change:transform}
.rk-card>.rk-frame:first-child{margin:calc(-1 * clamp(22px,3vw,34px)) calc(-1 * clamp(22px,3vw,34px)) 18px;border-radius:var(--rk-radius) var(--rk-radius) 0 0}

/* ── navigation ── */
header[data-rk-nav]{position:sticky;top:0;z-index:40;transition:background-color .35s,box-shadow .35s,color .35s}
header[data-rk-nav="glass"]{background:color-mix(in srgb,var(--rk-bg) 72%,transparent);-webkit-backdrop-filter:blur(16px) saturate(1.5);backdrop-filter:blur(16px) saturate(1.5);border-bottom:1px solid color-mix(in srgb,var(--rk-text) 8%,transparent)}
header[data-rk-nav="over"]{position:absolute;inset:0 0 auto;color:#fff;background:transparent}
.rk-js header[data-rk-nav="over"]{position:fixed}
.rk-js header[data-rk-nav="over"].rk-scrolled{color:var(--rk-text);background:color-mix(in srgb,var(--rk-bg) 78%,transparent);-webkit-backdrop-filter:blur(16px) saturate(1.5);backdrop-filter:blur(16px) saturate(1.5);box-shadow:0 1px 0 color-mix(in srgb,var(--rk-text) 8%,transparent)}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){header[data-rk-nav="glass"],.rk-js header[data-rk-nav="over"].rk-scrolled{background:var(--rk-bg)}}
@media (prefers-reduced-transparency:reduce){header[data-rk-nav="glass"],.rk-js header[data-rk-nav="over"].rk-scrolled{background:var(--rk-bg);-webkit-backdrop-filter:none;backdrop-filter:none}}

/* the preview strip (previews only): it stays at the top, the navigation below it */
.rg-ribbon{position:sticky;top:0;z-index:45;height:24px;box-sizing:border-box;padding-block:0;line-height:24px}
.rg-ribbon~header[data-rk-nav]{top:24px}

/* ── the big footer (Roger's, from the facts) ── */
.rk-footer{background:var(--rk-footer-bg);color:var(--rk-footer-text);padding:clamp(64px,8vw,112px) 0 28px;overflow:hidden}
.rk-footer a:not(.rk-btn){color:inherit}
.rk-footer__cols{display:grid;gap:36px 28px;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));padding-bottom:clamp(40px,6vw,72px);border-bottom:1px solid color-mix(in srgb,currentColor 16%,transparent)}
.rk-footer h2{font-family:var(--rk-body);font-size:.92rem;font-weight:600;letter-spacing:.01em;opacity:.62;margin:0 0 14px}
.rk-footer p,.rk-footer li{margin:0 0 6px;font-size:1rem}
.rk-footer ul{list-style:none;margin:0;padding:0}
.rk-footer [data-fact="hours"]{white-space:pre-line;opacity:.88}
.rk-footer__actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px}
.rk-footer__actions .rk-btn{--b-bg:var(--rk-footer-text);--b-fg:var(--rk-footer-bg);min-height:46px}
.rk-footer .rk-footer__wordmark{font-family:var(--rk-display);font-size:clamp(3rem,13vw,12rem);line-height:.86;letter-spacing:-.05em;margin:clamp(28px,5vw,56px) 0 clamp(20px,3vw,36px);white-space:nowrap;overflow:hidden;text-overflow:clip;opacity:.96}
.rk-footer__legal{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 20px;font-size:.88rem;opacity:.7}
.rk-footer__legal a{text-decoration:none}
.rk-footer__legal nav{display:flex;flex-wrap:wrap;gap:4px 18px}
.rk-footer__legal nav a,.rk-footer__links a{display:inline-flex;align-items:center;min-height:44px}

/* ── treatments (data-rk-treatment) ── */
/* a slot holds a moving frame's place and its photo credit, still */
.rk-slot{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0;background:none!important;box-shadow:none!important;border:0!important;overflow:visible!important}
.rk-slot>.rk-frame{flex:1 1 auto;min-height:0}
.rk-slot>.gcredit{position:relative;inset:auto;display:block;width:fit-content;max-width:100%;margin:6px 0 0;z-index:3}
/* unveil and track: a panel in the brand colour over each photo, only while the script can take it away */
.rk-veil{display:none}
.rk-js .rk-veil{display:block;position:absolute;inset:0;z-index:2;background:var(--rk-primary);pointer-events:none;transform-origin:right center}
.rk-frame>.gcredit{z-index:3}
/* track: a horizontal row (it scrolls sideways when the items are wider than the screen) */
[data-rk-treatment="track"] .rk-track{display:grid;grid-template-columns:none;grid-auto-flow:column;grid-auto-columns:minmax(min(78vw,320px),1fr);gap:clamp(14px,2vw,24px);overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;padding:4px 2px 14px;scrollbar-width:thin}
[data-rk-treatment="track"] .rk-track>*{scroll-snap-align:start;min-width:0}
.rk-js [data-rk-treatment="track"] .rk-track>*>:not(.rk-frame):not(.rk-slot){opacity:0}
.rk-js [data-rk-treatment="spread"] .rk-collage>.rk-slot>.rk-frame,.rk-js [data-rk-treatment="spread"] .rk-collage>.rk-frame{opacity:0}

/* ── motion: hidden starting states only once the script runs (no script, no hiding) ── */
.rk-js [data-rk-anim]:not([data-rk-anim="parallax"]):not([data-rk-anim="count"]):not([data-rk-anim="stagger"]):not([data-rk-anim="words"]){opacity:0}
.rk-js [data-rk-anim="stagger"]>*{opacity:0}
.rk-w{display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:.08em;margin-bottom:-.08em}
.rk-w>span{display:inline-block}
.rk-js [data-rk-anim="words"] .rk-w>span{transform:translateY(105%)}
@media (prefers-reduced-motion:reduce){.rk-marquee__track{animation:none;flex-wrap:wrap;width:auto}.rk-btn,.rk-card,.rk-link{transition:none!important}.rk-btn:hover,.rk-card:hover{transform:none}}
body[data-rk-calm="1"] .rk-marquee__track{animation:none;flex-wrap:wrap;width:auto}
body[data-rk-calm="1"] .rk-card:hover{transform:none}
`;

/** the head's first script: marks the page for motion (hidden starting states), undone at once if motion won't run */
export const KIT_HEAD_JS = `(function(){var d=document.documentElement;if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;d.classList.add('rk-js');setTimeout(function(){if(!window.RogerMotion||!window.__rkReady)d.classList.remove('rk-js')},2500)})();`;

/** the page's motion, with Motion's animate, inView, scroll and stagger */
export const KIT_JS = `(function(){
var d=document.documentElement,b=document.body,M=window.RogerMotion;
var nav=document.querySelector('header[data-rk-nav]');
if(nav){var on=function(){nav.classList.toggle('rk-scrolled',scrollY>40)};on();addEventListener('scroll',on,{passive:true})}
var still=b.getAttribute('data-rk-calm')==='1'||matchMedia('(prefers-reduced-motion: reduce)').matches;
if(!M||still){d.classList.remove('rk-js');return}
window.__rkReady=true;
var E=[.22,1,.36,1],V=M.inView;
var shown=function(el){return el&&el.getClientRects().length>0};
var A=function(t,k,o){var list=(t&&t.length!==undefined?Array.prototype.slice.call(t):[t]).filter(shown);if(!list.length)return;try{var a=M.animate(list,k,o);if(a&&a.finished)a.finished.catch(function(){})}catch(e){}};
var esc=function(s){return s.replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})};
document.querySelectorAll('[data-rk-anim="words"]').forEach(function(el){
  if(el.querySelector('[data-fact],[data-google],a,img,br')){el.removeAttribute('data-rk-anim');return}
  var t=el.textContent.trim();el.setAttribute('aria-label',t);
  el.innerHTML=t.split(/\\s+/).map(function(w){return '<span class="rk-w" aria-hidden="true"><span>'+esc(w)+'</span></span>'}).join(' ');
});
var hero=document.getElementById('hero'),seq=hero&&hero.getAttribute('data-rk-sequence');
var offset=function(el){if(!hero||!hero.contains(el)||!seq)return 0;
  var media=!!el.closest('.rk-hero__media'),heading=el.matches('h1')||!!el.closest('h1');
  if(seq==='scene-first')return media ? 0 : heading ? .38 : .65;
  if(seq==='editorial')return heading ? 0 : media ? .5 : .3;
  return media||heading ? 0 : .16;
};
var delay=function(el){var v=parseFloat(el.getAttribute('data-rk-delay')||'0');return (isFinite(v)?Math.min(v,1.5):0)+offset(el)};
var FROM={'fade-up':{opacity:[0,1],transform:['translateY(32px)','none']},'fade':{opacity:[0,1]},'scale':{opacity:[0,1],transform:['scale(.94)','none']},'slide-left':{opacity:[0,1],transform:['translateX(48px)','none']},'slide-right':{opacity:[0,1],transform:['translateX(-48px)','none']}};
var play=function(el){var k=el.getAttribute('data-rk-anim');
  if(FROM[k])A(el,FROM[k],{duration:.9,delay:delay(el),ease:E});
  else if(k==='stagger')A(el.children,{opacity:[0,1],transform:['translateY(24px)','none']},{duration:.75,delay:M.stagger(.08,{startDelay:delay(el)}),ease:E});
  else if(k==='words')A(el.querySelectorAll('.rk-w>span'),{transform:['translateY(105%)','none']},{duration:.85,delay:M.stagger(.055,{startDelay:delay(el)}),ease:E});
  else if(k==='count')count(el);
};
var count=function(el){if(el.matches('[data-google],[data-fact]')||el.closest('[data-google],[data-fact]')||el.querySelector('[data-google],[data-fact]'))return;
  var raw=el.textContent.trim(),m=raw.match(/^([^0-9]*)([0-9][0-9,]*\\.?[0-9]*)(.*)$/);if(!m)return;
  var cs=getComputedStyle(el);if(cs.display==='inline')el.style.display='inline-block';el.style.fontVariantNumeric='tabular-nums';el.style.minWidth=el.getBoundingClientRect().width+'px';el.style.textAlign=cs.textAlign==='start'?'right':cs.textAlign;
  var dec=(m[2].split('.')[1]||'').length,to=parseFloat(m[2].replace(/,/g,'')),t0=performance.now(),dur=1200;
  var f=function(t){var p=Math.min(1,(t-t0)/dur),v=to*(1-Math.pow(1-p,3));el.textContent=m[1]+v.toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec})+m[3];if(p<1)requestAnimationFrame(f);else el.textContent=raw};requestAnimationFrame(f)};
document.querySelectorAll('[data-rk-anim]').forEach(function(el){var k=el.getAttribute('data-rk-anim');
  if(k==='parallax'){M.scroll(function(p){el.style.transform='translate3d(0,'+((p-.5)*-80).toFixed(1)+'px,0) scale(1.12)'},{target:el.closest('section')||el,offset:['start end','end start']});return}
  if(hero&&hero.contains(el)){play(el);return}
  V(el,function(){play(el)},{amount:.2});
});
var heroTreat=hero&&hero.getAttribute('data-rk-treatment');
if(hero&&(!heroTreat||heroTreat==='subtle')){var mediaBox=hero.querySelector('.rk-hero__media');var media=hero.querySelectorAll('.rk-hero__media .rk-frame');
  if(media.length&&mediaBox&&!mediaBox.closest('[data-rk-anim]')&&!mediaBox.querySelector('[data-rk-anim]:not([data-rk-anim="parallax"])'))A(media,{opacity:[0,1],transform:['scale(1.06)','none']},{duration:1.2,delay:M.stagger(.12,{startDelay:seq==='editorial'?.5:0}),ease:E})}
var arr=function(l){return Array.prototype.slice.call(l||[])};
var treat=function(scope,k,start){
  if(k==='spread'){var box=scope.querySelector('.rk-collage');if(!box)return;var c=box.getBoundingClientRect(),cx=c.left+c.width/2,cy=c.top+c.height/2;
    arr(box.children).filter(shown).forEach(function(slot,i){var f=slot.classList.contains('rk-slot')?slot.querySelector('.rk-frame'):slot;if(!f)return;var r=slot.getBoundingClientRect();
      var dx=cx-(r.left+r.width/2),dy=cy-(r.top+r.height/2),turn=(i%2?7:-7)+i*2;
      A(f,{opacity:[0,1],transform:['translate('+dx.toFixed(0)+'px,'+dy.toFixed(0)+'px) rotate('+turn+'deg) scale(.7)','none']},{duration:1.15,delay:start+.09*i,ease:[.16,1,.3,1]})});return}
  if(k==='unveil'||k==='track'){var items=k==='track'?arr(scope.querySelectorAll('.rk-track>*')):arr(scope.querySelectorAll('.rk-frame'));
    items.filter(shown).forEach(function(item,i){var f=item.classList.contains('rk-frame')?item:item.querySelector('.rk-frame');var v=f&&f.querySelector('.rk-veil'),img=f&&f.querySelector('img'),d=start+(k==='track'?.16:.12)*i;
      if(v){v.style.transformOrigin=k==='track'||i%2?'right center':'left center';A(v,{transform:['scaleX(1)','scaleX(0)']},{duration:k==='track'?.75:.8,delay:d,ease:[.3,0,.2,1]})}
      if(img)A(img,{transform:[k==='track'?'translateX(-5%) scale(1.12)':'scale(1.18)','none']},{duration:1.4,delay:d,ease:E});
      if(k==='track')A(arr(item.children).filter(function(x){return x!==f&&!x.classList.contains('rk-slot')}),{opacity:[0,1],transform:['translateX(24px)','none']},{duration:.7,delay:d+.3,ease:E})})}
};
if(hero&&heroTreat&&heroTreat!=='subtle'){var first=hero.querySelector('.rk-hero__media .rk-frame');
  // photos below the first screen (a phone's stacked hero) move when they come into view, not unseen on load
  var below=first&&first.getBoundingClientRect().top>innerHeight*.6;
  var start=first?Math.min(offset(first),heroTreat==='unveil'?.15:1):0;
  if(below)V(first.closest('.rk-collage')||first,function(){treat(hero,heroTreat,0)},{amount:.6});else treat(hero,heroTreat,start)}
document.querySelectorAll('main section[data-rk-treatment]:not(#hero)').forEach(function(sec){var k=sec.getAttribute('data-rk-treatment');if(k==='subtle')return;
  var target=sec.querySelector(k==='track'?'.rk-track':k==='spread'?'.rk-collage':'.rk-frame')||sec;V(target,function(){treat(sec,k,0)},{amount:.25})});
if(matchMedia('(pointer:fine)').matches){
  document.querySelectorAll('[data-rk-hover="magnetic"]').forEach(function(el){
    el.addEventListener('pointermove',function(e){var r=el.getBoundingClientRect();el.style.transform='translate('+((e.clientX-r.left-r.width/2)*.28).toFixed(1)+'px,'+((e.clientY-r.top-r.height/2)*.36).toFixed(1)+'px)'});
    el.addEventListener('pointerleave',function(){el.style.transform=''});
  });
  document.querySelectorAll('[data-rk-tilt]').forEach(function(el){
    el.addEventListener('pointermove',function(e){var r=el.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;el.style.transform='perspective(900px) rotateX('+(-y*7).toFixed(2)+'deg) rotateY('+(x*9).toFixed(2)+'deg) translateY(-6px)'});
    el.addEventListener('pointerleave',function(){el.style.transform=''});
  });
}
})();`;

/** the scripts for the end of the page: Motion, then the kit's motion */
export const kitScripts = () => `<script>${MOTION_JS}</script><script>${KIT_JS}</script>`;
