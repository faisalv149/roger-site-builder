/**
 * Structured outputs and our schemas.
 *
 * The Claude API constrains an answer to a JSON schema, but not every JSON-schema keyword: it rejects the request
 * (HTTP 400) for number limits (minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf), string lengths
 * (minLength, maxLength) and most array limits (minItems other than 0 or 1, maxItems, uniqueItems).
 *
 *   apiSchema(schema)          the schema as sent to Claude: those keywords removed (minItems above 1 becomes 1)
 *   schemaErrors(schema, data) the answer checked against the ORIGINAL schema, every keyword included
 *
 * Every structured-output call goes through `aiJson`, which sends `apiSchema(req.schema)` and checks the answer with
 * `schemaErrors(req.schema, …)` before the stage's own fact and design checks, so no limit is lost.
 */

type Schema = Record<string, unknown>;

/** keywords the API refuses, removed from what is sent (minItems is handled on its own) */
const UNSUPPORTED = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties']);
/** keywords whose value is a schema, a list of schemas, or a map of schemas */
const ONE = ['items', 'not', 'additionalItems', 'contains'];
const MANY = ['anyOf', 'allOf', 'oneOf', 'prefixItems'];
const MAP = ['properties', '$defs', 'definitions', 'patternProperties'];

const isObj = (x: unknown): x is Schema => !!x && typeof x === 'object' && !Array.isArray(x);

/** The schema as sent to the Claude API. A copy: the original is left as it is, for checking the answer. */
export function apiSchema<T>(schema: T): T {
  const walk = (s: unknown): unknown => {
    if (!isObj(s)) return s;
    const out: Schema = {};
    for (const [k, v] of Object.entries(s)) {
      if (UNSUPPORTED.has(k)) continue;
      if (k === 'minItems') { if (typeof v === 'number' && v > 0) out.minItems = 1; continue; }
      if (ONE.includes(k)) out[k] = walk(v);
      else if (MANY.includes(k) && Array.isArray(v)) out[k] = v.map(walk);
      else if (MAP.includes(k) && isObj(v)) out[k] = Object.fromEntries(Object.entries(v).map(([n, x]) => [n, walk(x)]));
      else out[k] = v;
    }
    return out;
  };
  return walk(schema) as T;
}

/** the API-unsupported keywords still present in a schema (empty for anything apiSchema returned) */
export function unsupportedKeywords(schema: unknown, at = '$'): string[] {
  if (!isObj(schema)) return [];
  const found: string[] = [];
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED.has(k) || (k === 'minItems' && typeof v === 'number' && v > 1)) found.push(`${at}: ${k}`);
    if (ONE.includes(k)) found.push(...unsupportedKeywords(v, `${at}.${k}`));
    else if (MANY.includes(k) && Array.isArray(v)) v.forEach((x, i) => found.push(...unsupportedKeywords(x, `${at}.${k}[${i}]`)));
    else if (MAP.includes(k) && isObj(v)) for (const [n, x] of Object.entries(v)) found.push(...unsupportedKeywords(x, `${at}.${n}`));
  }
  return found;
}

/**
 * A schema as a short contract for the prompt, when the answer is ordinary JSON rather than constrained output:
 *   string ≤240 · int 1–12 · number 15–20 · "a"|"b" · [item] (≤5) · X | null · { "key": … }
 * Every key of an object is required and no other key is allowed. `names` gives repeated parts a name, written once
 * above the object (e.g. TextRef = …) and referred to by that name.
 */
