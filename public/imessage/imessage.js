/* Roger iMessage demo: a stand-in for the iMessage gateway. Posts each text to /api/imessage/inbound and
   renders the replies the way iPhone does (text bubbles, then a rich link preview built from og:image + og:title). */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
const timeNow = (ampm = true) => {
  const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return ampm ? t : t.replace(/\s?[AP]M$/, ''); // \s also covers the narrow no-break space newer ICU puts before AM
};
const postJson = async (path, body) => {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
};

// One conversation per browser until "Restart". The server saves every message (data/conversations/),
// so a reload or a server restart picks the conversation back up.
const FROM_KEY = 'roger-imsg-from';
const newFrom = () => `imsg-${Math.random().toString(36).slice(2, 8)}`;
const stored = (() => { try { return localStorage.getItem(FROM_KEY); } catch { return null; } })();
let from = stored || newFrom();
// remembered once the first message is sent, so a fresh visitor never asks for a conversation that doesn't exist
const keepFrom = (id) => { try { if (id) localStorage.setItem(FROM_KEY, id); else localStorage.removeItem(FROM_KEY); } catch { /* storage blocked: this tab only */ } };
const log = $('#log');
const input = $('#text');
const START = ['Hi Roger'];
let busy = false;
let last = null; // { side, bubble } of the newest message, for grouping and tails
let receipt = null;

const scrollDown = () => { log.scrollTop = log.scrollHeight; };

function addRow(side, html) {
  const row = document.createElement('div');
  row.className = `row ${side} new`;
  if (last?.side === side) last.bubble.classList.remove('tail');
  else if (last) row.classList.add('gap');
  row.innerHTML = html;
  const bubble = row.firstElementChild;
  bubble.classList.add('tail');
  log.append(row);
  last = { side, bubble };
  setTimeout(() => row.classList.remove('new'), 300);
  scrollDown();
  return row;
}

const addText = (side, text) => addRow(side, `<div class="bubble">${side === 'in' ? linkify(text) : esc(text)}</div>`);

function addLink(r) {
  const row = addRow('in', `<a class="bubble link" href="${esc(r.url)}" target="_blank" rel="noopener">${r.image ? `<img src="${esc(r.image)}" alt="">` : ''}<span class="meta"><b>${esc(r.title || host(r.url))}</b><span class="host">${esc(host(r.url))}</span></span></a>`);
  const img = row.querySelector('img');
  if (img) { img.addEventListener('load', scrollDown); img.addEventListener('error', () => img.remove()); }
}

function setReceipt(afterRow, html, failed = false) {
  receipt?.remove();
  receipt = document.createElement('div');
  receipt.className = `receipt${failed ? ' failed' : ''}`;
  receipt.innerHTML = html;
  afterRow.after(receipt);
  scrollDown();
  return receipt;
}

let typingRow = null;
function showTyping() {
  if (typingRow) return;
  typingRow = document.createElement('div');
  typingRow.className = `row in${last?.side === 'in' ? '' : ' gap'}`;
  typingRow.innerHTML = '<div class="bubble typing" aria-label="Roger is typing"><i></i><i></i><i></i></div>';
  log.append(typingRow);
  scrollDown();
}
function hideTyping() { typingRow?.remove(); typingRow = null; }

function setSuggest(list) {
  $('#suggest').innerHTML = list.map((q) => `<button type="button">${esc(q)}</button>`).join('');
  $('#suggest').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => send(b.textContent)));
}

const updateSend = () => {
  $('#send').disabled = busy || !input.value.trim();
  document.body.toggleAttribute('data-busy', busy); // lets scripts/imessage-e2e.ts wait for Roger to finish
};

// iMessage gets the text and the link as separate messages; pace them like a person typing
async function showReplies(replies) {
  const parts = replies.flatMap((r) => [r.text && (() => addText('in', r.text)), r.url && (() => addLink(r))].filter(Boolean));
  for (const [i, part] of parts.entries()) {
    if (i > 0) { showTyping(); await sleep(650); }
    hideTyping();
    part();
  }
}

