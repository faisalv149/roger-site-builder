/* Roger Site Studio — vanilla JS front end for the builder API */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (name, cls = '') => `<svg class="i${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const api = async (path, opts = {}) => {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(j.error || (j.errors || []).join('; ') || `HTTP ${r.status}`), { blockers: j.blockers });
  return j;
};
const postJson = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const state = { placeId: null, themeMode: 'library', uploaded: null, uploadedName: '', last: null, health: null };

/* ── toasts: results of publish / delete / copy, without leaving the current tab ── */
function toast(kind, html, ms = kind === 'err' ? 9000 : 5000) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${ic(kind === 'err' ? 'alert' : 'check')}<div>${html}</div><button type="button" aria-label="Dismiss">${ic('x')}</button>`;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  el.querySelector('button').addEventListener('click', close);
  $('#toasts').appendChild(el);
  $$('#toasts .toast:not(.out)').slice(0, -3).forEach((t) => t.querySelector('button').click()); // at most 3 on screen
  setTimeout(close, ms);
}

/* ── confirm dialog: stays open with a spinner while the action runs ── */
function confirmDialog({ title, body, ok, run }) {
  const d = $('#confirmDlg');
  const okBtn = $('#cOk');
  let busy = false;
  $('#cTitle').textContent = title;
  $('#cBody').innerHTML = body;
  okBtn.textContent = ok; okBtn.disabled = false;
  d.returnValue = '';
  d.showModal();
  return new Promise((resolve) => {
    const onOk = async (e) => {
      e.preventDefault();
      busy = true; okBtn.disabled = true; okBtn.innerHTML = `<span class="spin"></span>${esc(ok)}`;
      try { await run(); d.close('done'); resolve(true); } catch (err) { d.close('fail'); toast('err', esc(err.message)); resolve(false); }
    };
    const onCancel = (e) => { if (busy) e.preventDefault(); }; // Esc can't close it mid-request
    okBtn.addEventListener('click', onOk, { once: true });
    d.addEventListener('cancel', onCancel);
    d.addEventListener('close', () => {
      okBtn.removeEventListener('click', onOk); d.removeEventListener('cancel', onCancel);
      if (!['done', 'fail'].includes(d.returnValue)) resolve(false);
    }, { once: true });
  });
}

/* ── popovers (status, ⋯ menus): fixed position under their button, flipped up near the bottom ── */
function placePopover(pop) {
  const btn = document.querySelector(`[popovertarget="${pop.id}"]`);
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const h = pop.offsetHeight || 180;
  // from the left edge: a reserved scrollbar gutter shifts 'right' for fixed elements and isn't reported anywhere
  const w = pop.offsetWidth || parseFloat(getComputedStyle(pop).width) || 210;
  pop.style.right = 'auto';
  pop.style.left = `${Math.max(8, r.right - w)}px`;
  if (r.bottom + 6 + h > innerHeight && r.top - 6 - h > 0) { pop.style.top = 'auto'; pop.style.bottom = `${innerHeight - r.top + 6}px`; }
  else { pop.style.bottom = 'auto'; pop.style.top = `${r.bottom + 6}px`; }
}
for (const ev of ['beforetoggle', 'toggle']) document.addEventListener(ev, (e) => { if (e.newState === 'open' && e.target.matches?.('[popover]')) placePopover(e.target); }, true);
// keep open popovers attached to their button while the page or a panel scrolls
let popRaf = 0;
const replacePops = () => { cancelAnimationFrame(popRaf); popRaf = requestAnimationFrame(() => { try { $('[popover]:popover-open').forEach(placePopover); } catch { /* no popover support */ } }); };
addEventListener('scroll', replacePops, { passive: true, capture: true });
addEventListener('resize', replacePops);
const menuHtml = (id, name, items) => `<button class="btn ghost sm icon" type="button" popovertarget="${id}" aria-label="More actions for ${esc(name)}" title="More actions">${ic('more')}</button><div class="menu" id="${id}" popover>${items}</div>`;

/* ── tabs (WAI-ARIA tabs: arrow keys move between them) / segmented controls ── */
const tabBtns = () => $$('.tabs [data-tab]');
const onTab = {}; // hooks run when a tab opens
function showTab(name, { focus = false } = {}) {
  tabBtns().forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  $$('.tab').forEach((p) => (p.hidden = p.dataset.pane !== name));
  onTab[name]?.();
}
tabBtns().forEach((b) => {
  const pane = $(`[data-pane="${b.dataset.tab}"]`);
  b.id = `tab-${b.dataset.tab}`; pane.id = `pane-${b.dataset.tab}`;
  b.setAttribute('aria-controls', pane.id); pane.setAttribute('aria-labelledby', b.id);
  b.addEventListener('click', () => showTab(b.dataset.tab));
});
$('.tabs').addEventListener('keydown', (e) => {
  const list = tabBtns();
  const i = list.indexOf(document.activeElement);
  if (i < 0) return;
  const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: list.length - 1 }[e.key];
  if (j == null) return;
  e.preventDefault();
  showTab(list[(j + list.length) % list.length].dataset.tab, { focus: true });
});
showTab('progress');
document.addEventListener('click', (e) => { const t = e.target.closest('[data-show-tab]'); if (t) showTab(t.dataset.showTab); });
window.showTab = showTab;

function segment(attr, onPick) {
  $$(`[${attr}]`).forEach((b) => b.addEventListener('click', () => {
    $$(`[${attr}]`).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    onPick(b.getAttribute(attr));
  }));
}
segment('data-tmode', (mode) => {
  state.themeMode = mode;
  $$('[data-tpane]').forEach((p) => (p.hidden = p.dataset.tpane !== mode));
});
segment('data-dev', (dev) => {
  $('.frame-wrap').classList.toggle('phone', dev === 'phone');
  $('.frame-wrap').classList.toggle('tablet', dev === 'tablet');
});

/* ── boot ── */
function renderStatus(h) {
  const claudeOk = h.claude && (!h.claudeKey || h.claudeKey === 'ok');
  const items = [
    [h.mock ? 'warn' : 'ok', 'Google Business data', h.mock ? 'Mock sample businesses' : 'Live Google Places'],
    [claudeOk ? 'ok' : 'warn', 'Claude', h.claude ? `${h.model}${h.claudeVia === 'cli' ? ' via the local CLI' : ''}${claudeOk ? '' : ` · key ${h.claudeKey}`}` : 'Off: templates only'],
    [h.screenshots ? 'ok' : 'warn', 'Screenshots', h.screenshots ? 'Real page screenshots' : 'Share image instead'],
    [h.themes ? 'ok' : 'bad', 'Themes', `${h.themes} in the library`],
    [h.publish ? 'ok' : 'warn', 'Publishing', h.publish ? 'Vercel, one project per site' : 'Off: set VERCEL_TOKEN'],
    ...(h.storage ? [['ok', 'Storage', h.storage[0].toUpperCase() + h.storage.slice(1)]] : []),
  ];
  const worst = items.some(([s]) => s === 'bad') ? 'bad' : items.some(([s]) => s === 'warn') ? 'warn' : 'ok';
  const notes = items.filter(([s]) => s !== 'ok').length;
  $('#mode .dot').className = `dot ${worst}`;
  $('#mode .status-txt').textContent = worst === 'ok' ? 'All systems ready' : h.mock ? 'Mock data' : `${notes} to check`;
  $('#statusList').innerHTML = items.map(([s, k, v]) => `<li><span class="dot ${s}"></span><b>${esc(k)}</b><span class="v">${esc(v)}</span></li>`).join('');
}

