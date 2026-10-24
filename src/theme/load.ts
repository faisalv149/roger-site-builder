import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { PACKAGE_THEMES } from './package-themes.js';
import { themeSchema, SUPPORTED_VARIANTS, SECTION_IDS, type Theme } from './schema.js';

export interface ThemeEntry {
  id: string; // `${vertical}-${variant}` — identity comes from meta, never the filename
  vertical: string;
  variant: string;
  name: string;
  file: string;
  origin: 'package' | 'custom';
  theme: Theme;
  warnings: string[];
}

const KNOWN_TOP_LEVEL = new Set(Object.keys(themeSchema.shape));

export interface ValidationResult {
  ok: boolean;
  theme?: Theme;
  id?: string;
  errors: string[];
  warnings: string[];
}

export function validateTheme(raw: unknown): ValidationResult {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['theme.json must be a JSON object'], warnings };
  const parsed = themeSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      warnings,
    };
  }
  const t = parsed.data;
  for (const k of Object.keys(raw as object)) {
    if (!KNOWN_TOP_LEVEL.has(k)) warnings.push(`Unknown top-level key "${k}" kept as-is (not used by the renderer yet).`);
  }
  if (t.meta.schemaVersion !== 2) warnings.push(`schemaVersion is ${t.meta.schemaVersion}; renderer targets 2.`);
  if (!t.fontPairs.find((p) => p.id === t.defaultPair)) warnings.push(`defaultPair "${t.defaultPair}" not found in fontPairs; using the first pair.`);
  for (const s of t.sections) {
    if (!(SECTION_IDS as readonly string[]).includes(s)) warnings.push(`Section "${s}" is not a known section id and will be skipped.`);
    const l = t.sectionLayout[s];
    if (!l) { warnings.push(`Section "${s}" has no sectionLayout entry; the first supported variant will be used.`); continue; }
    const sup = SUPPORTED_VARIANTS[s];
    if (sup && !sup.includes(l.variant)) warnings.push(`sectionLayout.${s}.variant "${l.variant}" is not implemented; falling back to "${sup[0]}".`);
  }
  for (const s of Object.keys(t.sectionLayout)) {
    if (!t.sections.includes(s)) warnings.push(`sectionLayout has "${s}" but it is not in sections[]; it will not render.`);
  }
  if (t.grid.system === 'sidebar-12' && !t.grid.sidebar) warnings.push('grid.system is sidebar-12 but grid.sidebar is missing; rendering without a sidebar.');
  if (t.fontFaces.length) {
    for (const f of t.fontFaces) if ((f.weights?.length || 0) > 3) warnings.push(`fontFaces "${f.family}" has more than 3 weights.`);
  }
  return { ok: true, theme: t, id: `${t.meta.vertical}-${t.meta.variant}`, errors: [], warnings };
}

let cache: Map<string, ThemeEntry> | null = null;

function addTheme(raw: unknown, file: string, origin: ThemeEntry['origin'], into: Map<string, ThemeEntry>) {
  const v = validateTheme(raw);
  if (!v.ok || !v.theme || !v.id) { console.warn(`[themes] skipped ${file}: ${v.errors.slice(0, 3).join('; ')}`); return; }
  into.set(v.id, { id: v.id, vertical: v.theme.meta.vertical, variant: v.theme.meta.variant, name: v.theme.meta.name, file, origin, theme: v.theme, warnings: v.warnings });
}

// uploaded themes (data/themes); package themes come from src/theme/package-themes.ts
function loadDir(dir: string, origin: ThemeEntry['origin'], into: Map<string, ThemeEntry>) {
  if (!fs.existsSync(dir)) return;
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return walk(p);
      return e.name.endsWith('.theme.json') || (origin === 'custom' && e.name.endsWith('.json')) ? [p] : [];
    });
  for (const file of walk(dir)) {
    try { addTheme(JSON.parse(fs.readFileSync(file, 'utf8')), file, origin, into); } catch (e) { console.warn(`[themes] could not parse ${file}: ${(e as Error).message}`); }
  }
}

export function loadThemes(force = false): Map<string, ThemeEntry> {
  if (cache && !force) return cache;
  const m = new Map<string, ThemeEntry>();
  for (const p of PACKAGE_THEMES) addTheme(structuredClone(p.raw), path.join(config.dirs.themes, '..', p.file), 'package', m);
  loadDir(config.dirs.customThemes, 'custom', m); // custom uploads override package themes with the same id
  cache = m;
  return m;
}

export function getTheme(id: string): ThemeEntry | undefined {
  return loadThemes().get(id);
}

export function saveCustomTheme(raw: unknown): ValidationResult & { file?: string } {
  const v = validateTheme(raw);
  if (!v.ok || !v.id) return v;
  const file = path.join(config.dirs.customThemes, `${v.id}.theme.json`);
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));
  loadThemes(true);
  return { ...v, file };
}

/** Deep clone so build-time changes (pulled brand color etc.) never leak back into the stored theme. */
export function cloneTheme(t: Theme): Theme {
  return structuredClone(t);
}
