/*
 * Staff view of custom sites made from iMessage conversations: one accordion per business (closed, it shows the
 * version status, versions, sent, total cost and time) and one per version (closed: status, cost, time, attempts,
 * checks). What needs attention opens by default; what staff open or close stays that way across the refresh.
 */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const secs = (ms) => (ms == null ? '–' : ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const usd = (n) => (n == null ? '–' : `$${Number(n).toFixed(3)}`);
const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };
/** repeated notes of one kind (for example, many website photos without a description) as one line with a count */
const grouped = (items) => {
  const by = new Map();
  for (const i of items ?? []) { const m = String(i).match(/^research note: (img_[a-z0-9]+|gph_[a-z0-9]+): (.*)$/); const k = m ? `research note: ${m[2]}` : i; by.set(k, [...(by.get(k) ?? []), m ? m[1] : null]); }
  return [...by].map(([k, ids]) => (ids.length > 1 && ids[0] ? `${k} (${ids.length} photos, left out: ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? '…' : ''})` : ids[0] ? `${k} (${ids[0]})` : k));
};
const list = (items, cls) => (items?.length ? `<ul class="checks ${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
const fact = (label, value) => `<span class="fact">${esc(label)} <b>${esc(value)}</b></span>`;
const STATUS = { review: 'waiting', generating: 'generating', sent: 'sent', failed: 'failed', rejected: 'rejected' };
let acting = false;

/** what staff opened or closed (kept across the refresh); otherwise what needs attention is open */
const userOpen = new Map();
let filter = 'all', query = '', all = [];
const needsAttention = (c) => c.run.stage === 'failed' || c.versions.some((v) => v.status === 'review' || v.status === 'generating') || c.versions.at(-1)?.status === 'failed';
const openAttr = (key, byDefault) => ((userOpen.get(key) ?? byDefault) ? ' open' : '');

function version(c, v, latest) {
  const j = v.job;
  const key = `${c.from}#${v.n}`;
  const pages = j?.pages?.length ? `<div class="pages">${j.pages.map((p) => `<a href="${esc(p.staffUrl)}" target="_blank" rel="noopener">${esc(p.slug === 'home' ? 'Home' : p.slug[0].toUpperCase() + p.slug.slice(1))}</a>`).join('')}</div>` : '';
  const qa = j?.review?.pages?.length ? `<div class="qa-scroll"><table class="qa"><thead><tr><th>Page</th><th>Width</th><th>Checks</th><th>Photo credits shown</th></tr></thead><tbody>${j.review.pages.map((p) => `<tr><td>${esc(p.page)}</td><td>${p.width}px</td><td>${p.pass ? 'pass' : '<span class="err">fail</span>'}</td><td>${p.credits.visible}/${p.credits.required}</td></tr>`).join('')}</tbody></table></div>` : '';
  const resume = v.status === 'failed' && j?.status === 'failed' && j?.stage === 'pages' && j?.idea ? `<div class="actions"><button class="reject" data-from="${esc(c.from)}" data-n="${v.n}" data-d="resume">Resume the inner pages once (reuses the accepted homepage)</button></div>` : '';
  const recheck = v.status === 'failed' && j?.status === 'needs-review' ? `<div class="actions"><button class="reject" data-from="${esc(c.from)}" data-n="${v.n}" data-d="recheck">Run the checks again (no new generation)</button></div>` : '';
  const act = v.status === 'review' ? `<div class="actions"><input type="text" aria-label="Note for version ${v.n} (optional for send, reason for reject)" placeholder="Note (optional to send; the reason to reject)" data-note="${v.n}"><button class="send" data-from="${esc(c.from)}" data-n="${v.n}" data-d="send">Send link to customer</button><button class="reject" data-from="${esc(c.from)}" data-n="${v.n}" data-d="reject">Reject</button></div>` : '';
  const blocking = j?.checks?.blocking?.length ?? 0, staff = j?.checks?.staff?.length ?? 0;
  const checks = v.status === 'generating' ? '' : blocking ? fact('blocking', blocking) : j?.review?.ran ? fact('checks', j.review.pass ? 'passed' : 'failed') : '';
  return `<details class="version" data-key="${esc(key)}"${openAttr(key, latest && ['review', 'failed', 'generating'].includes(v.status))}>
    <summary><span class="chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span><h3>Version ${v.n}</h3><span class="pill ${esc(v.status)}">${esc(STATUS[v.status] ?? v.status)}</span>${v.reused ? '<span class="pill">reused a just-made job</span>' : ''}
      <span class="vfacts">${fact('cost', usd(v.costUsd))}${fact('time', secs(v.ms))}${v.attempts != null ? fact('attempts', v.attempts) : ''}${checks}${staff ? fact('to check', staff) : ''}${v.sentAt ? fact('sent', ago(v.sentAt)) : ''}</span></summary>
    <div class="version-body">
      <p class="meta">Job <code>${esc(v.jobId ?? '–')}</code>${j ? ` · revision ${j.rev}` : ''}${v.url ? ` · customer link <a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.url)}</a> sent ${esc(new Date(v.sentAt).toLocaleString())}` : ''}${v.reviewer ? ` · by ${esc(v.reviewer)}` : ''}${v.note ? ` · note: ${esc(v.note)}` : ''}</p>
      ${j?.idea ? `<p class="idea">Design idea: ${esc(j.idea)}</p>` : ''}${pages}${qa}
      ${v.error ? `<p class="err"><strong>Why it can't be sent:</strong> ${esc(v.error)}</p>` : ''}
      ${v.status === 'generating' ? '<p class="small">Being generated. Its checks run when it finishes.</p>' : ''}
      ${v.status !== 'generating' && blocking ? `<strong>Blocking</strong>${list(j.checks.blocking, 'blocking')}` : ''}
      ${v.status !== 'generating' && staff ? `<strong>Check before sending</strong>${list(grouped(j.checks.staff), 'staff')}` : ''}
      ${act}${recheck}${resume}
    </div></details>`;
}

function convo(c) {
  const r = c.run, res = r.research, last = c.versions.at(-1);
  const cost = (res?.costUsd ?? 0) + c.versions.reduce((t, v) => t + (v.costUsd ?? 0), 0);
  const time = (res?.ms ?? 0) + c.versions.reduce((t, v) => t + (v.ms ?? 0), 0);
  const sent = c.versions.filter((v) => v.status === 'sent').length;
  const state = r.stage === 'failed' ? '<span class="pill failed">research failed</span>' : last ? `<span class="pill ${esc(last.status)}">v${last.n} ${esc(STATUS[last.status] ?? last.status)}</span>` : '<span class="pill">researching</span>';
  const chatKey = `${c.from}#chat`;
  return `<details class="convo" data-key="${esc(c.from)}"${openAttr(c.from, needsAttention(c))}>
    <summary><span class="chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span>
      <span class="sum-title"><b>${esc(c.business)}</b> ${state}${r.approved ? ` <span class="pill approved">approved v${r.approved.n}</span>` : ''}<span class="sum-sub">${esc(c.from)} · updated ${esc(ago(c.updatedAt))}</span></span>
      <span class="facts">${fact('versions', c.versions.length)}${fact('sent', sent)}${fact('total cost', usd(cost))}${fact('total time', secs(time))}</span>
    </summary>
    <div class="convo-body">
      <p class="meta">Conversation <code>${esc(c.from)}</code> · listing <code>${esc(r.placeId)}</code>${r.website ? ` · website ${esc(r.website)}` : ' · no website'} · updated ${esc(new Date(c.updatedAt).toLocaleString())}</p>
      <p class="meta">Research: ${res ? `${res.reused ? 'saved brief reused' : 'new research'} (${esc(res.reason)}) · ${secs(res.ms)} · ${usd(res.costUsd)}` : 'not started'}${r.businessKey ? ` · brief <code>${esc(r.businessKey)}</code> r${esc(r.revision)}` : ''}${r.stage === 'failed' ? ` · <span class="err">failed: ${esc(r.error)}</span>` : ''}${r.approved ? ` · <strong>customer approved version ${r.approved.n}</strong> (${esc(new Date(r.approved.at).toLocaleString())}; not published)` : ''}</p>
      ${c.versions.map((v, i) => version(c, v, i === c.versions.length - 1)).join('')}
      <details class="chatlog" data-key="${esc(chatKey)}"${openAttr(chatKey, false)}><summary>Customer conversation (${c.messages.length} messages)</summary><div class="chat">${c.messages.map((m) => `<div class="${m.dir === 'in' ? 'in' : 'out'}">${esc(m.text)}${m.title ? `${m.text ? '\n' : ''}[card] ${esc(m.title)}${m.subtitle ? ` · ${esc(m.subtitle)}` : ''}` : ''}${m.url && !String(m.text).includes(m.url) ? `\n${esc(m.url)}` : ''}</div>`).join('')}</div></details>
    </div></details>`;
}