(async function init() {
  try {
    const h = (state.health = await api('/api/health'));
    renderStatus(h);
    $('#samplesWrap').hidden = !h.mock;
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
      $('#fineNote').textContent = 'Live Google data · every build is saved in Sites';
    }
    // the site cards and the open build's buttons depend on whether publishing is on: draw them again
    sites.sig = ''; loadSites(); fillPubCtls();
  } catch (e) {
    $('#mode .dot').className = 'dot bad';
    $('#mode .status-txt').textContent = 'API unreachable';
    $('#statusList').innerHTML = `<li><span class="dot bad"></span><b>API</b><span class="v">${esc(e.message)}</span></li>`;
  }
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
  $('#themeInfo').innerHTML = t
    ? `<span class="swatch" style="background:${esc(t.brand)}"></span>${esc(t.description || '')}<br>Grid <code>${esc(t.grid)}</code> · ${t.sections.map(esc).join(' → ')}`
    : 'Roger picks the trade from the Google category, and the layout from the profile (24h, reviews, photos).';
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
    $('#candidates').innerHTML = r.candidates.map((c, i) => `<button type="button" class="cand${i === 0 ? ' sel' : ''}" data-i="${i}" aria-pressed="${i === 0}">
      ${i === 0 && r.card?.image ? `<img src="${esc(r.card.image)}" alt="">` : '<img alt="">'}
      <div><b>${esc(c.name)}</b><span>${esc((c.address || '').replace(/, USA$/, ''))}</span><span>${c.rating ? `★ ${c.rating} · ${c.reviewCount} reviews` : 'No reviews'}${c.website ? ' · has website' : ' · no website'}</span></div></button>`).join('');
    const choose = (i) => {
      const c = r.candidates[i];
      state.placeId = c.placeId;
      $$('.cand').forEach((el) => { const on = Number(el.dataset.i) === i; el.classList.toggle('sel', on); el.setAttribute('aria-pressed', String(on)); });
      $('#website').value = c.website || '';
      updateEta();
    };
    $$('.cand').forEach((el) => el.addEventListener('click', () => choose(Number(el.dataset.i))));
    choose(0);
    if (r.card) renderCards([r.card], 'Step 1 · confirm the business');
  } catch (e) { $('#candidates').innerHTML = `<p class="hint err">${esc(e.message)}</p>`; }
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
  $('#steps').hidden = false;
  const id = `s-${e.step.replace(/[^a-z0-9]+/gi, '-')}`;
  let li = document.getElementById(id);
  if (!li) { li = document.createElement('li'); li.id = id; $('#log').appendChild(li); }
  li.className = e.status;
  li.innerHTML = `<span class="st"></span><div>${esc(e.step)}${e.note ? `<span class="note">${esc(e.note)}</span>` : ''}</div><span class="ms">${e.ms != null ? `${(e.ms / 1000).toFixed(1)}s` : ''}</span>`;
}
function resetBuildPane(label) {
  $('#empty').hidden = true; $('#log').innerHTML = ''; $('#summary').innerHTML = '';
  $('#steps').hidden = true; $('#steps').open = true; $('#stepsLabel').textContent = label;
}

const BUILD_LABEL = `${ic('sparkles')}<span>Build website</span>`;
$('#buildBtn').addEventListener('click', async () => {
  const q = $('#q').value.trim();
  if (!state.placeId && !q) { $('#q').focus(); toast('err', 'Find a business first (step 1).'); return; }
  if (state.themeMode === 'upload' && !state.uploaded) { $('#themeCheck').innerHTML = '<span class="err">Choose a valid theme.json first (or switch to the library).</span>'; return; }
  const btn = $('#buildBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span><span>Building…</span>';
  resetBuildPane('Building…');
  $('#steps').hidden = false;
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
    await followJob(jobId, t0);
    built = true;
  } catch (e) {
    logStep({ step: 'Build failed', status: 'error', note: e.message });
    $('#stepsLabel').textContent = 'Build failed';
    toast('err', `Build failed: ${esc(e.message)}`);
  } finally { btn.disabled = false; btn.innerHTML = BUILD_LABEL; etaStop(built); loadSites(); }
});

/** Live steps of a running build (server-sent events), then its result in the tabs. The job id is also the saved build's id. */
function followJob(jobId, t0) {
  sites.openId = jobId;
  return new Promise((resolve, reject) => {
    const es = new EventSource(`/api/jobs/${jobId}/events`);
    es.addEventListener('step', (m) => logStep(JSON.parse(m.data)));
    es.addEventListener('end', (m) => {
      es.close();
      const d = JSON.parse(m.data);
      if (d.status === 'done') { renderResult({ ...d.result, jobId }, performance.now() - t0); resolve(d.result); } else reject(new Error(d.error || 'Build failed'));
    });
    es.onerror = () => { es.close(); reject(new Error('Lost connection to the build')); };
  });
}

const fileName = (u) => { const f = String(u).split('/').pop() || ''; try { return decodeURIComponent(f); } catch { return f; } };

