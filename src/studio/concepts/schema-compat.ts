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