function render() {
  const shown = all.filter((c) => (filter === 'all' || (filter === 'attention' ? needsAttention(c) : c.versions.some((v) => v.status === 'sent'))) && (!query || String(c.business).toLowerCase().includes(query)));
  const notes = Object.fromEntries([...document.querySelectorAll('[data-note]')].map((i) => [`${i.closest('details.convo')?.dataset.key}#${i.dataset.note}`, i.value]));
  const attention = all.filter(needsAttention).length;
  $('#status').textContent = all.length ? `${all.length} business(es) · ${attention} need attention · showing ${shown.length}` : 'No custom-site conversations yet. Start one at /imessage/?intake=custom.';

  $('#list').innerHTML = shown.length ? shown.map(convo).join('') : (all.length ? '<p class="empty">Nothing matches this view.</p>' : '');
  document.querySelectorAll('[data-note]').forEach((i) => { const k = `${i.closest('details.convo')?.dataset.key}#${i.dataset.note}`; if (notes[k]) i.value = notes[k]; });

}
// a staff toggle (a click, or Enter/Space, on a summary) is remembered: the refresh never reopens or closes what staff chose
document.addEventListener('click', (e) => {
  const s = e.target.closest('summary');
  const d = s?.parentElement;
  if (d?.matches('details[data-key]') && !e.target.closest('a,button,input')) userOpen.set(d.dataset.key, !d.open); // the state it is about to take
});