/** rec: the saved build record when re-opening one from the Sites tab */
function renderResult(r, ms, rec) {
  state.last = r;
  state.buildId = rec?.id || r.jobId || sites.openId;
  const b = r.brand;
  const hidden = Object.entries(r.hiddenSections || {});
  const secs = ms ? ` in ${(ms / 1000).toFixed(1)}s` : '';
  const when = rec ? `Built ${ago(rec.createdAt)} from ${SRC[rec.source] || rec.source}${secs}` : `Built just now${secs}`;
  const facts = [r.facts.years && `${r.facts.years} years`, r.facts.licensed && 'licensed', r.facts.insured && 'insured', r.facts.warranty && 'warranty', r.facts.open24h && 'open 24h', r.facts.emergency && 'emergency'].filter(Boolean).join(', ') || 'none stated';
  $('#summary').innerHTML = `<div class="sum">
    <div class="sum-head">
      <img class="sum-thumb" src="${esc(r.siteUrl)}preview.jpg?t=${Date.now()}" alt="" onerror="this.onerror=null;this.src='${esc(r.siteUrl)}og.jpg'">
      <div class="sum-title">
        <h2>${esc(r.business.name)}</h2>
        <p>${esc(when)}</p>
        <div class="sum-badges"><span id="pubBadge"></span><span class="tag mono">${esc(r.themeId)}</span>${r.audit ? `<span class="tag">Old site ${r.audit.score}/100</span>` : ''}${r.newSite ? `<span class="tag tag-new" title="The same checks, run on the new site">New site ${r.newSite.score}/100</span>` : ''}</div>
        <div class="sum-actions" id="sumActs" data-slug="${esc(r.slug)}" data-built="${esc(rec?.createdAt || new Date().toISOString())}"></div>
      </div>
    </div>
    ${scoreCompare(r.audit, r.newSite)}
    ${designBlock(r)}
    ${r.warnings.length ? `<div class="callout">${ic('alert')}<ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    <dl class="kv">
      <dt>Theme</dt><dd><code>${esc(r.themeId)}</code> · ${esc(r.themeReason)}</dd>
      <dt>Brand color</dt><dd><span class="swatch" style="background:${esc(b.brand)}"></span>${esc(b.brand)} from ${esc(b.source)}${b.rejected?.length ? ` <span class="hint">(${b.rejected.length} rejected)</span>` : ''}</dd>
      <dt>Logo</dt><dd>${b.logo ? `From their website: <code>${esc(fileName(b.logo.sourceUrl))}</code>` : 'None found, so a wordmark'}</dd>
      <dt>Fonts</dt><dd>${esc(b.fonts?.heading || '')} (${esc(b.fonts?.from || 'theme')})</dd>
      <dt>Services</dt><dd>${r.services.map(esc).join(', ')}</dd>
      <dt>Facts used</dt><dd>${esc(facts)} <span class="hint">(${esc(r.facts.source)})</span></dd>
      <dt>Hidden sections</dt><dd>${hidden.length ? hidden.map(([k, v]) => `<b>${esc(k)}</b>: ${esc(v)}`).join('<br>') : 'None'}</dd>
    </dl>
  </div>`;
  const failedSteps = $$('#log li.error').length;
  $('#steps').open = failedSteps > 0;
  $('#stepsLabel').textContent = `Build steps · ${$$('#log li').length}${failedSteps ? ` · ${failedSteps} failed` : ''}${ms ? ` · ${(ms / 1000).toFixed(1)}s` : ''}`;
  $('#frame').src = `${r.siteUrl}?t=${Date.now()}`;
  $('#openSite').href = r.siteUrl;
  $('#urlbar').textContent = r.siteUrl; $('#urlbar').title = r.siteUrl;
  $('#dataOut').textContent = JSON.stringify(r, null, 2);
  if (r.audit) renderAudit(r.audit, r.audit.reportUrl, r.newSite);
  else if (r.newSite) renderAudit(r.newSite, null, null, true);
  else { $('#auditOut').className = 'empty-state small'; $('#auditOut').innerHTML = emptyHtml('gauge', 'No audit for this build', 'The business had no website, or the audit was turned off.'); }
  renderCards(r.cards, 'Steps 2–3 · audit and preview');
  renderSumActs(undefined);
  fillPubCtls();
}

// the build summary's buttons. p: undefined = not known yet, null = not on Vercel, { url, at } = live
function renderSumActs(p, stale) {
  const el = $('#sumActs');
  const r = state.last;
  if (!el || !r) return;
  const pubOn = state.health?.publish;
  const name = r.business.name;
  const pub = !pubOn || p === undefined ? ''
    : p ? `${stale ? `<button class="btn ghost" type="button" data-publish="${esc(r.slug)}" title="This build is newer than the live site">${ic('cloud-up')}Update live site</button>` : ''}<a class="btn live" href="${esc(p.url)}" target="_blank" rel="noopener" title="Published ${esc(ago(p.at))}">${ic('globe')}Live site</a>`
    : `<button class="btn ghost" type="button" data-publish="${esc(r.slug)}">${ic('cloud-up')}Publish to Vercel</button>`;
  const top = [
    r.audit ? `<a href="${esc(r.audit.reportUrl)}" target="_blank" rel="noopener">${ic('gauge')}Audit report</a>` : '',
    `<button type="button" data-show-tab="data">${ic('braces')}Build JSON</button>`,
    p && pubOn ? `<button type="button" data-unpublish="${esc(r.slug)}" data-name="${esc(name)}">${ic('cloud-off')}Unpublish</button>` : '',
  ].join('');
  const items = `${top}<hr><button type="button" class="danger-item" data-delete="${esc(r.slug)}" data-name="${esc(name)}">${ic('trash')}Delete site…</button>`;
  el.innerHTML = `<a class="btn primary" href="${esc(r.siteUrl)}" target="_blank" rel="noopener">${ic('ext')}Open site</a><button class="btn ghost" type="button" data-show-tab="preview">${ic('monitor')}Preview</button>${pub}${menuHtml('m-sum', name, items)}`;
  $('#pubBadge').innerHTML = !pubOn || p === undefined ? '' : p ? (stale ? '<span class="badge stale">Live · older version</span>' : '<span class="badge live">Live on Vercel</span>') : '<span class="badge">Not published</span>';
}

// ask the server whether the open site is on Vercel, then draw Publish / Live / Update
async function fillPubCtls() {
  const el = $('#sumActs');
  if (!el || !state.health?.publish) return;
  try {
    const p = await api(`/api/sites/${encodeURIComponent(el.dataset.slug)}/publish`);
    if ($('#sumActs') !== el) return; // another site was opened meanwhile
    renderSumActs(p.published ? { url: p.url, at: p.publishedAt } : null, p.published && el.dataset.built > p.publishedAt);
  } catch { /* leave the buttons without publishing */ }
}

/* ── personalisation (plumbing pilot): the design plan's summary + three optional questions ── */
const DIRS = { 'clean-professional': ['Clean professional', 'White and cool greys, crisp cards, fits any business'], 'local-trusted': ['Warm local', 'Warm, reviews and team up front, where to find you'], 'bold-direct': ['Bold practical', 'Strong type, contact first, practical on phones'], 'modern-premium': ['Editorial showcase', 'Whitespace, editorial type, large photos'] };
const GOALS = { call: 'Call', quote: 'Request a quote', appointment: 'Request an appointment', order: 'Order enquiry', enquiry: 'Send an enquiry' };
const HEROES = { split: 'split text and photo', 'photo-led': 'photograph-led', 'type-led': 'typography-led', carousel: 'photo carousel' };

function designBlock(r) {
  const p = r.design;
  const info = r.personalise;
  if (!p && !(info?.eligible)) return '';
  const head = p
    ? `<div class="dz-line"><span class="tag dz-dir">${esc(DIRS[p.direction]?.[0] || p.direction)}</span><span>${esc(HEROES[p.hero.variant] || p.hero.variant)} hero</span><span>Leads with <b>${esc(p.service.label)}</b></span><span>Main button: <b>${esc(GOALS[p.goal])}</b></span>${p.category ? `<span>${esc(p.category)}</span>` : ''}${p.variation ? `<span>Design ${p.variation + 1}</span>` : ''}</div>
       <p class="dz-sections">${p.sections.map((s) => `<span>${esc(s.id)}</span>`).join('<i aria-hidden="true">→</i>')}</p>
       <details class="dz-why"><summary>Why this design</summary><ul>${p.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="hint">Plan <code>${esc(p.id)}</code> · ${esc(p.planner === 'claude+rules' ? 'Claude + rules' : 'rules only')} · copy from ${esc(p.copy.source)}</p></details>`
    : `<p class="hint" style="margin:0">${info.manualTheme ? `This site uses a chosen theme (<code>${esc(r.themeId)}</code>). Personalising replaces it with Roger's design.` : 'This site has no design plan yet.'}</p>`;
  return `<section class="dz" id="dz" aria-labelledby="dz-h">
    <div class="dz-top"><h3 id="dz-h">${ic('sparkles')}Design</h3>
      <div class="dz-acts">${info?.eligible ? `<button class="btn ghost sm" type="button" data-pz-open>${ic('sliders')}Personalise this website</button>${p ? `<button class="btn ghost sm" type="button" data-pz-alt title="Same answers, a different composition">${ic('refresh')}Try a different design</button>` : ''}` : ''}${r.draftId ? `<button class="btn ghost sm" type="button" data-owner-link="${esc(r.draftId)}" title="A private link for the owner: customise, save, demo purchase and domain setup">${ic('ext')}Owner editor link</button>` : ''}</div>
    </div>
    ${head}
    <div id="pzWrap"></div>
    <div id="ownerLinkWrap" aria-live="polite"></div>
  </section>`;
}

function pzForm(r) {
  const info = r.personalise || {};
  const cur = r.design?.preferences || {};
  const rec = info.recommended || {};
  const sugg = info.suggestions || [];
  const radio = (name, value, label, checked, extra = '') => `<label class="pz-opt"><input type="radio" name="${name}" value="${esc(value)}"${checked ? ' checked' : ''}${extra}><span>${label}</span></label>`;
  const svcOther = cur.service && !sugg.some((s) => s.toLowerCase() === cur.service.toLowerCase()) ? cur.service : '';
  return `<form class="pz" id="pzForm" novalidate>
    <fieldset><legend>Which service should your website focus on?</legend>
      <div class="pz-opts">${radio('service', '__keep', `Keep recommended${rec.service ? ` <small>(${esc(rec.service)})</small>` : ''}`, !cur.service)}
        ${sugg.map((s) => radio('service', s, esc(s), cur.service && cur.service.toLowerCase() === s.toLowerCase())).join('')}
        ${radio('service', '__other', 'Another service', !!svcOther)}</div>
      <label class="pz-other" for="pzOther">The owner's service<input id="pzOther" maxlength="60" autocomplete="off" placeholder="e.g. Tankless water heaters" value="${esc(svcOther)}"></label>
    </fieldset>
    <fieldset><legend>What should visitors do?</legend>
      <div class="pz-opts">${radio('goal', '__keep', `Keep recommended${rec.goal ? ` <small>(${esc(GOALS[rec.goal])})</small>` : ''}`, !cur.goal)}
        ${radio('goal', 'call', 'Call', cur.goal === 'call', info.phoneOk ? '' : ' disabled')}
        ${radio('goal', 'quote', 'Request a quote', cur.goal === 'quote')}
        ${radio('goal', 'appointment', 'Request an appointment', cur.goal === 'appointment')}
        ${radio('goal', 'order', 'Order enquiry', cur.goal === 'order')}
        ${radio('goal', 'enquiry', 'Send an enquiry', cur.goal === 'enquiry')}</div>
      ${info.phoneOk ? '' : '<p class="hint">Call needs a phone number on the Google profile.</p>'}
      <p class="hint" data-pz-appt${cur.goal === 'appointment' ? '' : ' hidden'}>There's no live booking calendar yet: visitors send a request and the business confirms the time.</p>
    </fieldset>
    <fieldset><legend>How should the business feel?</legend>
      <div class="pz-opts pz-styles">${radio('style', '__keep', `Keep recommended${rec.style ? ` <small>(${esc(DIRS[rec.style][0])})</small>` : ''}`, !cur.style)}
        ${Object.entries(DIRS).map(([k, [label, d]]) => radio('style', k, `${esc(label)}<small>${esc(d)}</small>`, cur.style === k)).join('')}</div>
      ${info.emergencyVerified ? '<p class="hint">The business states 24-hour or emergency service, so the bold style can say so.</p>' : `<label class="check pz-emerg"><input type="checkbox" id="pzEmergency"${cur.emergencyConfirmed ? ' checked' : ''}> The owner confirmed they offer emergency call-outs <span class="hint">(otherwise no emergency messaging)</span></label>`}
    </fieldset>
    ${info.manualTheme ? '<label class="check pz-optin"><input type="checkbox" id="pzOptIn"> Replace the chosen theme with Roger\'s design</label>' : ''}
    <div class="pz-foot"><button class="btn primary" type="submit">${ic('sparkles')}<span>Update preview</span></button><button class="btn ghost" type="button" data-pz-cancel>Cancel</button><span class="hint" id="pzEta"></span></div>
  </form>`;
}

function pzValues() {
  const f = $('#pzForm');
  const val = (n) => f.querySelector(`input[name="${n}"]:checked`)?.value;
  const prefs = {};
  const svc = val('service');
  if (svc === '__other') { const t = $('#pzOther').value.trim(); if (!t) throw new Error('Type the service, or pick another option.'); prefs.service = t; }
  else if (svc && svc !== '__keep') prefs.service = svc;
  const goal = val('goal'); if (goal && goal !== '__keep') prefs.goal = goal;
  const style = val('style'); if (style && style !== '__keep') prefs.style = style;
  if ($('#pzEmergency')?.checked) prefs.emergencyConfirmed = true;
  return prefs;
}

/** Rebuild the open site with answers (or as an alternative design), showing progress like a build. */
// the owner's private editor link: issuing one replaces the previous link; revoking turns it off
async function ownerLink(draftId) {
  const wrap = $('#ownerLinkWrap');
  if (!confirm('Create a new owner editor link? Any earlier link for this site stops working.')) return;
  try {
    const r = await fetch(`/api/drafts/${encodeURIComponent(draftId)}/owner-link`, { method: 'POST' }).then((x) => x.json().then((j) => (x.ok ? j : Promise.reject(new Error(j.error || x.status)))));
    wrap.innerHTML = `<div class="hint" style="margin-top:10px">Send this to the owner only. It opens their editor for this site (customise, save, demo purchase, domain setup).<br><input readonly class="input" style="width:100%;margin-top:6px" value="${esc(r.url)}" aria-label="Owner editor link" onfocus="this.select()"> <button class="btn ghost sm" type="button" data-copy="${esc(r.url)}">Copy</button> <a class="btn ghost sm" href="${esc(r.url)}" target="_blank" rel="noopener">Open</a> <button class="btn ghost sm" type="button" data-owner-revoke="${esc(draftId)}">Revoke link</button></div>`;
    wrap.querySelector('[data-copy]')?.addEventListener('click', (ev) => { navigator.clipboard?.writeText(ev.currentTarget.getAttribute('data-copy')); toast('ok', 'Link copied'); });
  } catch (err) { toast('err', `Couldn't create the link: ${esc(err.message)}`); }
}
async function revokeOwnerLink(draftId) {
  const r = await fetch(`/api/drafts/${encodeURIComponent(draftId)}/owner-link`, { method: 'DELETE' });
  $('#ownerLinkWrap').innerHTML = r.ok ? '<p class="hint" style="margin-top:10px">Owner link revoked. It no longer opens the editor.</p>' : '<p class="hint">Nothing to revoke.</p>';
}

async function runRefine(body) {
  const r = state.last;
  const id = state.buildId;
  if (!r || !id) return toast('err', 'Open a build first.');
  resetBuildPane('Updating…');
  $('#steps').hidden = false;
  showTab('progress');
  try { eta.studio = await api(`/api/estimate?website=${r.business.website ? 1 : 0}&audit=0`); } catch { /* keep the old estimate */ }
  const t0 = performance.now();
  let built = false;
  etaStart();
  try {
    if (state.health?.vercel) {
      logStep({ step: 'Updating on Vercel (steps appear when it finishes)', status: 'start' });
      const res = await postJson(`/api/builds/${encodeURIComponent(id)}/personalise?wait=1`, body);
      $('#log').innerHTML = '';
      for (const s of res.steps || []) logStep({ step: s.name, status: s.ok ? 'done' : 'error', ms: s.ms, note: s.note });
      sites.openId = res.jobId;
      renderResult(res, performance.now() - t0);
    } else {
      const { jobId } = await postJson(`/api/builds/${encodeURIComponent(id)}/personalise`, body);
      await followJob(jobId, t0);
    }
    built = true;
    toast('ok', body.alternative ? 'Here\'s a different design.' : 'Preview updated with the new answers.');
  } catch (e) {
    logStep({ step: 'Update failed', status: 'error', note: e.message });
    $('#stepsLabel').textContent = 'Update failed';
    toast('err', `Update failed: ${esc(e.message)}`);
    if (!built && r) renderResult(r); // keep the previous result on screen
  } finally { etaStop(built); loadSites(); }
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-pz-open]')) {
    const wrap = $('#pzWrap');
    if (!wrap || !state.last) return;
    wrap.innerHTML = pzForm(state.last);
    const est = await api(`/api/estimate?website=${state.last.business.website ? 1 : 0}&audit=0`).catch(() => null);
    if (est && $('#pzEta')) $('#pzEta').textContent = `Takes ${est.label}`;
    wrap.querySelector('input:checked, input')?.focus();
    return;
  }
  if (e.target.closest('[data-pz-cancel]')) { $('#pzWrap').innerHTML = ''; return; }
  const ol = e.target.closest('[data-owner-link]');
  if (ol) { ownerLink(ol.getAttribute('data-owner-link')); return; }
  const rv = e.target.closest('[data-owner-revoke]');
  if (rv) { revokeOwnerLink(rv.getAttribute('data-owner-revoke')); return; }
  if (e.target.closest('[data-pz-alt]')) runRefine({ preferences: state.last?.design?.preferences || {}, alternative: true });
});
document.addEventListener('change', (e) => {
  if (e.target.matches?.('#pzForm input[name="goal"]')) $('[data-pz-appt]').hidden = e.target.value !== 'appointment';
  if (e.target.matches?.('#pzOther')) { const o = $('#pzForm input[name="service"][value="__other"]'); if (o) o.checked = true; }
});
document.addEventListener('input', (e) => { if (e.target.matches?.('#pzOther') && e.target.value) { const o = $('#pzForm input[name="service"][value="__other"]'); if (o) o.checked = true; } });
document.addEventListener('submit', (e) => {
  if (e.target.id !== 'pzForm') return;
  e.preventDefault();
  let prefs;
  try { prefs = pzValues(); } catch (err) { toast('err', esc(err.message)); $('#pzOther').focus(); return; }
  if ($('#pzOptIn') && !$('#pzOptIn').checked) { toast('err', 'Tick "Replace the chosen theme" to personalise a site built with a chosen theme.'); $('#pzOptIn').focus(); return; }
  runRefine({ preferences: prefs, optIn: !!$('#pzOptIn')?.checked });
});

