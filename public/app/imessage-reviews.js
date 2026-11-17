/* Staff review of custom sites made from iMessage conversations: every version waits here until staff send or reject it. */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const secs = (ms) => (ms == null ? '–' : ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const usd = (n) => (n == null ? '–' : `$${Number(n).toFixed(3)}`);
/** repeated notes of one kind (for example, many website photos without a description) as one line with a count */
const grouped = (items) => {
  const by = new Map();
  for (const i of items ?? []) { const m = String(i).match(/^research note: (img_[a-z0-9]+|gph_[a-z0-9]+): (.*)$/); const k = m ? `research note: ${m[2]}` : i; by.set(k, [...(by.get(k) ?? []), m ? m[1] : null]); }
  return [...by].map(([k, ids]) => (ids.length > 1 && ids[0] ? `${k} (${ids.length} photos, left out: ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? '…' : ''})` : ids[0] ? `${k} (${ids[0]})` : k));
};
const list = (items, cls) => (items?.length ? `<ul class="checks ${cls}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
let acting = false;

function version(c, v) {
  const j = v.job;
  const pages = j?.pages?.length ? `<div class="pages">${j.pages.map((p) => `<a href="${esc(p.staffUrl)}" target="_blank" rel="noopener">${esc(p.slug === 'home' ? 'Home' : p.slug[0].toUpperCase() + p.slug.slice(1))}</a>`).join('')}</div>` : '';
  const review = j?.review?.pages?.length ? `<p class="small">Rendered review: ${j.review.pages.map((p) => `${esc(p.page)} ${p.width}px ${p.pass ? 'pass' : 'FAIL'} (credits ${p.credits.visible}/${p.credits.required})`).join(' · ')}</p>` : '';
  const resume = v.status === 'failed' && j?.status === 'failed' && j?.stage === 'pages' && j?.idea ? `<div class="actions"><button class="reject" data-from="${esc(c.from)}" data-n="${v.n}" data-d="resume">Resume the inner pages once (reuses the accepted homepage)</button></div>` : '';
  const recheck = v.status === 'failed' && j?.status === 'needs-review' ? `<div class="actions"><button class="reject" data-from="${esc(c.from)}" data-n="${v.n}" data-d="recheck">Run the checks again (no new generation)</button></div>` : '';
  const act = v.status === 'review' ? `<div class="actions"><input type="text" aria-label="Note for version ${v.n} (optional for send, reason for reject)" placeholder="Note (optional to send; the reason to reject)" data-note="${v.n}"><button class="send" data-from="${esc(c.from)}" data-n="${v.n}" data-d="send">Send link to customer</button><button class="reject" data-from="${esc(c.from)}" data-n="${v.n}" data-d="reject">Reject</button></div>` : '';
  return `<section class="version"><h3>Version ${v.n} <span class="pill ${esc(v.status)}">${esc(v.status === 'review' ? 'waiting for review' : v.status)}</span>${v.reused ? '<span class="pill">reused a just-made job</span>' : ''}</h3>
    <p class="meta">Job <code>${esc(v.jobId ?? '–')}</code>${j ? ` · revision ${j.rev} · ${secs(v.ms)} · ${usd(v.costUsd)} · ${v.attempts ?? '–'} attempt(s)` : ''}${v.url ? ` · customer link <a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.url)}</a> sent ${esc(new Date(v.sentAt).toLocaleString())}` : ''}${v.reviewer ? ` · by ${esc(v.reviewer)}` : ''}${v.note ? ` · note: ${esc(v.note)}` : ''}</p>
    ${j?.idea ? `<p class="idea">Design idea: ${esc(j.idea)}</p>` : ''}${pages}${review}
    ${v.error ? `<p class="err"><strong>Why it can't be sent:</strong> ${esc(v.error)}</p>` : ''}
    ${v.status === 'generating' ? '<p class="small">Being generated. Its checks run when it finishes.</p>' : ''}
    ${v.status !== 'generating' && j?.checks?.blocking?.length ? `<strong>Blocking</strong>${list(j.checks.blocking, 'blocking')}` : ''}
    ${v.status !== 'generating' && j?.checks?.staff?.length ? `<strong>Check before sending</strong>${list(grouped(j.checks.staff), 'staff')}` : ''}
    ${act}${recheck}${resume}</section>`;
}

function convo(c) {
  const r = c.run, res = r.research;
  return `<article class="convo"><h2>${esc(c.business)}</h2>
    <p class="meta">Conversation <code>${esc(c.from)}</code> · listing <code>${esc(r.placeId)}</code>${r.website ? ` · website ${esc(r.website)}` : ' · no website'} · updated ${esc(new Date(c.updatedAt).toLocaleString())}</p>
    <p class="meta">Research: ${res ? `${res.reused ? 'saved brief reused' : 'new research'} (${esc(res.reason)}) · ${secs(res.ms)} · ${usd(res.costUsd)}` : 'not started'}${r.businessKey ? ` · brief <code>${esc(r.businessKey)}</code> r${esc(r.revision)}` : ''}${r.stage === 'failed' ? ` · <span class="err">failed: ${esc(r.error)}</span>` : ''}${r.approved ? ` · <strong>customer approved version ${r.approved.n}</strong> (${esc(new Date(r.approved.at).toLocaleString())}; not published)` : ''}</p>
    ${c.versions.map((v) => version(c, v)).join('')}
    <details><summary>Customer conversation (${c.messages.length} messages)</summary><div class="chat">${c.messages.map((m) => `<div class="${m.dir === 'in' ? 'in' : 'out'}">${esc(m.text)}${m.url && !String(m.text).includes(m.url) ? `\n${esc(m.url)}` : ''}</div>`).join('')}</div></details>
  </article>`;
}

async function load() {
  if (acting) return;
  try {
    const r = await fetch('/api/studio/imessage-reviews');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { conversations } = await r.json();
    const open = new Set([...document.querySelectorAll('details[open]')].map((d) => d.closest('.convo')?.querySelector('code')?.textContent));
    const notes = Object.fromEntries([...document.querySelectorAll('[data-note]')].map((i) => [i.dataset.note + (i.closest('.convo')?.querySelector('code')?.textContent ?? ''), i.value]));
    const waiting = conversations.flatMap((c) => c.versions.filter((v) => v.status === 'review')).length;
    $('#status').textContent = conversations.length ? `${conversations.length} conversation(s) · ${waiting} version(s) waiting for review` : 'No custom-site conversations yet. Start one at /imessage/?intake=custom.';
    $('#list').innerHTML = conversations.map(convo).join('');
    document.querySelectorAll('.convo').forEach((el) => { const id = el.querySelector('code')?.textContent; if (open.has(id)) el.querySelector('details').open = true; el.querySelectorAll('[data-note]').forEach((i) => { const k = i.dataset.note + id; if (notes[k]) i.value = notes[k]; }); });
  } catch (e) { $('#status').textContent = `Could not load reviews: ${e.message}`; }
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-d]');
  if (!b || acting) return;
  const note = b.closest('.actions').querySelector('input')?.value.trim() ?? '';
  if (b.dataset.d === 'reject' && !note) { $('#status').textContent = 'Give a reason to reject (it is recorded; the customer gets a plain message).'; b.closest('.actions').querySelector('input').focus(); return; }
  acting = true; b.disabled = true;
  $('#status').textContent = b.dataset.d === 'send' ? 'Sending the link…' : 'Rejecting…';
  try {
    const r = await fetch(`/api/studio/imessage-reviews/${encodeURIComponent(b.dataset.from)}/${b.dataset.n}/${b.dataset.d}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }) });
    const j = await r.json();
    $('#status').textContent = j.ok ? (b.dataset.d === 'send' ? `Sent: ${j.url}` : b.dataset.d === 'recheck' ? 'The checks are running again in the background; the result shows here when they finish.' : b.dataset.d === 'resume' ? 'Resuming the inner pages (one attempt).' : 'Rejected. The customer was told, and keeps any earlier preview.') : `Not done: ${j.reason}`;
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
