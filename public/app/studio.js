/* Roger Site Studio — vanilla JS front end for the builder API */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (path, opts = {}) => {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.error || (j.errors || []).join('; ') || `HTTP ${r.status}`);
  return j;
};
const postJson = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const state = { placeId: null, themeMode: 'library', uploaded: null, uploadedName: '', last: null, health: null };

/* ── tabs / segmented controls ── */
function showTab(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab').forEach((p) => (p.hidden = p.dataset.pane !== name));
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$$('[data-tmode]').forEach((b) => b.addEventListener('click', () => {
  state.themeMode = b.dataset.tmode;
  $$('[data-tmode]').forEach((x) => x.classList.toggle('on', x === b));
  $$('[data-tpane]').forEach((p) => (p.hidden = p.dataset.tpane !== state.themeMode));
}));
$$('[data-dev]').forEach((b) => b.addEventListener('click', () => {
  $$('[data-dev]').forEach((x) => x.classList.toggle('on', x === b));
  $('.frame-wrap').classList.toggle('phone', b.dataset.dev === 'phone');
}));

/* ── boot ── */
(async function init() {
  try {
    const h = (state.health = await api('/api/health'));
    $('#mode').innerHTML = [
      h.mock ? '<span class="pill mock">Mock Google data</span>' : '<span class="pill on">Live Google Places</span>',
      h.claude ? `<span class="pill on">Claude · ${esc(h.model)}${h.claudeVia === 'cli' ? ' (local CLI)' : ''}</span>` : '<span class="pill">Claude off (templates)</span>',
      h.screenshots ? '<span class="pill on">Screenshots</span>' : '<span class="pill">No screenshots</span>',
      `<span class="pill">${h.themes} themes</span>`,
    ].join('');
    if (h.mock) {
      const samples = [
        ['Summit Peak Roofing 78704', 'Roofer with an outdated website'],
        ['BlueLine Plumbing Denver', '24-hour plumber, no website'],
        ['Greenway Lawn Landscape Charlotte', 'Landscaper, lots of reviews'],
        ['ComfortPro Heating Air Tempe', 'HVAC, offers maintenance'],
      ];
      $('#samples').innerHTML = samples.map(([q, d]) => `<button class="chip" type="button" data-q="${esc(q)}" title="${esc(d)}">${esc(q.split(' ').slice(0, 2).join(' '))}</button>`).join('');
      $$('#samples .chip').forEach((c) => c.addEventListener('click', () => { $('#q').value = c.dataset.q; find(); }));
    } else {
      $('#samples').previousElementSibling.hidden = true;
      $('#buildBtn').nextElementSibling.textContent = 'Live Google data. Every build is saved in the Sites tab.';
    }
  } catch (e) { $('#mode').textContent = `API unreachable: ${e.message}`; }
  try {
    const { themes } = await api('/api/themes');
    state.themes = themes;
    const byV = {};
    themes.forEach((t) => (byV[t.vertical] ||= []).push(t));
    $('#themeSel').insertAdjacentHTML('beforeend', Object.entries(byV).map(([v, list]) => `<optgroup label="${esc(v[0].toUpperCase() + v.slice(1))}">${list.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.origin === 'custom' ? ' (uploaded)' : ''}</option>`).join('')}</optgroup>`).join(''));
  } catch (e) { $('#themeInfo').textContent = `Could not load themes: ${e.message}`; }
})();

$('#themeSel').addEventListener('change', () => {
  const t = (state.themes || []).find((x) => x.id === $('#themeSel').value);
  $('#themeInfo').innerHTML = t ? `<span class="swatch" style="background:${esc(t.brand)}"></span>${esc(t.description || '')}<br>Grid <code>${esc(t.grid)}</code> · ${t.sections.map(esc).join(' → ')}` : 'Roger maps the Google category to a trade, then picks a layout: urgent (24h/emergency), trust (strong reviews), showcase (many photos), estimate (no phone) or classic.';
});
$('#themeSel').dispatchEvent(new Event('change'));

/* ── 1. find business ── */
async function find() {
  const q = $('#q').value.trim();
  if (!q) return $('#q').focus();
  $('#findBtn').disabled = true;
  $('#candidates').innerHTML = '<p class="hint">Searching Google…</p>';
  try {
    const r = await postJson('/api/lookup', { input: q });
    if (!r.candidates.length) { $('#candidates').innerHTML = '<p class="hint">No matches. Try the exact name + ZIP, or paste a Google Maps link.</p>'; return; }
    $('#candidates').innerHTML = r.candidates.map((c, i) => `<button type="button" class="cand${i === 0 ? ' sel' : ''}" data-i="${i}">
      ${i === 0 && r.card?.image ? `<img src="${esc(r.card.image)}" alt="">` : '<img alt="">'}
      <div><b>${esc(c.name)}</b><span>${esc((c.address || '').replace(/, USA$/, ''))}</span><span>${c.rating ? `★ ${c.rating} · ${c.reviewCount} reviews` : ''}${c.website ? ' · has website' : ' · no website'}</span></div></button>`).join('');
    const choose = (i) => {
      const c = r.candidates[i];
      state.placeId = c.placeId;
      $$('.cand').forEach((el) => el.classList.toggle('sel', Number(el.dataset.i) === i));
      $('#website').value = c.website || '';
      updateEta();
    };
    $$('.cand').forEach((el) => el.addEventListener('click', () => choose(Number(el.dataset.i))));
    choose(0);
    if (r.card) renderCards([r.card], 'Step 1 · confirm the business');
  } catch (e) { $('#candidates').innerHTML = `<p class="hint"><span class="err">${esc(e.message)}</span></p>`; }
  finally { $('#findBtn').disabled = false; }
}
$('#findBtn').addEventListener('click', find);
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } });

/* ── theme upload ── */
async function takeFile(file) {
  state.uploaded = null;
  state.uploadedName = file.name;
  const box = $('#themeCheck');
  try {
    const json = JSON.parse(await file.text());
    const v = await postJson('/api/themes/validate', { theme: json });
    if (v.ok) {
      state.uploaded = json;
      box.innerHTML = `<span class="okk">✓ ${esc(file.name)} is valid</span> → <code>${esc(v.id)}</code>${v.warnings.length ? `<br><span class="wrn">${v.warnings.map(esc).join('<br>')}</span>` : ''}`;
    } else box.innerHTML = `<span class="err">✗ ${esc(file.name)}</span><br><span class="err">${v.errors.slice(0, 8).map(esc).join('<br>')}</span>`;
  } catch (e) { box.innerHTML = `<span class="err">✗ ${esc(e.message)}</span>`; }
}
$('#themeFile').addEventListener('change', (e) => e.target.files[0] && takeFile(e.target.files[0]));
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && takeFile(e.dataTransfer.files[0]));

/* ── build ── */
function logStep(e) {
  const id = `s-${e.step.replace(/[^a-z0-9]+/gi, '-')}`;
  let li = document.getElementById(id);
  if (!li) { li = document.createElement('li'); li.id = id; $('#log').appendChild(li); }
  li.className = e.status;
  li.innerHTML = `<span class="st"></span><div>${esc(e.step)}${e.note ? `<span class="note">${esc(e.note)}</span>` : ''}</div><span class="ms">${e.ms != null ? `${(e.ms / 1000).toFixed(1)}s` : ''}</span>`;
}

$('#buildBtn').addEventListener('click', async () => {
  const q = $('#q').value.trim();
  if (!state.placeId && !q) { $('#q').focus(); return; }
  if (state.themeMode === 'upload' && !state.uploaded) { $('#themeCheck').innerHTML = '<span class="err">Choose a valid theme.json first (or switch to the library).</span>'; return; }
  const btn = $('#buildBtn');
  btn.disabled = true; btn.textContent = 'Building…';
  $('#empty').hidden = true; $('#log').innerHTML = ''; $('#summary').innerHTML = '';
  showTab('progress');
  const t0 = performance.now();
  let built = false;
  etaStart();
  try {
    if (state.themeMode === 'upload' && $('#saveTheme').checked) await postJson('/api/themes', { theme: state.uploaded }).catch((e) => logStep({ step: 'Save theme', status: 'error', note: e.message }));
    const body = {
      placeId: state.placeId || undefined,
      google: state.placeId ? undefined : q,
      website: $('#website').value.trim() || undefined,
      themeId: state.themeMode === 'library' ? $('#themeSel').value || undefined : undefined,
      theme: state.themeMode === 'upload' ? state.uploaded : undefined,
      fonts: $('#optFonts').checked ? 'business' : 'theme',
      brandColor: $('#optColorOn').checked ? $('#optColor').value : undefined,
      preview: $('#optPreview').checked,
      source: 'studio',
    };
    if (state.health?.vercel) {
      // Vercel: the progress stream would be a separate request that can reach another server instance,
      // so wait for the whole build in one request (the estimate box keeps counting) and list its steps after
      logStep({ step: 'Building on Vercel (steps appear when it finishes)', status: 'start' });
      const r = await postJson('/api/build?wait=1', body);
      $('#log').innerHTML = '';
      for (const s of r.steps || []) logStep({ step: s.name, status: s.ok ? 'done' : 'error', ms: s.ms, note: s.note });
      built = true;
      renderResult(r, performance.now() - t0);
      return;
    }
    const { jobId } = await postJson('/api/build', body);
    sites.openId = jobId; // the job id is also the saved build's id
    await new Promise((resolve, reject) => {
      const es = new EventSource(`/api/jobs/${jobId}/events`);
      es.addEventListener('step', (m) => logStep(JSON.parse(m.data)));
      es.addEventListener('end', (m) => {
        es.close();
        const d = JSON.parse(m.data);
        if (d.status === 'done') { built = true; renderResult(d.result, performance.now() - t0); resolve(); } else reject(new Error(d.error || 'Build failed'));
      });
      es.onerror = () => { es.close(); reject(new Error('Lost connection to the build')); };
    });
  } catch (e) {
    logStep({ step: 'Build failed', status: 'error', note: e.message });
  } finally { btn.disabled = false; btn.textContent = 'Build website'; etaStop(built); loadSites(); }
});

/** rec: the saved build record when re-opening one from the Sites tab */
function renderResult(r, ms, rec) {
  state.last = r;
  const b = r.brand;
  const hidden = Object.entries(r.hiddenSections || {});
  const when = rec ? `built ${ago(rec.createdAt)} from ${SRC[rec.source] || rec.source}${ms ? ` in ${(ms / 1000).toFixed(1)}s` : ''}` : `built in ${(ms / 1000).toFixed(1)}s`;
  $('#summary').innerHTML = `<div class="sum">
    <h3>${esc(r.business.name)} — ${esc(when)}</h3>
    <dl class="kv">
      <dt>Theme</dt><dd><code>${esc(r.themeId)}</code> · ${esc(r.themeReason)}</dd>
      <dt>Brand color</dt><dd><span class="swatch" style="background:${esc(b.brand)}"></span>${esc(b.brand)} from ${esc(b.source)}${b.rejected?.length ? ` <span class="hint">(${b.rejected.length} rejected)</span>` : ''}</dd>
      <dt>Logo</dt><dd>${b.logo ? `from website <code>${esc(b.logo.sourceUrl.split('/').pop())}</code>` : 'none found → wordmark'}</dd>
      <dt>Fonts</dt><dd>${esc(b.fonts?.heading || '')} (${esc(b.fonts?.from || 'theme')})</dd>
      <dt>Services</dt><dd>${r.services.map(esc).join(', ')}</dd>
      <dt>Facts used</dt><dd>${[r.facts.years && `${r.facts.years} years`, r.facts.licensed && 'licensed', r.facts.insured && 'insured', r.facts.warranty && 'warranty', r.facts.open24h && 'open 24h', r.facts.emergency && 'emergency'].filter(Boolean).join(', ') || 'none stated'} <span class="hint">(${esc(r.facts.source)})</span></dd>
      <dt>Hidden sections</dt><dd>${hidden.length ? hidden.map(([k, v]) => `<b>${esc(k)}</b>: ${esc(v)}`).join('<br>') : 'none'}</dd>
      ${r.audit ? `<dt>Old site score</dt><dd>${r.audit.score}/100 (${r.audit.issues.length} issues)</dd>` : ''}
    </dl>
    ${r.warnings.length ? `<ul class="warns">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <div class="row"><a class="btn primary" href="${esc(r.siteUrl)}" target="_blank" rel="noopener">Open site ↗</a><button class="btn ghost" type="button" onclick="showTab('preview')">Preview here</button>${r.audit ? `<a class="btn ghost" href="${esc(r.audit.reportUrl)}" target="_blank" rel="noopener">Audit report ↗</a>` : ''}${state.health?.publish ? `<button class="btn ghost" type="button" data-publish="${esc(r.slug)}">Publish to Vercel</button>` : ''}</div>
  </div>`;
  $('#frame').src = `${r.siteUrl}?t=${Date.now()}`;
  $('#openSite').href = r.siteUrl;
  $('#dataOut').textContent = JSON.stringify(r, null, 2);
  if (r.audit) renderAudit(r.audit, r.audit.reportUrl);
  else { $('#auditOut').className = 'empty'; $('#auditOut').innerHTML = '<p>No audit for this build (the business had no website, or the audit was turned off).</p>'; }
  renderCards(r.cards, 'Steps 2–3 · audit and preview');
}

/* ── audit ── */
function scoreColor(s) { return s >= 90 ? '#15803D' : s >= 75 ? '#65A30D' : s >= 60 ? '#CA8A04' : s >= 40 ? '#EA580C' : '#DC2626'; }
function renderAudit(a, reportUrl) {
  const c = scoreColor(a.score);
  $('#auditOut').className = '';
  $('#auditOut').innerHTML = `<div class="score"><svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="#E2E8F0" stroke-width="10"/><circle cx="50" cy="50" r="42" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(a.score / 100) * 263.9} 263.9" transform="rotate(-90 50 50)"/><text x="50" y="57" text-anchor="middle" font-size="24" font-weight="800">${a.score}</text></svg>
    <div><b>${esc(a.summary.headline)}</b><p class="hint" style="margin:4px 0 8px">${esc(a.summary.pitch)} <i>(${esc(a.summary.source)})</i></p>${reportUrl ? `<a class="btn ghost sm" href="${esc(reportUrl)}" target="_blank" rel="noopener">Full report ↗</a>` : ''}</div></div>
    <ul class="issues">${a.issues.map((i) => `<li><span class="sev ${i.severity}">${i.severity}</span><div><b>${esc(i.title)}</b><p>${esc(i.detail)}</p><p><b>Fix:</b> ${esc(i.fix)}</p></div></li>`).join('')}</ul>`;
}
$('#auditBtn').addEventListener('click', async () => {
  const website = $('#website').value.trim();
  if (!website) return $('#website').focus();
  $('#auditBtn').disabled = true;
  try {
    const r = await postJson('/api/audit', { website, placeId: state.placeId || undefined, google: state.placeId ? undefined : $('#q').value.trim() || undefined });
    renderAudit(r.audit, r.reportUrl);
    renderCards([r.card], 'Step 2 · audit');
    showTab('audit');
  } catch (e) { alert(e.message); } finally { $('#auditBtn').disabled = false; }
});

/* ── iMessage cards ── */
function host(u) { try { return new URL(u).host; } catch { return u; } }
function cardHtml(c) {
  return `<div class="bub in">${esc(c.text)}</div>${c.url ? `<a class="link-card" href="${esc(c.url)}" target="_blank" rel="noopener">${c.image ? `<img src="${esc(c.image)}" alt="">` : ''}<div><b>${esc(c.title || c.url.split('/').filter(Boolean).pop())}</b><span>${esc(host(c.url))}</span></div></a>` : ''}${c.quickReplies?.length ? `<div class="quick">${c.quickReplies.map((q) => `<button type="button" disabled>${esc(q)}</button>`).join('')}</div>` : ''}`;
}
function renderCards(cards, label) {
  $('#cardsOut').innerHTML = `<p class="hint" style="margin:0 0 4px">${esc(label)}</p>${cards.map(cardHtml).join('')}`;
}

/* ── conversation simulator ── */
const simFrom = `studio-${Math.random().toString(36).slice(2, 8)}`;
/** Messages Roger sends later (the preview after "On it"): poll the saved conversation until they land. */
async function laterReplies(from, count) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const c = await api(`/api/conversations/${encodeURIComponent(from)}`).catch(() => null);
    if (!c || c.pending) continue;
    if (c.messages.length > count) return c.messages.slice(count).filter((m) => m.dir === 'out');
    return [{ text: '', quickReplies: ['Is my preview ready?'] }]; // the build died (server restart); Roger explains on the next text
  }
}

async function simSend(text) {
  if (!text.trim()) return;
  $('#simLog').insertAdjacentHTML('beforeend', `<div class="bub out">${esc(text)}</div><div class="typing" id="typing">Roger is typing…</div>`);
  $('#simQuick').innerHTML = '';
  $('#simLog').scrollTop = 1e9;
  try {
    // async: a build answers "On it, about 20 seconds" now and the preview follows when it's done
    const res = await postJson('/api/imessage/inbound', { from: simFrom, text, async: true });
    $('#typing')?.remove();
    let replies = res.replies;
    replies.forEach((r) => $('#simLog').insertAdjacentHTML('beforeend', cardHtml({ ...r, quickReplies: [] })));
    if (res.pending) {
      $('#simLog').insertAdjacentHTML('beforeend', `<div class="typing" id="typing">Roger is building the preview (${esc(res.pending.label)})…</div>`);
      $('#simLog').scrollTop = 1e9;
      replies = await laterReplies(simFrom, res.messageCount);
      $('#typing')?.remove();
      replies.filter((r) => r.text || r.url).forEach((r) => $('#simLog').insertAdjacentHTML('beforeend', cardHtml({ ...r, quickReplies: [] })));
    }
    const q = replies[replies.length - 1]?.quickReplies || [];
    $('#simQuick').innerHTML = q.map((x) => `<button type="button">${esc(x)}</button>`).join('');
    $$('#simQuick button').forEach((b) => b.addEventListener('click', () => simSend(b.textContent)));
  } catch (e) { $('#typing')?.remove(); $('#simLog').insertAdjacentHTML('beforeend', `<div class="bub in">Error: ${esc(e.message)}</div>`); }
  $('#simLog').scrollTop = 1e9;
}
$('#simForm').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#simText').value; $('#simText').value = ''; simSend(t); });
$('#simReset').addEventListener('click', async () => { await postJson('/api/imessage/reset', { from: simFrom }); $('#simLog').innerHTML = ''; $('#simQuick').innerHTML = ''; simSend('Hi'); });
document.querySelector('[data-tab="sim"]').addEventListener('click', () => { if (!$('#simLog').children.length) simSend('Hi'); });
window.showTab = showTab;

/* ── Sites: every saved build (Studio, iMessage page, API) and every conversation, from data/ ── */
const SRC = { studio: 'Studio', imessage: 'iMessage', api: 'API', imported: 'Imported' };
const sites = { ids: null, sig: '', unseen: 0, openId: null };
function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const who = (from) => (from.startsWith('imsg-') ? 'iMessage demo page' : from.startsWith('studio-') ? 'Studio simulator' : from);

function siteRow(b) {
  const ok = b.status === 'done';
  const thumb = b.siteUrl ? `<img src="${esc(b.siteUrl)}preview.jpg" alt="" loading="lazy" onerror="this.onerror=null;this.src='${esc(b.siteUrl)}og.jpg'">` : '<img alt="">';
  const meta = ok ? [b.themeId && `<code>${esc(b.themeId)}</code>`, b.auditScore != null && `old site ${b.auditScore}/100`, esc(ago(b.createdAt)), b.replaced && 'replaced by a newer build'].filter(Boolean).join(' · ') : esc(b.error || 'Build failed');
  const badge = ok ? `<span class="src ${esc(b.source)}">${esc(SRC[b.source] || b.source)}</span>` : '<span class="src failed">Failed</span>';
  return `<div class="site-row${sites.openId === b.id ? ' sel' : ''}"><button type="button" class="site-main" data-build="${esc(b.id)}">${thumb}<span><b>${esc(b.name || 'Build failed')}</b><span class="line">${esc([b.category, b.address].filter(Boolean).join(' · '))}</span><span class="line">${badge}${meta}</span></span></button>${ok && b.siteUrl ? `<div class="row-actions">${publishControls(b)}<a class="btn ghost sm" href="${esc(b.siteUrl)}" target="_blank" rel="noopener">Open site ↗</a></div>` : ''}</div>`;
}

// Vercel: "Live ↗" once published, "Publish" / "Republish" (a newer build than what's live) when VERCEL_TOKEN is set
function publishControls(b) {
  const p = b.published;
  const live = p ? `<a class="btn ghost sm live" href="${esc(p.url)}" target="_blank" rel="noopener" title="Published ${esc(ago(p.at))}">Live ↗</a>` : '';
  const canPublish = state.health?.publish && !b.replaced && (!p || p.stale);
  return live + (canPublish ? `<button class="btn ghost sm" type="button" data-publish="${esc(b.slug)}">${p ? 'Republish' : 'Publish'}</button>` : '');
}

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-publish]');
  if (!btn || btn.disabled) return;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Publishing…';
  try {
    const p = await postJson(`/api/sites/${encodeURIComponent(btn.dataset.publish)}/publish`, {});
    btn.outerHTML = `<a class="btn ghost sm live" href="${esc(p.url)}" target="_blank" rel="noopener">Live ↗</a>`;
    $('#sitesMsg').innerHTML = `<span class="okk">Published: <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></span>`;
    sites.sig = ''; loadSites();
  } catch (err) {
    btn.disabled = false; btn.textContent = label;
    $('#sitesMsg').innerHTML = `<span class="err">Publish failed: ${esc(err.message)}</span>`;
    showTab('sites');
  }
});

