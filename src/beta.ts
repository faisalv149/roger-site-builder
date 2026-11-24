/**
 * The invite-only client beta of the custom iMessage flow.
 *
 * Invites: staff create one per tester; the tester opens /imessage/?intake=custom&invite=<token>. Only a hash of the
 * token is stored. The token unlocks the custom simulator and that tester's own conversations, nothing else: no staff
 * page, no other conversation, no Studio API. A conversation is bound to the invite that started it.
 *
 * Staff: every review page and review action needs staff authentication. With a Studio password, that is the password;
 * without one, only a local request when the beta is off (local development). In the beta without a password, staff
 * actions are refused (fail closed).
 *
 * Caps: per invite, a number of businesses, versions per business and AI spend; one job in flight at a time; and a daily
 * spend cap across all invites. Each research job and generation is recorded on the invite when it starts (its actual
 * cost once known, a reserve while it runs), so a cap holds even when a conversation is restarted.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { config } from './config.js';
import { studioDocs } from './store.js';

export interface BetaCharge { kind: 'research' | 'version'; from: string; runId: string; n?: number; jobId?: string; at: string }
export interface BetaInvite {
  id: string; tokenHash: string; label: string; createdAt: string; revokedAt?: string;
  /** conversations started with this invite (a conversation belongs to one invite) */
  froms: string[];
  charges: BetaCharge[];
  limits: { spendUsd: number; businesses: number; versionsPerBusiness: number };
}
/** what a job costs before its actual cost is known (a little above what a full site has cost so far) */
export const RESERVE_USD = { research: 0.25, version: 1.5 };

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const docId = (hash: string) => `inv_${hash.slice(0, 24)}`;
const now = () => new Date().toISOString();

export async function createInvite(label: string, limits: Partial<BetaInvite['limits']> = {}): Promise<{ invite: BetaInvite; token: string; url: string | undefined }> {
  const token = randomBytes(24).toString('base64url');
  const tokenHash = sha(token);
  const invite: BetaInvite = { id: docId(tokenHash), tokenHash, label: label.slice(0, 80) || 'tester', createdAt: now(), froms: [], charges: [], limits: { spendUsd: limits.spendUsd ?? config.beta.inviteSpendUsd, businesses: limits.businesses ?? config.beta.inviteBusinesses, versionsPerBusiness: limits.versionsPerBusiness ?? config.beta.versionsPerBusiness } };
  await studioDocs.put('beta-invites', invite.id, invite);
  return { invite, token, url: config.publicOrigin ? `${config.publicOrigin}/imessage/?intake=custom&invite=${token}` : undefined };
}
export async function inviteForToken(token: string | undefined): Promise<BetaInvite | undefined> {
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return undefined;
  const h = sha(token);
  const inv = await studioDocs.get<BetaInvite>('beta-invites', docId(h));
  if (!inv || inv.revokedAt || !timingSafeEqual(Buffer.from(inv.tokenHash), Buffer.from(h))) return undefined;
  return inv;
}
export const getInvite = (id: string) => studioDocs.get<BetaInvite>('beta-invites', id);
export const listInvites = () => studioDocs.list<BetaInvite>('beta-invites');
export async function revokeInvite(id: string) { const inv = await getInvite(id); if (inv) { inv.revokedAt = now(); await studioDocs.put('beta-invites', id, inv); } return inv; }

/** bind a conversation to the invite starting it; a conversation already bound to another invite is refused */
export async function bindConversation(invite: BetaInvite, from: string): Promise<boolean> {
  if (invite.froms.includes(from)) return true;
  if ((await listInvites()).some((i) => i.id !== invite.id && i.froms.includes(from))) return false;
  invite.froms.push(from);
  await studioDocs.put('beta-invites', invite.id, invite);
  return true;
}
export async function inviteOfConversation(from: string): Promise<BetaInvite | undefined> {
  return (await listInvites()).find((i) => i.froms.includes(from));
}

/** the request's staff authentication: the Studio password; without one, a local request outside the beta */
export function isStaff(req: Request): boolean {
  if (config.studioPassword) {
    const [scheme, b64] = (req.headers.authorization || '').split(' ');
    const given = scheme === 'Basic' && b64 ? Buffer.from(b64, 'base64').toString('utf8') : '';
    return !!given && timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(`${config.studioUser}:${config.studioPassword}`).digest());
  }
  if (config.beta.enabled) return false; // fail closed: the beta needs a staff password
  const ip = req.socket.remoteAddress ?? '';
  return /^(::1|127\.|::ffff:127\.)/.test(ip);
}

/** what an invite's recorded jobs cost: actual costs where known, reserves while running */
export async function spendOf(charges: BetaCharge[], costOf: (c: BetaCharge) => Promise<number | undefined>): Promise<number> {
  let total = 0;
  for (const c of charges) total += (await costOf(c)) ?? RESERVE_USD[c.kind];
  return total;
}

/**
 * Why a job may not start for this invite now (undefined: it may). Businesses, versions per business, the invite's
 * spend and the day's spend across all invites, counting the reserve for the job about to start.
 */
export async function capProblem(inviteId: string, kind: BetaCharge['kind'], ctx: { runId: string; n?: number }, costOf: (c: BetaCharge) => Promise<number | undefined>): Promise<string | undefined> {
  const inv = await getInvite(inviteId);
  if (!inv || inv.revokedAt) return 'the invite is no longer active';
  // one job at a time per invite (a running job's cost is not known yet); this run's own earlier charges excepted
  for (const c of inv.charges) if (c.runId !== ctx.runId && (await costOf(c)) === undefined) return 'another preview on this invite is still being made';
  if (kind === 'research' && new Set(inv.charges.filter((c) => c.kind === 'research').map((c) => c.runId)).size >= inv.limits.businesses) return `the invite's limit of ${inv.limits.businesses} business(es) is reached`;
  if (kind === 'version' && inv.charges.filter((c) => c.kind === 'version' && c.runId === ctx.runId).length >= inv.limits.versionsPerBusiness) return `the invite's limit of ${inv.limits.versionsPerBusiness} version(s) per business is reached`;
  const spent = await spendOf(inv.charges, costOf);
  if (spent + RESERVE_USD[kind] > inv.limits.spendUsd) return `the invite's AI spend cap of $${inv.limits.spendUsd} would be passed ($${spent.toFixed(2)} so far)`;
  const today = now().slice(0, 10);
  const day = (await listInvites()).flatMap((i) => i.charges.filter((c) => c.at.startsWith(today)));
  const daySpent = await spendOf(day, costOf);
  if (daySpent + RESERVE_USD[kind] > config.beta.dailySpendUsd) return `the beta's daily AI spend cap of $${config.beta.dailySpendUsd} would be passed`;
  return undefined;
}
export async function recordCharge(inviteId: string, charge: Omit<BetaCharge, 'at'>): Promise<void> {
  const inv = await getInvite(inviteId);
  if (!inv) return;
  inv.charges.push({ ...charge, at: now() });
  await studioDocs.put('beta-invites', inviteId, inv);
}