/** A message Roger sends later (the preview after "On it"): keep "typing" up and check the saved conversation. */
async function waitForLater(count) {
  showTyping();
  for (;;) {
    await sleep(1500);
    const c = await fetch(`/api/conversations/${encodeURIComponent(from)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!c || c.pending) continue;
    if (c.messages.length <= count) { hideTyping(); return [{ quickReplies: ['Is my preview ready?'] }]; } // the build died (server restart); Roger explains on the next text
    const later = c.messages.slice(count).filter((m) => m.dir === 'out');
    await showReplies(later);
    return later;
  }
}

async function send(raw) {
  const text = String(raw || '').trim();
  if (!text || busy) return;
  busy = true;
  updateSend();
  setSuggest([]);
  keepFrom(from);
  const row = addText('out', text);
  setReceipt(row, 'Delivered');
  await sleep(300);
  showTyping();
  try {
    // async: a build answers "On it" now and sends the preview when it's done, however long that takes
    const res = await postJson('/api/imessage/inbound', { from, text, async: true });
    setReceipt(row, `<b>Read</b> ${timeNow()}`);
    let replies = res.replies;
    await showReplies(replies);
    if (res.pending) replies = await waitForLater(res.messageCount);
    hideTyping();
    setSuggest(replies.at(-1)?.quickReplies || []);
    seen = await savedCount();
  } catch (e) {
    hideTyping();
    console.error('[imessage]', e);
    const r = setReceipt(row, `Not Delivered · <button type="button">Tap to try again</button>`, true);
    r.querySelector('button').addEventListener('click', () => {
      r.remove(); receipt = null;
      row.remove(); // resend as a fresh bubble
      const prev = [...log.querySelectorAll('.row')].at(-1);
      last = prev ? { side: prev.classList.contains('out') ? 'out' : 'in', bubble: prev.firstElementChild } : null;
      last?.bubble.classList.add('tail');
      send(text);
    });
  } finally {
    busy = false;
    updateSend();
  }
}

// a new conversation; the old one stays saved (and listed in the Studio's Sites tab)
async function restart() {
  if (busy) return;
  from = newFrom();
  keepFrom(null); // a reload now starts fresh too
  $('#today').textContent = `Today ${timeNow()}`;
  log.querySelectorAll('.row, .receipt').forEach((n) => n.remove());
  last = null; receipt = null;
  setSuggest(START);
  input.value = '';
  updateSend();
  input.focus({ preventScroll: true });
}

$('#compose').addEventListener('submit', (e) => { e.preventDefault(); const t = input.value; input.value = ''; send(t); });
input.addEventListener('input', updateSend);
$('#restart').addEventListener('click', restart);
$('#restartTop').addEventListener('click', restart);

/* status bar clock + conversation timestamp */
$('#clock').textContent = timeNow(false);
setInterval(() => { $('#clock').textContent = timeNow(false); }, 15_000);
$('#today').textContent = `Today ${timeNow()}`;
setSuggest(START);

/* messages Roger sends on its own later (the new site's score after a preview): checked quietly every few seconds */
let seen = 0;
const savedCount = () => fetch(`/api/conversations/${encodeURIComponent(from)}`).then((r) => (r.ok ? r.json() : null)).then((c) => c?.messages?.length || 0).catch(() => 0);
setInterval(async () => {
  if (busy || document.hidden || !seen) return;
  const c = await fetch(`/api/conversations/${encodeURIComponent(from)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!c || c.pending || busy || c.messages.length <= seen) return;
  const later = c.messages.slice(seen).filter((m) => m.dir === 'out');
  seen = c.messages.length;
  if (!later.length) return;
  busy = true; updateSend();
  try { showTyping(); await sleep(600); await showReplies(later); hideTyping(); if (later.at(-1)?.quickReplies) setSuggest(later.at(-1).quickReplies); } finally { busy = false; updateSend(); }
}, 4000);

/* pick up a saved conversation after a reload */
if (stored) fetch(`/api/conversations/${encodeURIComponent(from)}`).then((r) => (r.ok ? r.json() : null)).then((c) => {
  if (!c?.messages?.length || log.querySelector('.row')) return; // nothing saved, or the user already started typing
  const started = new Date(c.startedAt);
  $('#today').textContent = `${started.toDateString() === new Date().toDateString() ? 'Today' : started.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${started.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  let lastOut = null;
  for (const m of c.messages) {
    if (m.dir === 'in') { lastOut = addText('out', m.text || ''); continue; }
    if (m.text) addText('in', m.text);
    if (m.url) addLink(m);
  }
  if (lastOut) setReceipt(lastOut, c.messages[c.messages.length - 1].dir === 'out' ? '<b>Read</b>' : 'Delivered');
  seen = c.messages.length;
  setSuggest([...c.messages].reverse().find((m) => m.dir === 'out')?.quickReplies || START);
  if (c.pending) { // reloaded while the preview is still building
    busy = true; updateSend(); setSuggest([]);
    return waitForLater(c.messages.length).then((later) => { hideTyping(); setSuggest(later.at(-1)?.quickReplies || []); }).finally(async () => { seen = await savedCount(); busy = false; updateSend(); });
  }
}).catch(() => {});

/* presenter panel: what's live, what's mocked, and things to try */
fetch('/api/health').then((r) => r.json()).then((h) => {
  const claude = h.claudeVia === 'cli' ? ['on', `Local Claude Code · ${h.model}`] : h.claudeVia === 'api' ? ['on', `Claude API · ${h.model}`] : ['', 'Off (template replies)'];
  $('#status').innerHTML = `<div><dt>Google data</dt><dd class="${h.mock ? 'warn' : 'on'}">${h.mock ? 'Sample businesses (mock)' : 'Live Google Places'}</dd></div>`
    + `<div><dt>Claude</dt><dd class="${claude[0]}">${esc(claude[1])}</dd></div>`;
  const tries = h.mock
    ? ['Hi', 'Summit Peak Roofing 78704', 'BlueLine Plumbing Denver', 'Greenway Lawn Landscape Charlotte', 'ComfortPro Heating Air Tempe']
    : ['Hi'];
  $('#tries').innerHTML = tries.map((t) => `<button type="button">${esc(t)}</button>`).join('')
    + `<p>${h.mock ? 'Summit Peak has an outdated website, so it gets the audit step. The others go straight to the new-site offer.' : 'Then send a real business name and ZIP, a Google Maps link, or the business website.'}</p>`;
  $('#tries').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => send(b.textContent)));
}).catch(() => {});

if (matchMedia('(min-width: 821px)').matches) input.focus({ preventScroll: true });
