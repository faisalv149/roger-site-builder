import { config } from './config.js';

/**
 * Where Roger's later replies go (the preview after "On it", owner links). The conversation flow
 * (src/imessage/flow.ts) builds replies without knowing the channel; an adapter delivers them.
 *
 *  imessage  POSTs { from, replies } to IMESSAGE_OUTBOUND_URL, your iMessage gateway. Without one (local demos)
 *            nothing is sent: the stand-in iMessage page (/imessage) reads the saved conversation instead.
 *  mock      keeps replies in memory, for tests and QA (senders starting "mock:", or CHANNEL=mock).
 *
 * Roger itself does not connect to Apple's iMessage service; a gateway you run (e.g. on a Mac) does.
 */
export interface ChannelReply { text?: string; url?: string; image?: string; title?: string; quickReplies?: string[] }
export interface ChannelAdapter {
  id: 'imessage' | 'mock';
  /** true when the reply left this server (a gateway accepted it), false when it only went to the saved conversation */
  deliver(to: string, replies: ChannelReply[]): Promise<{ delivered: boolean; note?: string }>;
}

export const mockOutbox: { to: string; replies: ChannelReply[]; at: string }[] = [];

const imessage: ChannelAdapter = {
  id: 'imessage',
  async deliver(to, replies) {
    if (!config.imessageOutboundUrl) return { delivered: false, note: 'no IMESSAGE_OUTBOUND_URL: saved to the conversation only' };
    try {
      const r = await fetch(config.imessageOutboundUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: to, replies }), signal: AbortSignal.timeout(10_000) });
      if (!r.ok) console.warn(`[channel:imessage] outbound ${r.status} for ${to}`);
      return { delivered: r.ok, note: r.ok ? undefined : `gateway answered ${r.status}` };
    } catch (e) {
      console.warn(`[channel:imessage] outbound failed for ${to}: ${(e as Error).message}`);
      return { delivered: false, note: (e as Error).message };
    }
  },
};

const mock: ChannelAdapter = {
  id: 'mock',
  async deliver(to, replies) {
    mockOutbox.push({ to, replies, at: new Date().toISOString() });
    if (mockOutbox.length > 200) mockOutbox.shift();
    return { delivered: true };
  },
};

export function channelFor(to: string): ChannelAdapter {
  return process.env.CHANNEL === 'mock' || to.startsWith('mock:') ? mock : imessage;
}
