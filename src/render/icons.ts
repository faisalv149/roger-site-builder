import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

// Lucide outline icons (theme.icons.set = "lucide"), inlined so generated sites load nothing extra.
const DIR = path.join(ROOT, 'node_modules', 'lucide-static', 'icons');
const ALIASES: Record<string, string> = { tool: 'wrench', 'alert-triangle': 'triangle-alert', 'check-circle': 'circle-check', 'help-circle': 'circle-help' };
const cache = new Map<string, string>();

function inner(name: string): string {
  const key = ALIASES[name] || name;
  if (cache.has(key)) return cache.get(key)!;
  let file = path.join(DIR, `${key}.svg`);
  if (!fs.existsSync(file)) file = path.join(DIR, 'circle-check.svg');
  const svg = fs.readFileSync(file, 'utf8');
  const body = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  cache.set(key, body);
  return body;
}

export function iconExists(name: string) {
  return fs.existsSync(path.join(DIR, `${ALIASES[name] || name}.svg`));
}

export function icon(name: string, opts: { size?: number; stroke?: number; cls?: string; label?: string } = {}): string {
  const size = opts.size ?? 24;
  const aria = opts.label ? `role="img" aria-label="${opts.label}"` : 'aria-hidden="true"';
  return `<svg class="ic ${opts.cls || ''}" ${aria} xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${opts.stroke ?? 1.75}" stroke-linecap="round" stroke-linejoin="round">${inner(name)}</svg>`;
}