function convoRow(c) {
  const sitesN = c.buildIds.length ? `${c.buildIds.length} site${c.buildIds.length > 1 ? 's' : ''}` : 'no site yet';
  return `<div class="site-row convo"><button type="button" class="site-main" data-convo="${esc(c.from)}"><span class="av">${esc((c.business || 'R')[0].toUpperCase())}</span><span><b>${esc(c.business || who(c.from))}</b><span class="line">${esc(c.last)}</span><span class="line">${esc(who(c.from))} · ${c.messages} messages · ${sitesN} · ${esc(ago(c.updatedAt))}</span></span></button></div>`;
}

// saved messages, drawn like the simulator: the owner's texts in blue, Roger's replies + link cards in gray
const transcriptHtml = (c) => c.messages.map((m) => (m.dir === 'in' ? `<div class="bub out">${esc(m.text)}</div>` : cardHtml({ ...m, text: m.text || '', quickReplies: [] }))).join('');

function updateCount() {
  const el = $('#sitesCount');
  el.hidden = !sites.unseen;
  el.textContent = sites.unseen ? `${sites.unseen} new` : '';
}

async function loadSites() {
  try {
    const [{ builds }, { conversations }] = await Promise.all([api('/api/builds'), api('/api/conversations')]);
    const ids = builds.map((b) => b.id);
    if (sites.ids && $('[data-pane="sites"]').hidden) sites.unseen += ids.filter((id) => !sites.ids.includes(id)).length;
    sites.ids = ids;
    updateCount();
    const sig = JSON.stringify([builds, conversations, sites.openId]);
    if (sig !== sites.sig) { // only redraw when something changed, so hover and focus survive the polling
      sites.sig = sig;
      $('#sitesList').innerHTML = builds.length ? builds.map(siteRow).join('') : '<p class="hint">No sites yet. Build one here, or text Roger on the <a href="/imessage" target="_blank" rel="noopener">iMessage page</a>.</p>';
      $('#convosList').innerHTML = conversations.length ? conversations.map(convoRow).join('') : '<p class="hint">No conversations yet.</p>';
    }
    return builds;
  } catch (e) {
    $('#sitesList').innerHTML = `<p class="hint"><span class="err">Could not load saved sites: ${esc(e.message)}</span></p>`;
    return [];
  }
}