export function contractOf(schema: unknown, names: Record<string, unknown> = {}): string {
  const byJson = new Map(Object.entries(names).map(([n, s]) => [JSON.stringify(s), n]));
  const range = (s: Schema) => (typeof s.minimum === 'number' && typeof s.maximum === 'number' ? ` ${s.minimum}–${s.maximum}` : typeof s.minimum === 'number' ? ` ≥${s.minimum}` : typeof s.maximum === 'number' ? ` ≤${s.maximum}` : '');
  const render = (s: unknown, depth: number, top = false): string => {
    if (!isObj(s)) return 'any';
    const named = byJson.get(JSON.stringify(s));
    if (named && !top) return named;
    if (Array.isArray(s.anyOf)) return s.anyOf.map((b) => render(b, depth)).join(' | ');
    if (Array.isArray(s.enum)) return s.enum.map((v) => JSON.stringify(v)).join('|');
    switch (s.type) {
      case 'string': return `string${typeof s.maxLength === 'number' ? ` ≤${s.maxLength}` : ''}`;
      case 'integer': return `int${range(s)}`;
      case 'number': return `number${range(s)}`;
      case 'boolean': return 'boolean';
      case 'null': return 'null';
      case 'array': {
        const n = typeof s.minItems === 'number' && typeof s.maxItems === 'number' ? ` (${s.minItems}–${s.maxItems})` : typeof s.maxItems === 'number' ? ` (≤${s.maxItems})` : typeof s.minItems === 'number' ? ` (≥${s.minItems})` : '';
        return `[${render(s.items, depth)}]${n}`;
      }
      case 'object': {
        const props = Object.entries(isObj(s.properties) ? s.properties : {});
        const inner = props.map(([k, v]) => `${JSON.stringify(k)}: ${render(v, depth + 1)}`);
        const flat = `{ ${inner.join(', ')} }`;
        if (flat.length <= 110) return flat;
        const pad = '  '.repeat(depth + 1);
        return `{\n${inner.map((l) => `${pad}${l}`).join(',\n')}\n${'  '.repeat(depth)}}`;
      }
      default: return 'any';
    }
  };
  return [...Object.entries(names).map(([n, s]) => `${n} = ${render(s, 0, true)}`), render(schema, 0, true)].join('\n');
}

/**
 * The JSON object in an ordinary text answer: the whole text, else what a ```json fence holds, else the span from
 * the first "{" to the last "}". Throws (with the reason) when there is no single JSON object to read.
 */
export function parseJsonAnswer(text: string): Record<string, unknown> {
  const t = text.trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const tries = [t, fenced, t.includes('{') ? t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1) : undefined].filter((x): x is string => !!x);
  let why = 'no JSON object in the answer';
  for (const x of tries) {
    try {
      const v = JSON.parse(x) as unknown;
      if (isObj(v)) return v;
      why = `the answer is ${typeOf(v)}, not a JSON object`;
    } catch (e) { why = (e as Error).message; }
  }
  throw new Error(why.slice(0, 200));
}

const typeOf = (x: unknown) => (x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x);
const fits = (t: string, x: unknown) => (t === 'integer' ? Number.isInteger(x) : t === 'number' ? typeof x === 'number' && Number.isFinite(x) : typeOf(x) === t);
const show = (x: unknown) => { const s = JSON.stringify(x) ?? String(x); return s.length > 40 ? `${s.slice(0, 37)}…` : s; };

/**
 * Problems with `data` under `schema` (the original, every keyword included), each naming its place in the answer,
 * e.g. `$.sections[2].start: 14 is above the maximum 12`. Empty when the answer fits. At most `limit` are listed.
 */
