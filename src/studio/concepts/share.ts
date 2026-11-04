import { randomBytes } from 'node:crypto';
import express from 'express';
import { config } from '../../config.js';
import { readOut } from '../../files.js';
import { studioDocs } from '../../store.js';

/**
 * A client's preview link for one chosen concept: /p/<token>/. The token is random (128 bits) and is the only key:
 * the link opens that concept's homepage and its own pictures, nothing else (not the Studio, not the other concepts,
 * not the set's data), with no password, marked noindex. A bar across the top says it is a preview, not a published
 * website; publishing stays behind its gate.
 */
export interface Share { token: string; setId: string; conceptId: string; businessKey: string; revision: number; createdAt: string }

export const shareUrl = (token: string) => `${config.publicBaseUrl}/p/${token}/`;

export async function createShare(s: Omit<Share, 'token' | 'createdAt'>): Promise<Share> {
  const existing = (await studioDocs.list<Share>('studio-shares')).find((x) => x.setId === s.setId && x.conceptId === s.conceptId);
  if (existing) return existing;
  const share: Share = { ...s, token: randomBytes(16).toString('hex'), createdAt: new Date().toISOString() };
  await studioDocs.put('studio-shares', share.token, share);
  return share;
}

const BAR = '<div style="position:relative;z-index:100;background:#111827;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:8px 16px;text-align:center">Homepage concept preview from Roger, not a published website. Facts, photos and prices are still being confirmed with the owner.</div>';
const headers = { 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'cache-control': 'private, max-age=300' };

export const shareRoutes = express.Router();
const load = (token: string) => (/^[a-f0-9]{32}$/.test(token) ? studioDocs.get<Share>('studio-shares', token) : Promise.resolve(undefined));

shareRoutes.get('/:token/img/:file', async (req, res) => {
  const share = await load(String(req.params.token));
  const file = String(req.params.file);
  if (!share || !/^[A-Za-z0-9_.-]{1,80}\.(jpg|png)$/.test(file)) return res.status(404).send('Not found');
  const data = await readOut(`studio-concepts/${share.setId}/img/${file}`);
  if (!data) return res.status(404).send('Not found');
  res.set({ ...headers, 'cache-control': 'private, max-age=86400' }).type(file.endsWith('.png') ? 'png' : 'jpg').send(data);
});
shareRoutes.get('/:token', async (req, res) => {
  const share = await load(String(req.params.token));
  if (!share) return res.status(404).send('This preview link is not valid.');
  // relative picture paths (img/...) need the trailing slash
  if (!req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(301, `/p/${share.token}/`);
  const html = await readOut(`studio-concepts/${share.setId}/${share.conceptId}.html`);
  if (!html) return res.status(404).send('This preview is no longer available.');
  res.set(headers).type('html').send(html.toString('utf8').replace(/<body>/, `<body>${BAR}`));
});