async function openBuild(id) {
  const rec = await api(`/api/builds/${encodeURIComponent(id)}`);
  sites.openId = id;
  sites.sig = ''; // redraw the list with this row selected
  loadSites();
  $('#empty').hidden = true; $('#log').innerHTML = ''; $('#summary').innerHTML = '';
  showTab('progress');
  if (rec.status !== 'done' || !rec.result) { logStep({ step: 'Build failed', status: 'error', note: rec.error || '' }); return; }
  for (const s of rec.result.steps) logStep({ step: s.name, status: s.ok ? 'done' : 'error', ms: s.ms, note: s.note });
  renderResult(rec.result, rec.result.totalMs, rec);
  if (rec.from) {
    const c = await api(`/api/conversations/${encodeURIComponent(rec.from)}`).catch(() => null);
    if (c) $('#summary .sum').insertAdjacentHTML('beforeend', `<details class="convo-in-sum" open><summary>The iMessage conversation (${c.messages.length} messages, ${esc(who(c.from))})</summary><div class="phone-ui transcript">${transcriptHtml(c)}</div></details>`);
  }
}

async function openConvo(from) {
  const c = await api(`/api/conversations/${encodeURIComponent(from)}`);
  const lastBuild = c.buildIds[c.buildIds.length - 1];
  $('#convoView').innerHTML = `<div class="convo-view"><div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px"><b>${esc(c.business || who(c.from))} · ${esc(who(c.from))}</b>${lastBuild ? `<button class="btn ghost sm" type="button" data-build="${esc(lastBuild)}">Open the site it built</button>` : ''}</div><div class="phone-ui transcript">${transcriptHtml(c)}</div></div>`;
  $('#convoView').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$('[data-pane="sites"]').addEventListener('click', (e) => {
  const b = e.target.closest('[data-build]');
  if (b) { openBuild(b.dataset.build).catch((err) => alertInline(err)); return; }
  const c = e.target.closest('[data-convo]');
  if (c) openConvo(c.dataset.convo).catch((err) => alertInline(err));
});
const alertInline = (err) => { $('#convoView').innerHTML = `<p class="hint"><span class="err">${esc(err.message)}</span></p>`; };
document.querySelector('[data-tab="sites"]').addEventListener('click', () => { sites.unseen = 0; updateCount(); loadSites(); });

// first load: open the Sites tab when there is history and nothing has been built in this session yet
loadSites().then((builds) => { if (builds.length && !state.last) showTab('sites'); });
setInterval(() => { if (!document.hidden) loadSites(); }, 5000);

/* ── build-time estimate: shown before building, and the line Roger texts the owner ── */
const CLOCK = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const eta = { studio: null, roger: null, timer: null, t0: 0 };
const rogerLine = () => (eta.roger ? `<span class="say">Roger texts the owner: <q>On it. Your preview will be ready in ${esc(eta.roger.label)}.</q></span>` : '');

async function updateEta() {
  if (eta.timer) return; // a build is running: keep showing its progress
  const web = $('#website').value.trim() ? 1 : 0;
  try {
    // a Studio build audits the website too; Roger's iMessage build skips that (the audit already ran in the chat)
    [eta.studio, eta.roger] = await Promise.all([api(`/api/estimate?website=${web}&audit=${web}`), api(`/api/estimate?website=${web}&audit=0`)]);
    $('#eta').className = 'eta';
    $('#eta').innerHTML = `${CLOCK}<b>Estimated build time: ${esc(eta.studio.label)}</b><span class="basis">${esc(eta.studio.basis)}</span>${rogerLine()}`;
    $('#eta').hidden = false;
  } catch { $('#eta').hidden = true; }
}

function etaStart() {
  eta.t0 = performance.now();
  const tick = () => {
    const s = Math.round((performance.now() - eta.t0) / 1000);
    $('#eta').className = 'eta running';
    $('#eta').innerHTML = `${CLOCK}<b>Building… ${s}s${eta.studio ? ` of ${esc(eta.studio.label)}` : ''}</b><span class="basis">${eta.studio ? esc(eta.studio.basis) : ''}</span>`;
    $('#eta').hidden = false;
  };
  tick();
  eta.timer = setInterval(tick, 500);
}

function etaStop(ok) {
  clearInterval(eta.timer); eta.timer = null;
  if (!ok) { updateEta(); return; }
  const took = (performance.now() - eta.t0) / 1000;
  const slower = eta.studio && took > eta.studio.seconds;
  $('#eta').className = 'eta done';
  $('#eta').innerHTML = `${CLOCK}<b>Built in ${took.toFixed(1)}s</b><span class="basis">Estimate was ${eta.studio ? esc(eta.studio.label) : 'not available'}${slower ? ', this one ran slower' : ''}. Future estimates include this build.</span>${rogerLine()}`;
}

let etaDebounce;
$('#website').addEventListener('input', () => { clearTimeout(etaDebounce); etaDebounce = setTimeout(updateEta, 300); });
updateEta();