export function schemaErrors(schema: unknown, data: unknown, limit = 30): string[] {
  const errs: string[] = [];
  const root = isObj(schema) ? schema : {};
  const resolve = (s: Schema): Schema => {
    const ref = s.$ref;
    if (typeof ref !== 'string' || !ref.startsWith('#/')) return s;
    const target = ref.slice(2).split('/').reduce<unknown>((o, p) => (isObj(o) ? o[p] : undefined), root);
    return isObj(target) ? resolve(target) : s;
  };
  const check = (raw: unknown, x: unknown, at: string, out: string[]) => {
    if (!isObj(raw) || out.length >= limit) return;
    const s = resolve(raw);
    if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
      const branches = (s.anyOf ?? s.oneOf) as unknown[];
      const tries = branches.map((b) => { const e: string[] = []; check(b, x, at, e); return e; });
      if (!tries.some((e) => !e.length)) {
        // the branch whose type matches explains the problem best; else say no branch fits
        const near = tries.find((e) => !e.some((m) => m.includes(' should be ')));
        out.push(...(near?.length ? near : [`${at}: ${show(x)} fits none of the allowed forms`]));
        return;
      }
    }
    if (Array.isArray(s.allOf)) for (const b of s.allOf) check(b, x, at, out);
    if (s.type !== undefined) {
      const types = (Array.isArray(s.type) ? s.type : [s.type]) as string[];
      if (!types.some((t) => fits(t, x))) { out.push(`${at}: ${show(x)} should be ${types.join(' or ')}`); return; }
    }
    if (Array.isArray(s.enum) && !s.enum.some((v) => JSON.stringify(v) === JSON.stringify(x))) out.push(`${at}: ${show(x)} is not one of ${s.enum.map(show).join(', ')}`);
    if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(x)) out.push(`${at}: should be ${show(s.const)}`);
    if (typeof x === 'number') {
      if (typeof s.minimum === 'number' && x < s.minimum) out.push(`${at}: ${x} is below the minimum ${s.minimum}`);
      if (typeof s.maximum === 'number' && x > s.maximum) out.push(`${at}: ${x} is above the maximum ${s.maximum}`);
      if (typeof s.exclusiveMinimum === 'number' && x <= s.exclusiveMinimum) out.push(`${at}: ${x} should be above ${s.exclusiveMinimum}`);
      if (typeof s.exclusiveMaximum === 'number' && x >= s.exclusiveMaximum) out.push(`${at}: ${x} should be below ${s.exclusiveMaximum}`);
      if (typeof s.multipleOf === 'number' && Math.abs(x / s.multipleOf - Math.round(x / s.multipleOf)) > 1e-9) out.push(`${at}: ${x} is not a multiple of ${s.multipleOf}`);
    }
    if (typeof x === 'string') {
      if (typeof s.minLength === 'number' && [...x].length < s.minLength) out.push(`${at}: text is shorter than ${s.minLength} characters`);
      if (typeof s.maxLength === 'number' && [...x].length > s.maxLength) out.push(`${at}: text is ${[...x].length} characters, over the limit of ${s.maxLength}`);
      if (typeof s.pattern === 'string' && !new RegExp(s.pattern, 'u').test(x)) out.push(`${at}: ${show(x)} does not match ${s.pattern}`);
    }
    if (Array.isArray(x)) {
      if (typeof s.minItems === 'number' && x.length < s.minItems) out.push(`${at}: ${x.length} item(s), at least ${s.minItems} needed`);
      if (typeof s.maxItems === 'number' && x.length > s.maxItems) out.push(`${at}: ${x.length} items, at most ${s.maxItems} allowed`);
      if (s.uniqueItems === true && new Set(x.map((v) => JSON.stringify(v))).size !== x.length) out.push(`${at}: items repeat`);
      if (isObj(s.items)) x.forEach((v, i) => check(s.items, v, `${at}[${i}]`, out));
    }
    if (isObj(x)) {
      const props = isObj(s.properties) ? s.properties : {};
      if (Array.isArray(s.required)) for (const k of s.required as string[]) if (!(k in x)) out.push(`${at}: "${k}" is missing`);
      for (const [k, v] of Object.entries(x)) {
        if (k in props) check(props[k], v, `${at}.${k}`, out);
        else if (s.additionalProperties === false) out.push(`${at}: "${k}" is not allowed`);
        else if (isObj(s.additionalProperties)) check(s.additionalProperties, v, `${at}.${k}`, out);
      }
    }
  };
  check(schema, data, '$', errs);
  return errs.slice(0, limit);
}
