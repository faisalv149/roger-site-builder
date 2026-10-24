export const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'site';
}

const SMALL = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'llc', 'inc']);
export function titleCase(s: string): string {
  // Keep words that are already mixed/upper case (acronyms like HVAC, LLC brand styling)
  return s
    .split(/\s+/)
    .map((w, i) => {
      if (/[A-Z].*[A-Z]/.test(w) || /\d/.test(w)) return w;
      const lw = w.toLowerCase();
      if (i > 0 && SMALL.has(lw)) return lw === 'llc' || lw === 'inc' ? w : lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join(' ');
}

/** Truncate at a word boundary and add an ellipsis. */
export function truncateWords(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,.;:!\-–—\s]+$/, '')}…`;
}

export function digits(s: string | undefined): string {
  return (s || '').replace(/\D/g, '');
}

/** Fill only the placeholders the theme declares. Unknown/empty tokens are reported, not silently left in. */
export function fillPlaceholders(tpl: string, values: Record<string, string | number | undefined>, allowed: string[]): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = tpl.replace(/\{(\w+)\}/g, (m, key) => {
    if (!allowed.includes(m)) return m;
    const v = values[key];
    if (v === undefined || v === null || v === '') {
      missing.push(key);
      return m;
    }
    return String(v);
  });
  return { text, missing };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