/* ── audit ── */
const CAT_LABEL = { security: 'Security', speed: 'Speed', mobile: 'Mobile', seo: 'Google search', accessibility: 'Accessibility', conversion: 'Getting leads', trust: 'Trust & accuracy' };
const PSI_LABEL = { performance: 'Performance', accessibility: 'Accessibility', 'best-practices': 'Best practices', seo: 'SEO' };
const psiColor = (s) => (s >= 90 ? '#0C7A43' : s >= 50 ? '#C33300' : '#CC0F0F');
/** Google PageSpeed Insights scores for phones and computers, with Core Web Vitals and a link to Google's report. */
function psiBlock(ps) {
  if (!ps || !ps.reportUrl) return '';
  const runs = [ps.mobile, ps.desktop].filter(Boolean);
  if (!runs.length) return ps.error && !['no-key', 'disabled'].includes(ps.error.code) ? `<p class="hint psi-err">${ic('alert')}Google PageSpeed didn't run: ${esc(ps.error.message)}</p>` : '';
  const row = (r) => `<div class="psi-row"><span class="psi-dev">${r.strategy === 'mobile' ? 'Phones' : 'Computers'}</span>${Object.entries(PSI_LABEL).map(([k, l]) => (r.scores[k] == null ? '' : `<span class="psi-s" title="${esc(l)}"><b style="color:${psiColor(r.scores[k])}">${r.scores[k]}</b><small>${esc(l)}</small></span>`)).join('')}</div>`;
  const m = runs[0];
  const vit = [['LCP', m.lab.lcp], ['TBT', m.lab.tbt], ['CLS', m.lab.cls]].filter(([, v]) => v).map(([k, v]) => `${k} ${esc(v)}`).join(' · ');
  const field = m.field?.overall ? ` · real visitors: <b>${{ FAST: 'good', AVERAGE: 'needs improvement', SLOW: 'poor' }[m.field.overall]}</b>` : '';
  const flagged = m.findings.length;
  return `<div class="psi"><div class="psi-h"><b>Google PageSpeed Insights</b><a class="btn ghost sm" href="${esc(ps.reportUrl)}" target="_blank" rel="noopener">${ic('ext')}On Google</a></div>${runs.map(row).join('')}
    <p class="hint">${vit}${field}${flagged ? ` · ${flagged} check${flagged === 1 ? '' : 's'} flagged (see the full report)` : ''}</p></div>`;
}
const emptyHtml = (icon, title, text) => `<span class="es-ic">${ic(icon)}</span><h2>${esc(title)}</h2><p>${text}</p>`;
function scoreColor(s) { return s >= 90 ? '#15803D' : s >= 75 ? '#65A30D' : s >= 60 ? '#CA8A04' : s >= 40 ? '#EA580C' : '#DC2626'; }
/** Old site against the new site: Roger's check plus Google's four categories, the same checks on both. */
function scoreCompare(oldA, newA) {
  if (!newA) return '';
  const run = (a) => a?.metrics?.pagespeed?.mobile || a?.metrics?.pagespeed?.desktop;
  const om = run(oldA), nm = run(newA);
  const rows = [['Roger\'s website check', oldA?.score, newA.score], ...Object.entries(PSI_LABEL).map(([k, l]) => [`${l}${(nm || om)?.strategy === 'desktop' ? '' : ' (phones)'}`, om?.scores?.[k] ?? (k === 'performance' ? oldA?.metrics?.pagespeed?.performance : undefined), nm?.scores?.[k]])]
    .filter(([, o, n]) => o != null || n != null);
  const cell = (v, other) => (v == null ? '<td class="na">—</td>' : `<td><b style="color:${psiColor(v)}">${v}</b>${other != null && v > other ? ' <span class="up">+' + (v - other) + '</span>' : ''}</td>`);
  const src = newA.metrics?.pagespeed?.source === 'local' ? 'New site: Lighthouse on this server (Google can\'t reach a local preview).' : newA.metrics?.pagespeed?.source === 'google' ? 'New site: Google PageSpeed Insights.' : '';
  const err = newA.metrics?.pagespeed?.error && !nm ? ` Lighthouse didn't run: ${newA.metrics.pagespeed.error.message}` : '';
  return `<section class="cmp" aria-labelledby="cmp-h"><h3 id="cmp-h">${ic('gauge')}${oldA ? 'Current site vs. new site' : 'New site scores'}</h3>
    <table><thead><tr><th scope="col"></th>${oldA ? '<th scope="col">Current site</th>' : ''}<th scope="col">New site</th></tr></thead><tbody>
    ${rows.map(([k, o, n]) => `<tr><th scope="row">${esc(k)}</th>${oldA ? cell(o, n) : ''}${cell(n, o)}</tr>`).join('')}
    <tr><th scope="row">Main content appears${(nm || om)?.strategy === 'desktop' ? '' : ' (phones)'}</th>${oldA ? `<td>${esc(om?.lab?.lcp || '—')}</td>` : ''}<td>${esc(nm?.lab?.lcp || '—')}</td></tr>
    <tr><th scope="row">Things to fix</th>${oldA ? `<td>${oldA.issues.length}</td>` : ''}<td>${newA.issues.length}</td></tr></tbody></table>
    <p class="hint">${esc(src + err)}${oldA?.metrics?.pagespeed?.source === 'google' || oldA?.metrics?.pagespeed?.mobile ? ' Current site: Google PageSpeed Insights.' : ''}</p></section>`;
}