async function load() {
  if (acting) return;
  try {
    const r = await fetch('/api/studio/imessage-reviews');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    all = (await r.json()).conversations.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    render();
  } catch (e) { $('#status').textContent = `Could not load reviews: ${e.message}`; }
}
$('#filter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]');
  if (!b) return;
  filter = b.dataset.f;
  $('#filter').querySelectorAll('[data-f]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  render();
});
$('#search').addEventListener('input', () => { query = $('#search').value.trim().toLowerCase(); render(); });
$('#expand').addEventListener('click', () => document.querySelectorAll('details.convo').forEach((d) => { userOpen.set(d.dataset.key, true); d.open = true; }));
$('#collapse').addEventListener('click', () => document.querySelectorAll('details.convo, details.version').forEach((d) => { userOpen.set(d.dataset.key, false); d.open = false; }));

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-d]');
  if (!b || acting) return;
  const note = b.closest('.actions')?.querySelector('input')?.value.trim() ?? '';
  if (b.dataset.d === 'reject' && !note) { $('#status').textContent = 'Give a reason to reject (it is recorded; the customer gets a plain message).'; b.closest('.actions').querySelector('input').focus(); return; }
  acting = true; b.disabled = true;
  $('#status').textContent = b.dataset.d === 'send' ? 'Sending the link…' : b.dataset.d === 'reject' ? 'Rejecting…' : 'Working…';
  try {
    const r = await fetch(`/api/studio/imessage-reviews/${encodeURIComponent(b.dataset.from)}/${b.dataset.n}/${b.dataset.d}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) });
    const j = await r.json();
    $('#status').textContent = j.ok ? (b.dataset.d === 'send' ? `Sent: ${j.url}` : b.dataset.d === 'recheck' ? 'The checks ran again; a version that passes is sent to the customer automatically.' : b.dataset.d === 'resume' ? 'Resuming the inner pages (one attempt).' : 'Rejected. The customer was told, and keeps any earlier preview.') : `Not done: ${j.reason}`;
  } catch (err) { $('#status').textContent = `Failed: ${err.message}`; }
  acting = false; await load();
});

load();
setInterval(load, 10000);

/* tester invites: create (the link is shown once), list, revoke */
async function loadInvites() {
  try {
    const { invites } = await (await fetch('/api/studio/beta-invites')).json();
    $('#inv-list').innerHTML = invites.length ? invites.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((i) => `<li><strong>${esc(i.label)}</strong> · ${i.revokedAt ? '<span class="err">revoked</span>' : 'active'} · ${i.froms.length} conversation(s) · ${i.charges.length} job(s) · limits $${i.limits.spendUsd}, ${i.limits.businesses} business(es), ${i.limits.versionsPerBusiness} version(s) each · made ${esc(new Date(i.createdAt).toLocaleString())}${i.revokedAt ? '' : ` <button class="reject" data-revoke="${esc(i.id)}" type="button">Revoke</button>`}</li>`).join('') : '<li>No invites yet.</li>';
  } catch (e) { $('#inv-list').innerHTML = `<li class="err">Could not load invites: ${esc(e.message)}</li>`; }
}
$('#inv-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const label = $('#inv-label').value.trim();
  if (!label) return;
  const r = await (await fetch('/api/studio/beta-invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) })).json();
  $('#inv-new').hidden = false;
  $('#inv-new').innerHTML = r.url ? `Send this link to ${esc(r.label)} (shown once): <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>` : esc(r.note || r.error || 'Could not make the invite.');
  $('#inv-label').value = '';
  loadInvites();
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-revoke]');
  if (!b) return;
  b.disabled = true;
  await fetch(`/api/studio/beta-invites/${encodeURIComponent(b.dataset.revoke)}/revoke`, { method: 'POST' });
  loadInvites();
});
loadInvites();
