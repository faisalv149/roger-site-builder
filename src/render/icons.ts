import * as lucide from 'lucide-static';

// Lucide outline icons (theme.icons.set = "lucide"), inlined so generated sites load nothing extra.
// Taken from lucide-static's exports (an SVG string per PascalCase name) rather than its icon files, so a bundler
// (Vercel) ships them without extra configuration.
const ICONS = lucide as unknown as Record<string, string>;
const ALIASES: Record<string, string> = { tool: 'wrench', 'alert-triangle': 'triangle-alert', 'check-circle': 'circle-check', 'help-circle': 'circle-help' };
const cache = new Map<string, string>();
const pascal = (kebab: string) => kebab.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
const svgFor = (name: string): string | undefined => ICONS[pascal(ALIASES[name] || name)];

function inner(name: string): string {
  const key = ALIASES[name] || name;
  if (cache.has(key)) return cache.get(key)!;
  const svg = svgFor(name) || svgFor('circle-check')!;
  const body = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  cache.set(key, body);
  return body;
}

export function iconExists(name: string) {
  return !!svgFor(name);
}

export function icon(name: string, opts: { size?: number; stroke?: number; cls?: string; label?: string } = {}): string {
  const size = opts.size ?? 24;
  const aria = opts.label ? `role="img" aria-label="${opts.label}"` : 'aria-hidden="true"';
  return `<svg class="ic ${opts.cls || ''}" ${aria} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${opts.stroke ?? 1.75}" stroke-linecap="round" stroke-linejoin="round">${inner(name)}</svg>`;
}
