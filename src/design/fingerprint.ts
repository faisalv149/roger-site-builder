import sharp from 'sharp';

/**
 * A photo's identity, from its pixels: difference hashes across and down (greyscale, each pixel compared with its
 * right-hand and lower neighbour, 64 bits each) and its average colour, as "<16 hex><16 hex>-<rrggbb>". The same picture
 * at another size or compression gives the same or a very close fingerprint; a different picture of the same dimensions
 * does not. It is a lossy identity heuristic, not proof of ownership or a guarantee against collisions.
 */
export async function photoFingerprint(raw: Buffer): Promise<string> {
  const base = sharp(raw).rotate();
  const across = await base.clone().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  const down = await base.clone().greyscale().resize(8, 9, { fit: 'fill' }).raw().toBuffer();
  let h = '', v = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h += across[y * 9 + x] > across[y * 9 + x + 1] ? '1' : '0';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) v += down[y * 8 + x] > down[(y + 1) * 8 + x] ? '1' : '0';
  const { channels } = await base.clone().removeAlpha().stats();
  const rgb = [0, 1, 2].map((i) => Math.round(channels[Math.min(i, channels.length - 1)].mean).toString(16).padStart(2, '0')).join('');
  const hex = (bits: string) => BigInt(`0b${bits}`).toString(16).padStart(16, '0');
  return `${hex(h)}${hex(v)}-${rgb}`;
}

export const validFingerprint = (fp: unknown): fp is string => typeof fp === 'string' && /^[0-9a-f]{32}-[0-9a-f]{6}$/.test(fp);

const parse = (fp: string) => { const [bits, rgb = '000000'] = fp.split('-'); return { bits: BigInt(`0x${bits}`), rgb: [0, 2, 4].map((i) => parseInt(rgb.slice(i, i + 2), 16)) }; };
const popcount = (x: bigint) => { let n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };

/** how many of the 128 difference bits differ */
export function fingerprintDistance(a: string, b: string): number { return popcount(parse(a).bits ^ parse(b).bits); }

/** at most this many of the 128 bits differ for the same picture (resizing and re-compression move up to about a tenth; different pictures differ in about half) */
export const SAME_PHOTO_BITS = 16;
/** and its average colour moves by at most this much per channel */
const SAME_COLOUR = 24;
/**
 * A fingerprint with almost no structure (a blank, flat or smoothly shaded picture) cannot tell two such pictures apart,
 * so it never establishes identity.
 */
export function featureless(fp: string): boolean { const set = popcount(parse(fp).bits); return set <= 6 || set >= 122; }

/**
 * The one candidate that is this picture: within SAME_PHOTO_BITS and the same average colour, and the only candidate
 * that close. None, two that are both close, or a featureless picture is "not established": the caller must look at the
 * photo again, never borrow a description.
 */
export function samePhoto<T extends { fp?: string }>(fp: string, candidates: T[]): T | undefined {
  if (!validFingerprint(fp) || featureless(fp)) return undefined;
  const colour = parse(fp).rgb;
  const close = candidates.filter((c) => validFingerprint(c.fp) && !featureless(c.fp) && fingerprintDistance(fp, c.fp) <= SAME_PHOTO_BITS && parse(c.fp).rgb.every((v, i) => Math.abs(v - colour[i]) <= SAME_COLOUR));
  return close.length === 1 ? close[0] : undefined;
}
