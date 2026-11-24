/*
 * Roger Studio · New site: Find business → Review sources and audit → Generate and preview.
 * Nothing is selected for staff: a business is used only after its card's "Select this business" is pressed, and
 * research and generation each start only from their own button. Polling never starts a paid task.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || ''); } };
  const MAPS = /^(https?:\/\/)?((www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps|g\.page)/i;
  const KEY = 'roger-newsite-v2';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const mins = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };

  /** what staff chose and started (kept across a reload) */
  const S = { candidates: [], selected: null, researchJobId: null, saved: null, brief: null, designJobId: null, kind: 'splash' };
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ selected: S.selected, researchJobId: S.researchJobId, brief: S.brief, designJobId: S.designJobId, kind: S.kind })); } catch { /* private mode */ } };
  const restore = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };

  async function api(url, opts = {}) {
    const res = await fetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }
  const post = (url, body, signal) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal });
  function say(id, text, kind = '') { const el = $(id); el.textContent = text || ''; el.className = `status-line${kind ? ` ${kind}` : ''}`; }

  /* ── the step indicator and which stages are open ── */
  function steps() {
    const set = (id, state) => { $(id).dataset.state = state; };
    set('step-find', S.selected ? 'done' : 'current');
    set('step-sources', !S.selected ? 'locked' : S.brief ? 'done' : 'current');
    set('step-generate', S.brief ? 'current' : 'locked');
    const lock = (sec, locked) => { if (locked) $(sec).setAttribute('data-locked', ''); else $(sec).removeAttribute('data-locked'); };
    lock('s-sources', !S.selected); $('sources-body').hidden = !S.selected;
    lock('s-generate', !S.brief); $('generate-body').hidden = !S.brief;
    $('sources-hint').textContent = S.selected ? 'Check the website, audit the current site, and research the business. Generation uses only verified facts.' : 'Select a business in step 1 first.';
    $('generate-hint').textContent = S.brief ? `Uses brief r${S.brief.revision} for ${S.selected?.name ?? 'the selected business'}.` : 'Finish step 2 (a researched or saved brief for the selected business) first.';
  }

  /* ───────────── 1. Find business ───────────── */
  let findCtl = null;
  const websiteOf = (c) => c.website || c.googleWebsite || '';
  function cardHtml(c, i) {
    const web = websiteOf(c);
    const rating = c.rating ? `${Number(c.rating).toFixed(1)}★${c.reviewCount ? ` · ${c.reviewCount} reviews` : ''}` : 'No rating';
    return `<article class="biz" data-i="${i}" aria-current="false">
      <h3>${esc(c.name)}</h3>
      <p class="addr">${esc(c.address || 'No address on the listing')}</p>
      <dl><dt>Category</dt><dd>${esc(c.primaryTypeLabel || c.primaryType || 'Not given')}</dd>
      <dt>Website</dt><dd>${web ? `<a href="${esc(web)}" target="_blank" rel="noopener">${esc(host(web))}</a>` : 'None on the listing'}</dd>
      <dt>Rating</dt><dd>${esc(rating)}</dd>
      <dt>Place ID</dt><dd><code>${esc(c.placeId)}</code></dd></dl>
      <div class="acts"><button type="button" class="btn sm" data-select="${i}">Select this business</button>${c.mapsUrl ? `<a class="btn ghost sm" href="${esc(c.mapsUrl)}" target="_blank" rel="noopener">Open in Google Maps</a>` : ''}</div>
    </article>`;
  }
  function summary(r, n) {
    if (r.status === 'confirmed' && r.via === 'place-id') return 'The link names this listing. Check it, then select it.';
    if (r.status === 'need-name') return `That looks like an address, not a business name. ${n} business${n === 1 ? '' : 'es'} found there: select the right one, or search by its name.`;
    if (r.status === 'confirmed') return 'One listing matches. Check the name and full address, then select it.';
    return `${n} listing${n === 1 ? "" : "s"} found. None is chosen for you: select the right one.`;
  }
  $('find-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('f-name').value.trim(), where = $('f-where').value.trim(), maps = $('f-maps').value.trim(), site = $('f-site').value.trim();
    if (!name && !where && !maps && !site) return say('find-status', 'Enter a business name (and a city, ZIP or street), paste a Google Maps link, or enter the business\'s website.', 'error');
    if (maps && !MAPS.test(maps)) return say('find-status', 'That is not a Google Maps link. Copy it from the listing\'s Share button, or leave the field empty.', 'error');
    // a website alone: the business is researched from its own site (research also looks for its Google listing)
    if (site && !name && !where && !maps) {
      const url = /^https?:\/\//i.test(site) ? site : `https://${site}`;
      if (!/^https?:\/\/[^\s/]+\.[a-z]{2,}(?:[/:?#]\S*)?$/i.test(url)) return say('find-status', 'That is not a website address. Enter it like https://example.com.', 'error');
      findCtl?.abort(); S.candidates = []; $('results').replaceChildren();
      say('find-status', 'Starting from the website. Research in step 2 reads it and looks for its Google listing.', 'ok');
      return select({ name: host(url), website: url, address: '', placeId: null, fromWebsite: true });
    }
    findCtl?.abort(); findCtl = new AbortController();
    S.candidates = []; $('results').replaceChildren();
    $('find-btn').disabled = true; $('find-cancel').hidden = false;
    say('find-status', 'Searching Google…', 'loading');
    try {
      const body = maps ? { text: maps } : { ...(name ? { name } : {}), ...(where ? { address: where } : {}) };
      const r = await post('/api/studio/resolve', body, findCtl.signal);
      const list = r.status === 'confirmed' ? [r.candidate] : (r.candidates || []);
      S.candidates = list;
      if (!list.length) {
        say('find-status', '');
        $('results').innerHTML = `<div class="empty"><b>No Google business found.</b> ${esc(r.reason || '')} Try the name exactly as it appears on Google, add the city or ZIP, or paste the listing's Google Maps link.</div>`;
        return;
      }
      say('find-status', summary(r, list.length));
      $('results').innerHTML = list.map(cardHtml).join('');
      $('results').hidden = false;
    } catch (err) {
      if (err.name === 'AbortError') say('find-status', 'Search cancelled. No business was selected.', 'cancelled');
      else say('find-status', `The search failed: ${err.message}`, 'error');
    } finally { $('find-btn').disabled = false; $('find-cancel').hidden = true; findCtl = null; }
  });
  $('find-cancel').addEventListener('click', () => findCtl?.abort());
  $('results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-select]');
    if (b) select(S.candidates[Number(b.dataset.select)]);
  });

  function resetAfterFind() {
    stopResearch = true; stopDesign = true;
    S.researchJobId = null; S.brief = null; S.designJobId = null; S.saved = null;
    ['audit-out', 'brief-out'].forEach((id) => $(id).replaceChildren());
    ['audit-status', 'research-status', 'generate-status', 'action-status'].forEach((id) => say(id, ''));
    $('research-stages').hidden = true; $('saved-brief').hidden = true; $('result').hidden = true; $('generate-meter').hidden = true; $('generate-error').hidden = true;
    $('research-btn').textContent = 'Research this business'; $('research-btn').disabled = false;
    $('generate-btn').textContent = 'Generate new website'; $('generate-btn').disabled = false;
  }
  function select(c) {
    if (!c) return;
    resetAfterFind();
    S.selected = c; persist();
    renderSelected();
    initSources();
    steps();
  }
  function renderSelected() {
    const c = S.selected;
    if (!c) { $('selected').hidden = true; return; }
    $('selected').innerHTML = `<div><span class="tag ok">Selected</span> <b>${esc(c.name)}</b><div class="addr">${esc(c.address || '')}</div>${c.placeId ? `<code class="pid">Place ID ${esc(c.placeId)}</code>` : `<code class="pid">From the website ${esc(host(c.website))} · no Google listing yet</code>`}</div><button type="button" class="btn ghost sm" id="change-biz">Change business</button>`;
    $('selected').hidden = false;
    $('results').hidden = true;
    $('change-biz').addEventListener('click', () => {
      resetAfterFind(); S.selected = null; persist();
      $('selected').hidden = true; $('results').hidden = !S.candidates.length; steps();
      if (S.candidates.length) say('find-status', 'Select the right business.'); else $('f-name').focus();
    });
  }

  /* ───────────── 2. Review sources and audit ───────────── */
  function initSources() {
    const c = S.selected, web = websiteOf(c);
    $('site-url').value = web;
    $('site-none').checked = !web;
    $('site-none').disabled = !c.placeId; // a business started from its website always keeps it
    $('site-origin').textContent = !c.placeId ? 'Entered in step 1. Research reads this website and looks for the business\'s Google listing.' : web ? `From the Google listing: ${host(web)}. Correct it here if it is wrong.` : 'The Google listing has no website. Add one if the business has a site, or leave "No website" ticked.';
    siteControls();
    loadSaved(c).catch(() => undefined);
  }
  function siteControls() {
    const none = $('site-none').checked;
    $('site-url').disabled = none;
    const url = $('site-url').value.trim();
    $('audit-btn').disabled = none || !/^https?:\/\/\S+\.\S+/.test(url);
    $('site-open').hidden = none || !/^https?:\/\//.test(url);
    if (!$('site-open').hidden) $('site-open').href = url;
  }
  $('site-url').addEventListener('input', siteControls);
  $('site-none').addEventListener('change', siteControls);

  /** the saved brief of exactly this listing (place-<Place ID>), offered as a compact staff option */
  async function loadSaved(c) {
    if (!c.placeId) return;
    const { businesses } = await api('/api/studio/businesses');
    const hit = (businesses || []).find((b) => b.businessKey === `place-${c.placeId}`);
    if (!hit || S.selected?.placeId !== c.placeId) return;
    const r = await api(`/api/studio/briefs/${encodeURIComponent(hit.businessKey)}?revision=${hit.revision}`).catch(() => null);
    S.saved = { businessKey: hit.businessKey, revision: hit.revision, capturedAt: r?.brief?.capturedAt };
    $('saved-brief').innerHTML = `<label class="check"><input type="checkbox" id="use-saved"> Reuse the saved brief r${hit.revision} for this listing${S.saved.capturedAt ? ` (researched ${esc(new Date(S.saved.capturedAt).toLocaleString())})` : ''}</label><p class="hint">Skips new research. Offered only because it is the brief of Place ID <code>${esc(c.placeId)}</code>.</p>`;
    $('saved-brief').hidden = false;
    $('use-saved').addEventListener('change', () => { $('research-btn').textContent = $('use-saved').checked ? 'Use the saved brief' : 'Research this business'; });
  }

  // the current website's audit (Roger's website check and Google PageSpeed): about the site the business has now
  let auditCtl = null;
  $('audit-btn').addEventListener('click', async () => {
    const website = $('site-url').value.trim();
    auditCtl?.abort(); auditCtl = new AbortController();
    $('audit-btn').disabled = true; $('audit-cancel').hidden = false; $('audit-out').replaceChildren();
    say('audit-status', `Auditing ${host(website)}: opening it at phone width and asking Google PageSpeed. This can take a minute…`, 'loading');
    try {
      const r = await post('/api/audit', { website, placeId: S.selected.placeId }, auditCtl.signal);
      say('audit-status', '');
      renderAudit(r.audit, r.reportUrl);
    } catch (err) {
      if (err.name === 'AbortError') say('audit-status', 'Audit cancelled.', 'cancelled');
      else say('audit-status', `The audit failed: ${err.message}`, 'error');
    } finally { $('audit-cancel').hidden = true; auditCtl = null; siteControls(); }
  });
  $('audit-cancel').addEventListener('click', () => auditCtl?.abort());
  function renderAudit(a, reportUrl) {
    if (!a) return;
    const sev = { critical: 'bad', high: 'bad', medium: 'warn', low: '' };
    const issues = (a.issues || []).slice(0, 8).map((i) => `<li><span class="tag ${sev[i.severity] ?? ''}">${esc(i.severity)}</span> <b>${esc(i.title)}</b>${i.detail ? `: ${esc(i.detail)}` : ''}</li>`).join('');
    $('audit-out').innerHTML = `
      <div class="score"><span class="grade" data-g="${esc(a.grade)}">${esc(a.grade)}</span><div><b>Current website: ${esc(a.score)}/100</b><div class="hint">${esc(a.summary?.headline || '')}</div>${a.reachable === false ? '<div class="hint">The site could not be reached.</div>' : ''}</div></div>
      ${issues ? `<h4>What the current site gets wrong</h4><ul class="issues">${issues}</ul>` : '<p class="hint">No issues found.</p>'}
      <p class="hint">${(a.passed || []).length} checks passed${(a.unknowns || []).length ? ` · not determined: ${a.unknowns.map((u) => esc(u.title)).join('; ')}` : ''}.</p>
      <div class="acts">${reportUrl ? `<a class="btn ghost sm" href="${esc(reportUrl)}" target="_blank" rel="noopener">Full audit report</a>` : ''}</div>
      <p class="hint">Desktop and phone screenshots of the current website are not available in Roger yet: use "Open current website" to look at it.</p>`;
  }

  // research: the brief generation uses (verified facts only)
  let stopResearch = false;
  $('research-btn').addEventListener('click', async () => {
    if (S.researchJobId && !S.brief) return watchResearch(S.researchJobId); // resume watching
    if ($('use-saved')?.checked && S.saved) { S.brief = { businessKey: S.saved.businessKey, revision: S.saved.revision }; persist(); return showBrief(); }
    const website = $('site-none').checked ? '' : $('site-url').value.trim();
    await startResearch(website);
  });
  async function startResearch(website) {
    $('research-btn').disabled = true; $('brief-out').replaceChildren();
    say('research-status', 'Starting research…', 'loading');
    try {
      const job = await post('/api/studio/jobs', website ? { website } : { google: S.selected.placeId });
      S.researchJobId = job.id; persist();
      await watchResearch(job.id);
    } catch (err) { say('research-status', `Research could not start: ${err.message}`, 'error'); $('research-btn').disabled = false; }
  }
  async function watchResearch(id) {
    stopResearch = false;
    $('research-btn').disabled = true; $('research-stop').hidden = false;
    const placeId = S.selected?.placeId, who = S.selected?.placeId || S.selected?.website;
    try {
      for (;;) {
        if (stopResearch) { say('research-status', 'Stopped watching. The research keeps running on the server; press "Resume watching" to follow it again.', 'cancelled'); $('research-btn').textContent = 'Resume watching'; return; }
        const job = await api(`/api/studio/jobs/${encodeURIComponent(id)}`);
        if ((S.selected?.placeId || S.selected?.website) !== who) return; // the business was changed meanwhile
        // a business started from its website: research may find its Google listing, which then becomes the selection
        if (job.status === 'done' && !placeId) {
          const found = /^place-(.+)$/.exec(job.businessKey || '')?.[1];
          if (found) { S.selected = { ...S.selected, placeId: found, fromWebsite: false }; renderSelected(); }
          say('research-status', found ? 'Research found the business\'s Google listing from its website.' : 'No Google listing was found for this website: the brief comes from the website alone.', 'ok');
          S.brief = { businessKey: job.businessKey, revision: job.revision }; persist();
          return showBrief();
        }
        const stages = job.stages || [];
        $('research-stages').hidden = false;
        $('research-stages').innerHTML = stages.map((s) => `<li data-s="${esc(s.status)}">${esc(s.name.replace(/_/g, ' '))}${s.progress ? ` ${s.progress.done}/${s.progress.total}` : ''}</li>`).join('');
        const running = stages.find((s) => s.status === 'running')?.name.replace(/_/g, ' ');
        const elapsed = mins((job.status === 'done' || job.status === 'failed' ? Date.parse(job.updatedAt) : Date.now()) - Date.parse(job.createdAt));
        if (job.status === 'failed') { say('research-status', `Research failed after ${elapsed}: ${job.error || 'unknown reason'}`, 'error'); $('research-btn').textContent = 'Research again'; S.researchJobId = null; persist(); return; }
        if (job.status === 'done') {
          // research from a website can land on another Google listing: it is used only for the business staff selected
          if (job.businessKey !== `place-${placeId}`) {
            S.researchJobId = null; persist();
            say('research-status', '');
            $('brief-out').innerHTML = `<div class="alert warn"><b>The website led to a different business record</b> (<code>${esc(job.businessKey || 'none')}</code>), not the selected listing <code>place-${esc(placeId)}</code>. It is not used.<div class="acts"><button type="button" class="btn sm" id="research-listing">Research from the Google listing only</button></div></div>`;
            $('research-listing').addEventListener('click', () => startResearch(''));
            $('research-btn').textContent = 'Research again';
            return;
          }
          say('research-status', `Research finished in ${elapsed}. AI cost for research is not recorded per job.`, 'ok');
          S.brief = { businessKey: job.businessKey, revision: job.revision }; persist();
          return showBrief();
        }
        say('research-status', `Researching · ${running || job.status} · ${elapsed}`, 'loading');
        await wait(2000);
      }
    } catch (err) { say('research-status', `Could not read the research job: ${err.message}`, 'error'); $('research-btn').textContent = 'Resume watching'; }
    finally { $('research-btn').disabled = false; $('research-stop').hidden = true; }
  }
  $('research-stop').addEventListener('click', () => { stopResearch = true; });

  const shown = (f) => (f && f.value !== null && f.value !== undefined && f.value !== '' ? f.value : null);
  function factRow(label, value, status) {
    const ok = value !== null && value !== undefined && String(value).trim() !== '';
    return `<tr><th scope="row">${esc(label)}</th><td>${ok ? esc(value) : '<span class="hint">Not found</span>'} ${ok ? `<span class="tag ${status === 'verified' ? 'ok' : 'warn'}">${esc(status || 'unverified')}</span>` : '<span class="tag">missing</span>'}</td></tr>`;
  }
  async function showBrief() {
    steps();
    $('brief-out').innerHTML = '<div class="status-line loading">Loading the brief…</div>';
    try {
      const { brief: b } = await api(`/api/studio/briefs/${encodeURIComponent(S.brief.businessKey)}?revision=${S.brief.revision}`);
      const loc = b.locations?.items?.[0]?.address?.formatted;
      const hours = b.hours?.listing?.value ?? b.hours?.website?.value;
      const rating = b.reviews?.value ? `${b.reviews.value.rating}★ from ${b.reviews.value.count} Google reviews` : null;
      const site = b.assets?.website ?? { usable: 0, total: 0 }, google = b.assets?.google ?? { count: 0 };
      $('brief-out').innerHTML = `
        <p class="hint">Brief r${esc(b.revision)} · researched ${esc(new Date(b.capturedAt).toLocaleString())} · identity ${esc(b.identity?.status)} · from ${esc(b.route)}</p>
        <div class="facts">
          <div><h4>Verified facts</h4><table>
            ${factRow('Name', shown(b.identity?.name), b.identity?.name?.status)}
            ${factRow('Category', shown(b.identity?.category), b.identity?.category?.status)}
            ${factRow('Address', loc, b.locations?.items?.length ? 'verified' : null)}
            ${factRow('Hours', Array.isArray(hours) ? hours.join('; ') : hours, (b.hours?.listing ?? b.hours?.website)?.status)}
            ${factRow('Phone', shown(b.contact?.phone), b.contact?.phone?.status)}
            ${factRow('Rating', rating, b.reviews?.status ?? (rating ? 'verified' : null))}
            ${factRow('Website', shown(b.identity?.website), b.identity?.website?.status)}
            ${factRow('Story', (() => { const v = shown(b.story); const t = v && typeof v === 'object' ? v.text : v; return t ? String(t).slice(0, 220) : null; })(), b.story?.status)}
          </table></div>
          <div><h4>Photos</h4><ul class="list"><li>Google listing: ${esc(google.count ?? 0)} photo(s), shown live from Google with each photographer credited (never stored)</li><li>Website: ${esc(site.usable ?? 0)} usable of ${esc(site.total ?? 0)}</li></ul>
            <h4 style="margin-top:12px">Missing information</h4>${(b.unknowns || []).length ? `<ul class="list">${b.unknowns.map((u) => `<li><b>${esc(u.field)}</b>: ${esc(u.why)}</li>`).join('')}</ul>` : '<p class="hint">Nothing missing.</p>'}
          </div>
        </div>`;
    } catch (err) { $('brief-out').innerHTML = `<div class="alert bad">The brief could not be loaded: ${esc(err.message)}</div>`; }
  }

  /* ───────────── 3. Generate and preview ───────────── */
  let stopDesign = false, current = null, width = 1440;
  const KIND_HINT = {
    splash: 'Plans the screens from the brief, writes and designs the page, then runs the spec\'s checks (first screen at 390 x 844, JavaScript off, reduced motion, links, facts, Google attribution). Usually about $0.20–0.50.',
    site: 'Writes a custom homepage and its inner pages, then checks every page at desktop and phone width. The AI generation cap is $2 per site.',
  };
  const kindLabel = () => (S.kind === 'splash' ? 'Generate splash page' : 'Generate new website');
  function setKind(k) {
    S.kind = k === 'site' ? 'site' : 'splash';
    document.querySelectorAll('input[name=kind]').forEach((r) => { r.checked = r.value === S.kind; });
    $('kind-hint').textContent = KIND_HINT[S.kind];
    if ($('generate-btn').textContent !== 'Resume watching') $('generate-btn').textContent = kindLabel();
    persist();
  }
  document.querySelectorAll('input[name=kind]').forEach((r) => r.addEventListener('change', () => setKind(r.value)));
  const isSplashJob = (id) => typeof id === 'string' && id.startsWith('sp_');
  $('generate-btn').addEventListener('click', () => (S.designJobId && $('generate-btn').textContent === 'Resume watching' ? (isSplashJob(S.designJobId) ? watchSplash(S.designJobId) : watchDesign(S.designJobId)) : startDesign(false)));
  $('again-btn').addEventListener('click', () => startDesign(true));
  async function startDesign(again) {
    if (!S.brief) return;
    if (S.kind === 'splash') return startSplash(again);
    $('generate-btn').disabled = true; $('again-btn').disabled = true; $('result').hidden = true; $('generate-error').hidden = true;
    say('generate-status', 'Starting generation…', 'loading');
    try {
      const job = await post('/api/studio/frontend-jobs', { businessKey: S.brief.businessKey, revision: S.brief.revision, instruction: $('instruction').value, ...(again ? { again: true } : {}) });
      if (job.reused) say('action-status', job.note || 'This business and direction is already being generated: showing that job.');
      S.designJobId = job.id; persist();
      await watchDesign(job.id);
    } catch (err) { say('generate-status', `Generation could not start: ${err.message}`, 'error'); }
    finally { $('generate-btn').disabled = false; $('again-btn').disabled = false; }
  }
  const STAGE = { queued: 'Queued', homepage: 'Writing the homepage', pages: 'Writing the inner pages', checks: 'Checking every page at desktop and phone width' };
  async function watchDesign(id) {
    stopDesign = false;
    $('generate-btn').disabled = true; $('generate-stop').hidden = false; $('generate-error').hidden = true; $('fail-idea').hidden = true;
    try {
      for (;;) {
        if (stopDesign) { say('generate-status', 'Stopped watching. Generation keeps running on the server; press "Resume watching" to follow it again.', 'cancelled'); $('generate-btn').textContent = 'Resume watching'; return; }
        const job = await api(`/api/studio/frontend-jobs/${encodeURIComponent(id)}`);
        const checking = job.status === 'needs-review' && job.stage === 'checks';
        const finished = (job.status === 'needs-review' && !checking) || job.status === 'failed';
        const elapsed = mins((finished ? Date.parse(job.updatedAt) : Date.now()) - Date.parse(job.createdAt));
        $('generate-meter').hidden = false;
        $('generate-meter').innerHTML = [['Status', checking ? 'Checking' : job.status], ['Stage', STAGE[checking ? 'checks' : job.stage] || job.stage || '—'], ['Time', elapsed], ['AI cost', `$${Number(job.costUsd || 0).toFixed(3)}`], ['Attempts', job.attempts ?? 0], ['Job', job.id]]
          .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
        if (job.status === 'failed') {
          say('generate-status', `Generation failed after ${elapsed}.`, 'error');
          // the design idea it was working to stays visible, apart from the error
          $('fail-idea').textContent = job.idea || ''; $('fail-idea').hidden = !job.idea;
          $('generate-error').hidden = false;
          $('generate-error').innerHTML = `<b>Why it failed</b><p>${esc(job.error || 'No reason was recorded.')}</p>${job.stage === 'pages' ? '<div class="acts"><button type="button" class="btn sm" id="resume-pages">Retry the inner pages (reuses the accepted homepage)</button></div>' : ''}`;
          $('resume-pages')?.addEventListener('click', async () => { try { await post(`/api/studio/frontend-jobs/${encodeURIComponent(id)}/resume`); await watchDesign(id); } catch (err) { say('generate-status', `Could not retry: ${err.message}`, 'error'); } });
          $('generate-btn').textContent = 'Generate new website';
          return;
        }
        if (finished) { say('generate-status', `Finished in ${elapsed}.`, 'ok'); $('generate-btn').textContent = 'Generate new website'; return renderResult(job); }
        say('generate-status', `${STAGE[checking ? 'checks' : job.stage] || 'Generating'}…`, 'loading');
        await wait(2500);
      }
    } catch (err) { say('generate-status', `Could not read the generation job: ${err.message}`, 'error'); $('generate-btn').textContent = 'Resume watching'; }
    finally { $('generate-btn').disabled = false; $('generate-stop').hidden = true; }
  }
  $('generate-stop').addEventListener('click', () => { stopDesign = true; });

  /* ── a splash page: one page, the spec's checks ── */
  async function startSplash(again) {
    $('generate-btn').disabled = true; $('again-btn').disabled = true; $('result').hidden = true; $('generate-error').hidden = true;
    say('generate-status', 'Starting the splash page…', 'loading');
    try {
      const direction = [$('instruction').value.trim(), again ? 'A fresh design, clearly different in composition and visual idea from the version already made.' : ''].filter(Boolean).join(' ');
      // a business with no Google listing is made from its website's research record
      const who = S.selected.placeId ? { placeId: S.selected.placeId } : { businessKey: S.brief.businessKey };
      const job = await post('/api/studio/splash', { ...who, instruction: direction });
      S.designJobId = job.id; persist();
      await watchSplash(job.id);
    } catch (err) { say('generate-status', `The splash page could not start: ${err.message}`, 'error'); }
    finally { $('generate-btn').disabled = false; $('again-btn').disabled = false; }
  }
  const SPLASH_STAGE = { queued: 'Queued for the worker', collecting: 'Collecting the business', generating: 'Designing the page', checking: 'Running the checks' };
  async function watchSplash(id) {
    stopDesign = false;
    $('generate-btn').disabled = true; $('generate-stop').hidden = false; $('generate-error').hidden = true; $('fail-idea').hidden = true;
    try {
      for (;;) {
        if (stopDesign) { say('generate-status', 'Stopped watching. The page keeps being made on the server; press "Resume watching" to follow it again.', 'cancelled'); $('generate-btn').textContent = 'Resume watching'; return; }
        const job = await api(`/api/studio/splash/${encodeURIComponent(id)}`);
        const finished = ['ready', 'failed', 'stopped'].includes(job.status);
        const elapsed = mins((finished ? Date.parse(job.updatedAt) : Date.now()) - Date.parse(job.createdAt));
        $('generate-meter').hidden = false;
        $('generate-meter').innerHTML = [['Status', job.status], ['Stage', job.stage || SPLASH_STAGE[job.status] || '—'], ['Trade', job.plan?.trade?.row || '—'], ['Time', elapsed], ['AI cost', `$${Number(job.costUsd || 0).toFixed(3)}`], ['Attempts', job.attempts ?? 0], ['Job', job.id]]
          .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
        if (job.status === 'failed' || job.status === 'stopped') {
          say('generate-status', job.status === 'stopped' ? 'Stopped for a person to check.' : `The page failed after ${elapsed}.`, 'error');
          $('fail-idea').textContent = job.idea || ''; $('fail-idea').hidden = !job.idea;
          $('generate-error').hidden = false;
          $('generate-error').innerHTML = `<b>${job.status === 'stopped' ? 'Why it stopped' : 'Why it failed'}</b><p>${esc(job.error || 'No reason was recorded.')}</p>`;
          $('generate-btn').textContent = kindLabel();
          return;
        }
        if (finished) { say('generate-status', `Finished in ${elapsed}.`, 'ok'); $('generate-btn').textContent = kindLabel(); return renderSplash(job); }
        say('generate-status', `${job.stage || SPLASH_STAGE[job.status] || 'Working'}…`, 'loading');
        await wait(2500);
      }
    } catch (err) { say('generate-status', `Could not read the splash job: ${err.message}`, 'error'); $('generate-btn').textContent = 'Resume watching'; }
    finally { $('generate-btn').disabled = false; $('generate-stop').hidden = true; }
  }
  function renderSplash(job) {
    current = job;
    $('result').hidden = false;
    $('result-title').textContent = 'Splash page preview'; $('result-tag').textContent = job.reused ? 'Updated facts, same design' : 'Splash page';
    $('idea').textContent = job.idea || '';
    const screens = (job.plan?.screen_plan?.screens || []).map((s) => s.label || s.screen).join(' → ');
    $('page-tabs').innerHTML = `<button type="button" role="tab" data-url="${esc(job.previewUrl)}" aria-selected="true">Splash page${screens ? ` · ${esc(screens)}` : ''}</button>`;
    showPage(job.previewUrl);
    renderSplashQa(job);
  }
  function renderSplashQa(job) {
    const qa = job.qa, badge = $('qa-badge'), blocking = job.blocking || [];
    if (!qa) { badge.className = 'tag warn'; badge.textContent = 'Checks did not run'; $('qa').innerHTML = '<p class="hint">The checks have not run for this page.</p>'; return; }
    badge.className = `tag ${blocking.length ? 'bad' : qa.needs_human.length ? 'warn' : 'ok'}`;
    badge.textContent = blocking.length ? `${blocking.length} blocking` : qa.needs_human.length ? `${qa.passed.length} passed · ${qa.needs_human.length} for staff` : `All ${qa.passed.length} checks passed`;
    const list = (title, items, cls = '') => items.length ? `<div class="qa-group"><h4>${esc(title)}</h4><ul class="list">${items.map((x) => `<li${cls && blocking.some((b) => b.includes(x)) ? ` class="${cls}"` : ''}>${esc(x)}</li>`).join('')}</ul></div>` : '';
    const questions = job.plan?.open_questions || [];
    $('qa').innerHTML = [
      blocking.length ? `<div class="alert bad"><b>Not sendable until fixed</b><ul class="list">${blocking.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>` : '',
      list('For staff', qa.needs_human, 'block'), list('Fixed by Roger', qa.fixed), list('Passed', qa.passed),
      questions.length ? `<div class="qa-group"><h4>Questions for the owner</h4><ul class="list">${questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>` : '',
      `<p class="hint"><a href="/api/studio/splash/${encodeURIComponent(job.id)}/output" target="_blank" rel="noopener">The spec's output JSON</a></p>`,
    ].join('');
  }

  function renderResult(job) {
    current = job;
    $('result').hidden = false;
    $('result-title').textContent = 'New website preview'; $('result-tag').textContent = 'New website preview';
    $('idea').textContent = job.idea || '';
    const pages = job.pages || [];
    $('page-tabs').innerHTML = pages.map((p, i) => `<button type="button" role="tab" data-url="${esc(p.url)}" aria-selected="${i === 0}">${esc(p.title)}</button>`).join('');
    showPage(pages[0]?.url);
    renderQa(job.review, job.delivery);
  }
  $('page-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[role=tab]');
    if (!b) return;
    $('page-tabs').querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === b)));
    showPage(b.dataset.url);
  });
  function showPage(url) { if (!url) return; $('frame').src = url; $('page-open').href = url; fit(); }
  function setWidth(w) { width = w; $('w-desktop').setAttribute('aria-pressed', String(w === 1440)); $('w-mobile').setAttribute('aria-pressed', String(w === 390)); fit(); }
  $('w-desktop').addEventListener('click', () => setWidth(1440));
  $('w-mobile').addEventListener('click', () => setWidth(390));
  /** the page at its real width: 1440 (scrolling inside the preview box when the screen is narrower) or 390 */
  function fit() {
    const vp = $('viewport'), f = $('frame');
    vp.classList.toggle('phone', width === 390);
    f.width = String(width); f.height = width === 390 ? '780' : '900';
  }
  window.addEventListener('resize', () => { if (!$('result').hidden) fit(); });

  function renderQa(review, delivery, opts = {}) {
    const badge = $('qa-badge');
    if (!review || !review.ran) { badge.className = 'tag warn'; badge.textContent = 'Checks did not run'; $('qa').innerHTML = `<p class="hint">${esc(review?.problems?.join('; ') || 'The rendered checks have not run for this version.')}</p>`; return; }
    badge.className = `tag ${review.pass ? 'ok' : 'bad'}`; badge.textContent = review.pass ? 'Checks passed' : 'Checks failed';
    const rows = (review.pages || []).map((p) => `<tr><td>${esc(p.page)}</td><td>${esc(p.width)}px</td><td><span class="tag ${p.pass ? 'ok' : 'bad'}">${p.pass ? 'pass' : 'fail'}</span></td><td>${esc(p.credits?.visible ?? 0)}/${esc(p.credits?.required ?? 0)}</td><td>${p.problems?.length ? `<ul class="list">${p.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '—'}</td></tr>`).join('');
    const staff = (delivery?.reasons || []).filter((r) => /^staff review:/.test(r)).map((r) => r.replace(/^staff review:\s*/, ''));
    $('qa').innerHTML = `${opts.label ? `<p class="hint">${esc(opts.label)}</p>` : ''}<div class="qa-scroll"><table class="qa-table"><thead><tr><th>Page</th><th>Width</th><th>Result</th><th>Photo credits shown</th><th>Problems</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${staff.length ? `<h4 style="margin:12px 0 0">Check before sending</h4><ul class="list">${staff.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
  }
  $('recheck-btn').addEventListener('click', async () => {
    if (!current) return;
    if (isSplashJob(current.id)) {
      $('recheck-btn').disabled = true;
      say('action-status', 'Running the checks again on the page as it is (no new generation)…', 'loading');
      try { await post(`/api/studio/splash/${encodeURIComponent(current.id)}/recheck`); say('action-status', 'Checks re-run requested.', 'ok'); await watchSplash(current.id); }
      catch (err) { say('action-status', `The checks could not run: ${err.message}`, 'error'); }
      finally { $('recheck-btn').disabled = false; }
      return;
    }
    $('recheck-btn').disabled = true;
    say('action-status', 'Running the checks again on every page (no new generation)…', 'loading');
    try { const r = await post(`/api/studio/frontend-jobs/${encodeURIComponent(current.id)}/review`); renderQa(r.review, r.delivery, { label: `Re-run at ${new Date().toLocaleTimeString()} (reported here; the version's saved record is unchanged).` }); say('action-status', 'Checks re-run.', 'ok'); }
    catch (err) { say('action-status', `The checks could not run: ${err.message}`, 'error'); }
    finally { $('recheck-btn').disabled = false; }
  });

  /* ── restore what staff had open ── */
  const saved = restore();
  if (saved?.selected) {
    S.selected = saved.selected; S.researchJobId = saved.researchJobId; S.brief = saved.brief; S.designJobId = saved.designJobId; S.kind = saved.kind === 'site' ? 'site' : 'splash';
    renderSelected(); initSources(); steps();
    if (S.brief) showBrief();
    else if (S.researchJobId) watchResearch(S.researchJobId);
    if (S.brief && S.designJobId) (isSplashJob(S.designJobId) ? watchSplash(S.designJobId) : watchDesign(S.designJobId));
  } else steps();
  setKind(S.kind);
})();
