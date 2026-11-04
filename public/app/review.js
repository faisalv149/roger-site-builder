// Owner review (design studio): settle disputed and unknown facts, choose a concept, approve photos, tie pictures to
// services, confirm claims and the menu. Saved as a review of one brief revision; publishing stays blocked.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let data = null, saved = null;
  const q = new URLSearchParams(location.search);

  async function loadBusinesses() {
    const r = await fetch('/api/studio/businesses');
    const { businesses = [] } = await r.json().catch(() => ({}));
    $('business').innerHTML = businesses.map((b) => `<option value="${esc(b.businessKey)}">${esc(b.name || b.businessKey)} · revision ${b.revision}</option>`).join('') || '<option value="">No briefs yet</option>';
    if (q.get('business')) $('business').value = q.get('business');
  }

  $('pick').addEventListener('submit', (e) => { e.preventDefault(); load($('business').value, null); });

  async function load(key, reviewId) {
    $('err').hidden = true;
    const r = await fetch(`/api/studio/review-data/${encodeURIComponent(key)}${reviewId ? `?reviewId=${encodeURIComponent(reviewId)}` : ''}`);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { $('err').textContent = body.error || `Could not load (${r.status})`; $('err').hidden = false; return; }
    data = body; saved = null;
    history.replaceState(null, '', `?business=${encodeURIComponent(key)}${reviewId ? `&review=${encodeURIComponent(reviewId)}` : ''}`);
    render(body.review);
    $('review').hidden = false; $('bar').hidden = false; $('make').disabled = !reviewId;
    $('status').textContent = reviewId ? `Loaded review ${reviewId}` : 'Not saved yet';
  }

  const yesNo = /^(are|can|is|do|does|may|should)\b/i;
  function render(rv) {
    const A = rv?.answers ?? {};
    const disputed = new Map(data.disputed.map((d) => [d.questionId, d]));
    $('facts').innerHTML = data.questions.map((qq) => {
      const d = disputed.get(qq.id);
      const cur = A[qq.id] ?? {};
      // a yes/no question is one whose last sentence asks it ("Roger read 34 items… Is this menu current…?")
      const asks = qq.question.trim().split(/(?<=[.?!])\s+/).pop() || qq.question;
      const opts = qq.options?.length ? qq.options : yesNo.test(asks) ? ['Yes', 'No'] : null;
      const body = opts
        ? opts.map((o, i) => { const c = d?.candidates.find((x) => x.value === o); return `<label class="opt"><input type="radio" name="q:${esc(qq.id)}" value="${esc(o)}" ${cur.choice === o ? 'checked' : ''}><span>${esc(o)}${c ? `<span class="srcs">${c.sources.map(esc).join(' · ')}</span>` : ''}</span></label>`; }).join('') + `<label class="opt"><input type="radio" name="q:${esc(qq.id)}" value="" ${cur.choice ? '' : 'checked'}><span class="muted">Not settled yet</span></label>`
        : `<label class="muted" for="t:${esc(qq.id)}">Your answer</label><textarea id="t:${esc(qq.id)}" name="t:${esc(qq.id)}">${esc(cur.text ?? '')}</textarea>`;
      return `<fieldset><legend>${esc(qq.question)} ${qq.blocking ? '<span class="pill block">needed to publish</span>' : ''}</legend><p class="why">${esc(qq.why)}</p>${body}</fieldset>`;
    }).join('') || '<p class="muted">Nothing to settle.</p>';

    const set = data.sets[0];
    const chosen = rv?.selectedConcept;
    $('concepts').innerHTML = set ? `<p class="muted">From set ${esc(set.id)} (${new Date(set.createdAt).toLocaleString()})</p><div class="concepts" role="radiogroup" aria-label="Concepts">${set.concepts.map((c) => `
      <label class="ccard"><span class="row"><input type="radio" name="concept" value="${esc(set.id)}:${c.id}" ${chosen && chosen.setId === set.id && chosen.conceptId === c.id ? 'checked' : ''}><b>${c.id.toUpperCase()} · ${esc(c.name)}</b>${c.passes ? '' : ' <span class="pill block">a check fails</span>'}</span>
        <span class="thumbs"><img src="${esc(c.desktopHero)}" alt="Concept ${c.id.toUpperCase()} on a desktop"><img src="${esc(c.mobileHero)}" alt="Concept ${c.id.toUpperCase()} on a phone"></span>
        <span class="muted" style="font-size:13px">${esc(c.thesis)}</span>${c.notes.length ? `<span class="srcs">${c.notes.map(esc).join(' · ')}</span>` : ''}
        <a href="${esc(c.html)}" target="_blank" rel="noopener">Open the preview</a></label>`).join('')}</div>`
      : '<p class="muted">No concepts yet for this revision. Save the review, then make concepts with it.</p>';

    const approved = new Set(rv?.approvedAssets ?? []);
    $('photos').innerHTML = data.photos.map((p) => `<div class="ph"><img src="${esc(p.src)}" alt="${esc(p.alt || 'A photo from the website')}" loading="lazy"><label><input type="checkbox" name="photo" value="${esc(p.id)}" ${approved.has(p.id) ? 'checked' : ''}> May be published</label></div>`).join('');
    $('logo').innerHTML = data.logo ? `<label class="opt" style="margin-top:12px"><input type="checkbox" name="logo" ${approved.has('logo') ? 'checked' : ''}><span>The logo on the website is the current logo <img src="${esc(data.logo.src)}" alt="The logo" style="height:32px;vertical-align:middle;margin-left:8px"></span></label>` : '';

    const tied = rv?.serviceImages ?? {};
    const photoById = new Map(data.photos.map((p) => [p.id, p]));
    const picker = (key, label, websiteId) => {
      const has = Object.prototype.hasOwnProperty.call(tied, key);
      const cur = has ? (tied[key] === null ? 'none' : tied[key]) : websiteId ? 'website' : 'none';
      const shown = cur === 'website' ? websiteId : cur === 'none' ? null : cur;
      const p = shown ? photoById.get(shown) : null;
      return `<div class="svc">${p ? `<img src="${esc(p.src)}" alt="" data-thumb="${esc(key)}">` : `<span class="none" data-thumb="${esc(key)}">No picture</span>`}<label><b>${esc(label)}</b><br><select name="pic:${esc(key)}" data-key="${esc(key)}">
        ${websiteId ? `<option value="website" ${cur === 'website' ? 'selected' : ''}>Its picture on your website</option>` : ''}<option value="none" ${cur === 'none' ? 'selected' : ''}>No picture</option>
        ${data.photos.map((x) => `<option value="${esc(x.id)}" ${cur === x.id ? 'selected' : ''}>${esc(x.alt ? x.alt.slice(0, 60) : x.id)}</option>`).join('')}</select>
        ${!websiteId ? '<span class="srcs">Your website shows no picture of its own for this.</span>' : ''}</label></div>`;
    };
    $('pics').innerHTML = [...data.services.map((s) => picker(s.id, s.name, s.websiteImageId)), ...data.sections.map((sec) => picker(`section:${sec}`, `Menu: ${sec}`, null))].join('') || '<p class="muted">No services or menu sections.</p>';
    $('pics').querySelectorAll('select').forEach((sel) => sel.addEventListener('change', () => {
      const key = sel.dataset.key, s = data.services.find((x) => x.id === key);
      const id = sel.value === 'website' ? s?.websiteImageId : sel.value === 'none' ? null : sel.value;
      const p = id ? photoById.get(id) : null;
      const old = $('pics').querySelector(`[data-thumb="${CSS.escape(key)}"]`);
      old.outerHTML = p ? `<img src="${esc(p.src)}" alt="" data-thumb="${esc(key)}">` : `<span class="none" data-thumb="${esc(key)}">No picture</span>`;
    }));

    const claims = new Set(rv?.approvedClaims ?? []);
    $('claims').innerHTML = data.claims.length ? `<fieldset><legend>Claims the site may repeat</legend>${data.claims.map((c) => `<label class="opt"><input type="checkbox" name="claim" value="${esc(c.text)}" ${claims.has(c.text) ? 'checked' : ''}><span>${esc(c.text)}</span></label>`).join('')}</fieldset>` : '<p class="muted">No claims to confirm.</p>';
    $('menu').innerHTML = data.offerings ? `<fieldset><legend>Menu (${data.offerings.items} items read from your PDFs)</legend><label class="opt"><input type="checkbox" name="menuCurrent" ${rv?.offerings?.current ? 'checked' : ''}><span>The menu is current</span></label><label class="opt"><input type="checkbox" name="pricesApproved" ${rv?.offerings?.pricesApproved ? 'checked' : ''}><span>The prices may be shown${data.offerings.pricesToCheck ? ` (including ${data.offerings.pricesToCheck} matched only by the poster's layout)` : ''}</span></label></fieldset>` : '';
  }

  $('allPhotos').addEventListener('click', () => document.querySelectorAll('input[name=photo]').forEach((i) => { i.checked = true; }));
  $('noPhotos').addEventListener('click', () => document.querySelectorAll('input[name=photo]').forEach((i) => { i.checked = false; }));

  $('review').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData($('review'));
    const answers = {};
    for (const qq of data.questions) {
      const choice = f.get(`q:${qq.id}`), text = f.get(`t:${qq.id}`);
      if (choice) answers[qq.id] = { choice: String(choice) };
      else if (text && String(text).trim()) answers[qq.id] = { text: String(text).trim() };
    }
    const serviceImages = {};
    $('pics').querySelectorAll('select').forEach((sel) => { if (sel.value === 'none') serviceImages[sel.dataset.key] = null; else if (sel.value !== 'website') serviceImages[sel.dataset.key] = sel.value; });
    const concept = f.get('concept');
    const body = {
      brief: { businessKey: data.brief.businessKey, revision: data.brief.revision, briefHash: data.brief.briefHash },
      reviewedBy: 'owner (Studio review)', answers,
      approvedAssets: [...f.getAll('photo').map(String), ...(f.get('logo') ? ['logo'] : [])],
      approvedClaims: f.getAll('claim').map(String),
      ...(data.offerings ? { offerings: { current: !!f.get('menuCurrent'), pricesApproved: !!f.get('pricesApproved') } } : {}),
      serviceImages,
      ...(concept ? { selectedConcept: { setId: String(concept).split(':')[0], conceptId: String(concept).split(':')[1] } } : {}),
    };
    $('save').disabled = true;
    const r = await fetch('/api/studio/reviews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = await r.json().catch(() => ({}));
    $('save').disabled = false;
    if (!r.ok) { $('status').textContent = out.error || `Could not save (${r.status})`; return; }
    saved = out.id;
    $('status').textContent = `Saved as review ${saved}`;
    $('make').disabled = false;
    history.replaceState(null, '', `?business=${encodeURIComponent(data.brief.businessKey)}&review=${encodeURIComponent(saved)}`);
    showGate();
  });

  async function showGate() {
    const set = data.sets[0];
    const el = $('result');
    el.hidden = false;
    if (!set) { el.innerHTML = '<h2>Publishing</h2><p class="sub">Blocked: there are no concepts for this revision yet.</p>'; return; }
    const r = await fetch(`/api/studio/concept-sets/${encodeURIComponent(set.id)}/gate?reviewId=${encodeURIComponent(saved)}`);
    const g = await r.json().catch(() => ({}));
    el.innerHTML = `<h2>Publishing stays blocked</h2><p class="sub">${g.blockers ? `${g.blockers.length} thing(s) still stand between set ${esc(set.id)} and a published site:` : esc(g.error || 'Could not check the gate')}</p>
      <ul class="gate">${(g.blockers || []).map((b) => `<li>${esc(b.what)}${b.questionId ? ` <span class="muted">(${esc(b.questionId)})</span>` : ''}</li>`).join('')}</ul>
      <p class="muted">New concepts made with this review use the facts you settled, the photos you approved and the pictures you tied to services.</p>
      <div id="share"></div>`;
    // the chosen concept can be shown to the client: a preview link, not a published website
    const chosen = new FormData($('review')).get('concept');
    if (!chosen) { $('share').innerHTML = '<p class="muted">Choose a concept above and save to make a preview link for the client.</p>'; return; }
    const [setId, conceptId] = String(chosen).split(':');
    $('share').innerHTML = `<h2 style="margin-top:18px">Client preview link</h2><p class="sub">A private link to concept ${esc(conceptId.toUpperCase())}'s homepage preview, for the client to open on any device. It is not a published website.</p><p class="row"><button type="button" class="btnx" id="mkShare">Create the client preview link</button></p><p id="shareOut"></p>`;
    $('mkShare').addEventListener('click', async () => {
      $('mkShare').disabled = true;
      const r = await fetch(`/api/studio/concept-sets/${encodeURIComponent(setId)}/share`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conceptId }) });
      const out = await r.json().catch(() => ({}));
      $('mkShare').disabled = false;
      $('shareOut').innerHTML = r.ok ? `<label for="shareUrl" class="muted">Homepage preview (not a published website)</label><input id="shareUrl" readonly value="${esc(out.url)}" style="width:100%;margin:6px 0"><a class="btnx ghost" href="${esc(out.url)}" target="_blank" rel="noopener">Open the preview</a>` : `<span class="err">${esc(out.error || `Could not create the link (${r.status})`)}</span>`;
    });
    // the chosen concept as the full site (home and inner pages, forms, SEO) through the builder; publishing stays gated
    $('share').insertAdjacentHTML('beforeend', `<h2 style="margin-top:22px">Full site from concept ${esc(conceptId.toUpperCase())}</h2><p class="sub">Builds the home page and the inner pages the content supports, in this concept's layout, type and colour. The owner refines it in their editor; "Try another design" switches between your three concepts.</p><p class="row"><button type="button" class="btnx" id="mkSite">Build the full site</button></p><div id="siteOut" aria-live="polite"></div>`);
    const showJob = (j) => {
      const stages = (j.stages || []).map((s) => `<li>${s.status === 'done' ? '✓' : s.status === 'failed' ? '✗' : '…'} ${esc(s.name)}${s.ms ? ` <span class="muted">${(s.ms / 1000).toFixed(1)} s</span>` : ''}${s.note ? ` <span class="muted">· ${esc(s.note)}</span>` : ''}</li>`).join('');
      const done = j.status === 'done' ? `<p><a class="btnx" href="${esc(j.siteUrl)}" target="_blank" rel="noopener">Open the site preview</a> <a class="btnx ghost" href="${esc(j.ownerUrl)}" target="_blank" rel="noopener">Owner editor (photos, crops, details)</a></p>${j.review && j.review.checks.length ? `<p class="sub">Still to settle before publishing:</p><ul class="gate">${j.review.checks.map((c) => `<li>${esc(c.message)}</li>`).join('')}</ul>` : ''}` : '';
      $('siteOut').innerHTML = `<p class="muted">${j.status === 'done' ? (j.switched ? 'Switched to this concept.' : 'Built.') : j.status === 'failed' ? `Failed: ${esc(j.error || '')}` : 'Working…'}</p><ul class="stages">${stages}</ul>${done}`;
    };
    $('mkSite').addEventListener('click', async () => {
      $('mkSite').disabled = true;
      const r = await fetch(`/api/studio/concept-sets/${encodeURIComponent(setId)}/site`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conceptId }) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) { $('mkSite').disabled = false; $('siteOut').innerHTML = `<span class="err">${esc(out.error || `Could not start (${r.status})`)}</span>`; return; }
      for (;;) {
        await new Promise((res) => setTimeout(res, 2000));
        const j = await fetch(out.url).then((x) => x.json()).catch(() => null);
        if (!j) continue;
        showJob(j);
        if (j.status === 'done' || j.status === 'failed') break;
      }
      $('mkSite').disabled = false;
    });
  }

  $('make').addEventListener('click', async () => {
    const id = saved || q.get('review');
    if (!id) return;
    $('make').disabled = true;
    const r = await fetch('/api/studio/concepts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessKey: data.brief.businessKey, revision: data.brief.revision, briefHash: data.brief.briefHash, reviewId: id }) });
    const out = await r.json().catch(() => ({}));
    $('make').disabled = false;
    if (r.ok) location.href = `/app/concepts.html?job=${encodeURIComponent(out.id)}`;
    else $('status').textContent = out.error || `Could not start (${r.status})`;
  });

  loadBusinesses().then(() => { if (q.get('business')) load(q.get('business'), q.get('review')); });
})();