/** newSite: the new site's scores to compare with; isNew: this audit is of the new site itself */
function renderAudit(a, reportUrl, newSite, isNew) {
  const c = scoreColor(a.score);
  const cats = a.categories ? `<div class="cats">${Object.entries(a.categories).map(([k, v]) => `<div class="cat"><div class="r"><span>${esc(CAT_LABEL[k] || k)}</span><b>${v}</b></div><div class="bar"><i style="width:${v}%;background:${scoreColor(v)}"></i></div></div>`).join('')}</div>` : '';
  $('#auditOut').className = '';
  $('#auditOut').innerHTML = `<div class="score"><svg class="ring" viewBox="0 0 100 100" role="img" aria-label="Score ${a.score} out of 100"><circle cx="50" cy="50" r="42" fill="none" stroke="#E2E8F0" stroke-width="9"/><circle cx="50" cy="50" r="42" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(a.score / 100) * 263.9} 263.9" transform="rotate(-90 50 50)"/><text x="50" y="58" text-anchor="middle" font-size="26" font-weight="700" fill="#0F172A">${a.score}</text></svg>
    <div><b>${esc(isNew ? `The new site scores ${a.score}/100 on the same checks as a website audit.` : a.summary.headline)}</b><p>${esc(isNew ? 'There was no current website to compare with.' : a.summary.pitch)}</p>${reportUrl ? `<a class="btn ghost sm" href="${esc(reportUrl)}" target="_blank" rel="noopener">${ic('ext')}Full report</a>` : ''}</div></div>
    ${newSite ? scoreCompare(a, newSite) : ''}
    ${cats}
    ${psiBlock(a.metrics?.pagespeed)}
    <h3 class="issues-h">${a.issues.length ? `${a.issues.length} thing${a.issues.length > 1 ? 's' : ''} to fix` : 'Nothing to fix'}</h3>
    <ul class="issues">${a.issues.map((i) => `<li class="${esc(i.severity)}"><span class="sev ${esc(i.severity)}">${esc(i.severity)}</span><div><b>${esc(i.title)}</b><p>${esc(i.detail)}</p><p class="fix"><b>Fix:</b> ${esc(i.fix)}</p></div></li>`).join('')}</ul>`;
}
$('#auditBtn').addEventListener('click', async () => {
  const website = $('#website').value.trim();
  if (!website) return $('#website').focus();
  const btn = $('#auditBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Auditing';
  try {
    const r = await postJson('/api/audit', { website, placeId: state.placeId || undefined, google: state.placeId ? undefined : $('#q').value.trim() || undefined });
    renderAudit(r.audit, r.reportUrl);
    renderCards([r.card], 'Step 2 · audit');
    showTab('audit');
  } catch (e) { toast('err', `Audit failed: ${esc(e.message)}`); } finally { btn.disabled = false; btn.textContent = 'Audit only'; }
});

/* ── iMessage cards ── */
function host(u) { try { return new URL(u).host; } catch { return u; } }
function cardHtml(c) {
  return `<div class="bub in">${esc(c.text)}</div>${c.url ? `<a class="link-card" href="${esc(c.url)}" target="_blank" rel="noopener">${c.image ? `<img src="${esc(c.image)}" alt="">` : ''}<div><b>${esc(c.title || c.url.split('/').filter(Boolean).pop())}</b><span>${esc(host(c.url))}</span></div></a>` : ''}${c.quickReplies?.length ? `<div class="quick">${c.quickReplies.map((q) => `<button type="button" disabled>${esc(q)}</button>`).join('')}</div>` : ''}`;
}
function renderCards(cards, label) {
  $('#cardsOut').innerHTML = `<div class="step-label">${esc(label)}</div>${cards.map(cardHtml).join('')}`;
}

/* ── conversation simulator: nothing is sent until you text Roger ── */
const simFrom = `studio-${Math.random().toString(36).slice(2, 8)}`;
function simIntro() {
  $('#simLog').innerHTML = '<p class="sim-intro">Text Roger like an owner would: say hi, send a business name and ZIP, or paste their website.</p>';
  $('#simQuick').innerHTML = '<button type="button">Hi</button>';
  $('#simQuick button').addEventListener('click', () => simSend('Hi'));
}
onTab.sim = () => { if (!$('#simLog').children.length) simIntro(); };

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
  $('#simLog .sim-intro')?.remove();
  $('#simLog').insertAdjacentHTML('beforeend', `<div class="bub out">${esc(text)}</div><div class="typing" id="typing">Roger is typing</div>`);
  $('#simQuick').innerHTML = '';
  $('#simLog').scrollTop = 1e9;
  try {
    // async: a build answers "On it, about 20 seconds" now and the preview follows when it's done
    const res = await postJson('/api/imessage/inbound', { from: simFrom, text, async: true });
    $('#typing')?.remove();
    let replies = res.replies;
    replies.forEach((r) => $('#simLog').insertAdjacentHTML('beforeend', cardHtml({ ...r, quickReplies: [] })));
    if (res.pending) {
      $('#simLog').insertAdjacentHTML('beforeend', `<div class="typing" id="typing">Roger is building the preview (${esc(res.pending.label)})</div>`);
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
$('#simReset').addEventListener('click', async () => {
  await postJson('/api/imessage/reset', { from: simFrom }).catch(() => {});
  simIntro();
});

/* ── preview + JSON tools ── */
$('#reloadFrame').addEventListener('click', () => { if (state.last) $('#frame').src = `${state.last.siteUrl}?t=${Date.now()}`; });
$('#copyJson').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#dataOut').textContent); toast('ok', 'Build JSON copied.'); } catch { toast('err', 'Could not copy: the browser blocked the clipboard.'); }
});

/* ── Sites: every saved build (Studio, iMessage page, API) and every conversation ── */
const SRC = { studio: 'Studio', imessage: 'iMessage', api: 'API', imported: 'Imported' };
const sites = { ids: null, sig: '', unseen: 0, openId: null, data: null };
function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const who = (from) => (from.startsWith('imsg-') ? 'iMessage demo page' : from.startsWith('studio-') ? 'Studio simulator' : from);

function siteCard(b) {
  const ok = b.status === 'done';
  const p = b.published;
  const img = b.siteUrl ? `<img src="${esc(b.siteUrl)}preview.jpg" alt="" loading="lazy" onerror="this.onerror=null;this.src='${esc(b.siteUrl)}og.jpg'">` : '';
  const badge = !ok ? '<span class="badge failed">Build failed</span>'
    : b.replaced ? '<span class="badge">Older build</span>'
    : p ? (p.stale ? '<span class="badge stale">Live · update ready</span>' : '<span class="badge live">Live</span>')
    : '<span class="badge">Preview</span>';
  const meta = ok ? [b.category, b.address].filter(Boolean).join(' · ') : b.error || 'Build failed';
  const tags = ok ? [
    `<span class="src ${esc(b.source)}">${esc(SRC[b.source] || b.source)}</span>`,
    b.themeId && `<span class="tag mono">${esc(b.themeId)}</span>`,
    b.auditScore != null && `<span class="tag" title="Score of their current website">Old site ${b.auditScore}/100</span>`,
    b.newSiteScore != null && `<span class="tag tag-new" title="The same checks, run on the new site">New site ${b.newSiteScore}/100</span>`,
  ].filter(Boolean).join('') : '';
  return `<article class="site-card${sites.openId === b.id ? ' sel' : ''}${b.replaced ? ' old' : ''}">
    <button type="button" class="site-open" data-build="${esc(b.id)}" aria-label="Open ${esc(b.name || 'failed build')} in the Studio">
      <div class="thumb">${img}${badge}</div>
      <div class="site-body"><h3>${esc(b.name || 'Build failed')}</h3><p class="meta" title="${esc(meta)}">${esc(meta)}</p>${tags ? `<div class="tags">${tags}</div>` : ''}</div>
    </button>
    <footer class="site-foot"><span class="time" title="${esc(new Date(b.createdAt).toLocaleString())}">${esc(ago(b.createdAt))}</span><div class="acts">${cardActions(b)}</div></footer>
  </article>`;
}

function cardActions(b) {
  const id = `m-${b.id.replace(/[^\w-]/g, '')}`;
  const name = b.name || 'this build';
  if (b.status !== 'done' || !b.siteUrl) return menuHtml(id, name, `<button type="button" class="danger-item" data-del-build="${esc(b.id)}">${ic('trash')}Remove from list</button>`);
  const p = b.replaced ? undefined : b.published;
  const pubOn = state.health?.publish;
  const pub = b.replaced || !pubOn ? ''
    : p ? (p.stale ? `<button class="btn ghost sm" type="button" data-publish="${esc(b.slug)}" title="This build is newer than the live site">${ic('cloud-up')}Update</button>` : `<a class="btn live sm" href="${esc(p.url)}" target="_blank" rel="noopener" title="Published ${esc(ago(p.at))}">${ic('globe')}Live</a>`)
    : `<button class="btn ghost sm" type="button" data-publish="${esc(b.slug)}">${ic('cloud-up')}Publish</button>`;
  const top = [
    `<a href="${esc(b.siteUrl)}" target="_blank" rel="noopener">${ic('ext')}Open preview site</a>`,
    p ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${ic('globe')}Open live site</a>` : '',
    p && pubOn ? `<button type="button" data-unpublish="${esc(b.slug)}" data-name="${esc(name)}">${ic('cloud-off')}Unpublish</button>` : '',
  ].join('');
  const del = b.replaced ? '' : `<hr><button type="button" class="danger-item" data-delete="${esc(b.slug)}" data-name="${esc(name)}">${ic('trash')}Delete site…</button>`;
  return pub + menuHtml(id, name, top + del);
}

function convoRow(c) {
  const sitesN = c.buildIds.length ? `${c.buildIds.length} site${c.buildIds.length > 1 ? 's' : ''}` : 'no site yet';
  return `<button type="button" class="convo" data-convo="${esc(c.from)}"><span class="av">${esc((c.business || 'R')[0].toUpperCase())}</span><span style="min-width:0"><b>${esc(c.business || who(c.from))}</b><span class="line">${esc(c.last)}</span><span class="line">${esc(who(c.from))} · ${c.messages} messages · ${sitesN}</span></span><span class="when">${esc(ago(c.updatedAt))}</span></button>`;
}

// saved messages, drawn like the simulator: the owner's texts in blue, Roger's replies + link cards in gray
const transcriptHtml = (c) => c.messages.map((m) => (m.dir === 'in' ? `<div class="bub out">${esc(m.text)}</div>` : cardHtml({ ...m, text: m.text || '', quickReplies: [] }))).join('');

function updateCount() {
  const el = $('#sitesCount');
  el.hidden = !sites.unseen;
  el.textContent = sites.unseen ? `${sites.unseen} new` : '';
}

function drawSites() {
  if (!sites.data) return;
  const { builds, conversations } = sites.data;
  const q = $('#siteFilter').value.trim().toLowerCase();
  const old = $('#showOld').checked;
  const olderN = builds.filter((b) => b.replaced).length;
  $('#showOld').closest('label').hidden = !olderN;
  const list = builds.filter((b) => (old || !b.replaced) && (!q || [b.name, b.category, b.address, b.themeId].join(' ').toLowerCase().includes(q)));
  $('#sitesList').innerHTML = list.length ? list.map(siteCard).join('')
    : builds.length ? `<p class="hint">No sites match “${esc(q)}”.</p>`
    : `<div class="empty-state small">${emptyHtml('grid', 'No sites yet', 'Build one with the panel on the left, or text Roger on the <a href="/imessage/" target="_blank" rel="noopener">iMessage demo</a>.')}</div>`;
  $('#convosList').innerHTML = conversations.length ? conversations.map(convoRow).join('') : '<p class="hint">No conversations yet.</p>';
}
$('#siteFilter').addEventListener('input', drawSites);
$('#showOld').addEventListener('change', drawSites);

async function loadSites() {
  try {
    const [{ builds }, { conversations }] = await Promise.all([api('/api/builds'), api('/api/conversations')]);
    const ids = builds.map((b) => b.id);
    if (sites.ids && $('[data-pane="sites"]').hidden) sites.unseen += ids.filter((id) => !sites.ids.includes(id)).length;
    sites.ids = ids;
    updateCount();
    const sig = JSON.stringify([builds, conversations, sites.openId]);
    if (sig !== sites.sig) { // only redraw when something changed, so hover, focus and open menus survive the polling
      sites.sig = sig;
      sites.data = { builds, conversations };
      drawSites();
    }
    return builds;
  } catch (e) {
    $('#sitesList').innerHTML = `<p class="hint err">Could not load saved sites: ${esc(e.message)}</p>`;
    return [];
  }
}

function clearOpenSite() {
  state.last = null; sites.openId = null;
  resetBuildPane('Build steps');
  $('#empty').hidden = false;
  $('#frame').removeAttribute('src'); $('#openSite').removeAttribute('href');
  $('#urlbar').textContent = 'No site open'; $('#urlbar').title = '';
  $('#dataOut').textContent = 'Build something first.';
  $('#cardsOut').innerHTML = '<p class="hint center">No messages yet. Open a site, find a business, or build one.</p>';
  $('#auditOut').className = 'empty-state small';
  $('#auditOut').innerHTML = emptyHtml('gauge', 'No audit yet', 'Add the business’s website and build, or use <b>Audit only</b>.');
}

/** stay: fill the tabs without leaving the current one (used when the Studio opens) */
async function openBuild(id, { stay = false } = {}) {
  const rec = await api(`/api/builds/${encodeURIComponent(id)}`);
  sites.openId = id;
  sites.sig = ''; // redraw the list with this card selected
  loadSites();
  resetBuildPane('Build steps');
  if (!stay) showTab('progress');
  if (rec.status !== 'done' || !rec.result) { logStep({ step: 'Build failed', status: 'error', note: rec.error || '' }); $('#stepsLabel').textContent = 'Build failed'; return; }
  for (const s of rec.result.steps) logStep({ step: s.name, status: s.ok ? 'done' : 'error', ms: s.ms, note: s.note });
  renderResult(rec.result, rec.result.totalMs, rec);
  if (rec.from) {
    const c = await api(`/api/conversations/${encodeURIComponent(rec.from)}`).catch(() => null);
    if (c && state.last === rec.result) $('#summary .sum').insertAdjacentHTML('beforeend', `<details class="convo-in-sum"><summary>The iMessage conversation · ${c.messages.length} messages, ${esc(who(c.from))}</summary><div class="phone-ui"><div class="transcript">${transcriptHtml(c)}</div></div></details>`);
  }
}

async function openConvo(from) {
  const c = await api(`/api/conversations/${encodeURIComponent(from)}`);
  const lastBuild = c.buildIds[c.buildIds.length - 1];
  $('#convoTitle').textContent = c.business ? `${c.business} · ${who(c.from)}` : who(c.from);
  $('#convoView').innerHTML = `<div class="convo-view">${lastBuild ? `<button class="btn ghost sm" type="button" data-build="${esc(lastBuild)}" style="margin-bottom:12px">${ic('ext')}Open the site it built</button>` : ''}<div class="phone-ui"><div class="transcript">${transcriptHtml(c)}</div></div></div>`;
  $('#convoDlg').showModal();
}
$('#convoDlg').addEventListener('click', (e) => {
  const d = $('#convoDlg');
  if (e.target === d || e.target.closest('[data-close]')) return d.close();
  const b = e.target.closest('[data-build]');
  if (b) { d.close(); openBuild(b.dataset.build).catch((err) => toast('err', esc(err.message))); }
});

$('[data-pane="sites"]').addEventListener('click', (e) => {
  const b = e.target.closest('[data-build]');
  if (b) { openBuild(b.dataset.build).catch((err) => toast('err', esc(err.message))); return; }
  const c = e.target.closest('[data-convo]');
  if (c) openConvo(c.dataset.convo).catch((err) => toast('err', esc(err.message)));
});
onTab.sites = () => { sites.unseen = 0; updateCount(); loadSites(); };

/* ── publish / unpublish / delete (from the site cards and the build summary) ── */
const afterChange = () => { fillPubCtls(); sites.sig = ''; loadSites(); };

async function publish(btn) {
  const slug = btn.dataset.publish;
  const html = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Publishing…';
  try {
    const p = await postJson(`/api/sites/${encodeURIComponent(slug)}/publish`, {});
    toast('ok', `Published: <a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a>`, 8000);
    afterChange();
  } catch (err) {
    btn.disabled = false; btn.innerHTML = html;
    // not ready: list what the owner (or the team) still has to review, with the editor link to do it
    const items = (err.blockers || []).slice(0, 6).map((b) => `<li>${esc(b.message)}</li>`).join('');
    toast('err', `Publish failed: ${esc(err.message)}${items ? `<ul style="margin:6px 0 0;padding-left:18px">${items}</ul><span class="hint">The owner reviews these in their editor (Business tab), or open it from Owner editor link.</span>` : ''}`, items ? 15000 : undefined);
  }
}

const unpublish = (slug, name) => confirmDialog({
  title: `Take ${name || slug} offline?`,
  body: 'Its Vercel project is deleted, so the live link stops working. The site stays here in Roger and you can publish it again.',
  ok: 'Unpublish',
  run: async () => {
    const r = await api(`/api/sites/${encodeURIComponent(slug)}/publish`, { method: 'DELETE' }).catch((e) => { throw new Error(`Unpublish failed: ${e.message}`); });
    toast('ok', `${esc(name || slug)} is offline${r.removed ? '' : ' (it was already gone on Vercel)'}.`);
    afterChange();
  },
});

const deleteSite = (slug, name) => confirmDialog({
  title: `Delete ${name || slug}?`,
  body: 'This removes its pages, photos, audit report and saved builds, and takes it off Vercel if it is published. The iMessage conversation and any leads are kept. This can’t be undone.',
  ok: 'Delete site',
  run: async () => {
    const r = await api(`/api/sites/${encodeURIComponent(slug)}`, { method: 'DELETE' }).catch((e) => { throw new Error(`Delete failed: ${e.message}`); });
    toast('ok', `Deleted <b>${esc(name || slug)}</b>${r.unpublished ? ' and took it off Vercel' : ''}.`);
    if (state.last?.slug === slug) clearOpenSite();
    afterChange();
  },
});

async function removeBuild(id) {
  try {
    await api(`/api/builds/${encodeURIComponent(id)}`, { method: 'DELETE' });
    toast('ok', 'Removed the failed build.');
    sites.sig = ''; loadSites();
  } catch (err) { toast('err', `Could not remove it: ${esc(err.message)}`); }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-publish],[data-unpublish],[data-delete],[data-del-build]');
  if (!t || t.disabled) return;
  try { t.closest('.menu')?.hidePopover(); } catch { /* not open */ }
  if (t.dataset.publish) publish(t);
  else if (t.dataset.unpublish) unpublish(t.dataset.unpublish, t.dataset.name);
  else if (t.dataset.delete) deleteSite(t.dataset.delete, t.dataset.name);
  else removeBuild(t.dataset.delBuild);
});
// a link in a ⋯ menu closes the menu too
document.addEventListener('click', (e) => { const a = e.target.closest('.menu a, .menu [data-show-tab]'); if (a) try { a.closest('.menu').hidePopover(); } catch { /* not open */ } });

// first load: open the Sites tab and put the newest site in the other tabs, so Preview, Audit and Messages aren't empty
loadSites().then((builds) => {
  if (!builds.length || state.last) return;
  showTab('sites');
  const newest = builds.find((b) => b.status === 'done');
  if (newest) openBuild(newest.id, { stay: true }).catch(() => {});
});
setInterval(() => { if (!document.hidden) loadSites(); }, 5000);

/* ── build-time estimate: shown before building, and the line Roger texts the owner ── */
const eta = { studio: null, roger: null, timer: null, t0: 0 };
const rogerLine = () => (eta.roger ? `<span class="say">Roger tells the owner: <q>ready in ${esc(eta.roger.label)}</q></span>` : '');

async function updateEta() {
  if (eta.timer) return; // a build is running: keep showing its progress
  const web = $('#website').value.trim() ? 1 : 0;
  try {
    // a Studio build audits the website too; Roger's iMessage build skips that (the audit already ran in the chat)
    [eta.studio, eta.roger] = await Promise.all([api(`/api/estimate?website=${web}&audit=${web}`), api(`/api/estimate?website=${web}&audit=0`)]);
    $('#eta').className = 'eta';
    $('#eta').title = eta.studio.basis;
    $('#eta').innerHTML = `${ic('clock')}<b>Takes ${esc(eta.studio.label)}</b>${rogerLine()}`;
    $('#eta').hidden = false;
  } catch { $('#eta').hidden = true; }
}

function etaStart() {
  eta.t0 = performance.now();
  const tick = () => {
    const s = Math.round((performance.now() - eta.t0) / 1000);
    $('#eta').className = 'eta running';
    $('#eta').innerHTML = `${ic('clock')}<b>Building… ${s}s</b><span class="say">${eta.studio ? `Estimate: ${esc(eta.studio.label)}` : ''}</span>`;
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
  $('#eta').title = 'Future estimates include this build.';
  $('#eta').innerHTML = `${ic('check')}<b>Built in ${took.toFixed(1)}s</b><span class="say">Estimate was ${eta.studio ? esc(eta.studio.label) : 'not available'}${slower ? ', this one ran slower' : ''}</span>`;
}

let etaDebounce;
$('#website').addEventListener('input', () => { clearTimeout(etaDebounce); etaDebounce = setTimeout(updateEta, 300); });
updateEta();
