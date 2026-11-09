// Homepage concepts (design studio, phase 2): start a concept set for a business, watch it, compare its ranked directions (staff only; clients see one preview at a time).
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LABEL = { resolve: 'Facts', photos: 'Photos', directions: 'Directions', compose: 'Compose', render: 'Render', validate: 'Validate' };
  let timer = null;

  async function loadBusinesses() {
    const r = await fetch('/api/studio/businesses');
    const { businesses = [] } = await r.json().catch(() => ({}));
    $('business').innerHTML = businesses.length ? businesses.map((b) => `<option value="${esc(b.businessKey)}">${esc(b.name || b.businessKey)} · revision ${b.revision}</option>`).join('') : '<option value="">No briefs yet: read a business first</option>';
  }

  $('start').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('err').hidden = true;
    const key = $('business').value;
    if (!key) return;
    $('go').disabled = true;
    const r = await fetch('/api/studio/concepts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessKey: key }) });
    const b = await r.json().catch(() => ({}));
    $('go').disabled = false;
    if (!r.ok) { $('err').textContent = b.error || `Could not start (${r.status})`; $('err').hidden = false; return; }
    watch(b.id);
  });

  function watch(id) {
    history.replaceState(null, '', `?job=${id}`);
    $('jobCard').hidden = false;
    $('result').hidden = true;
    clearInterval(timer);
    const tick = async () => {
      const r = await fetch(`/api/studio/concept-jobs/${id}`);
      if (!r.ok) { clearInterval(timer); return; }
      const job = await r.json();
      $('jobId').textContent = job.id;
      $('jobStatus').textContent = job.status;
      $('jobStatus').className = `pill ${job.status}`;
      $('stages').innerHTML = job.stages.map((s) => `<li class="st ${s.status}"><span class="ic" aria-hidden="true"></span><span><b>${esc(LABEL[s.name] || s.name)}</b><br><span class="muted">${esc(s.status)}</span></span><span>${s.error ? `<span class="e">${esc(s.error)}</span>` : ''}${s.notes.length ? `<ul class="notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</span></li>`).join('');
      if (job.status === 'done' || job.status === 'failed') { clearInterval(timer); if (job.status === 'done') showSet(job.setId); }
    };
    tick();
    timer = setInterval(tick, 1500);
  }

  async function showSet(setId) {
    const r = await fetch(`/api/studio/concept-sets/${setId}`);
    if (!r.ok) return;
    const s = await r.json();
    const base = `/studio-previews/${encodeURIComponent(s.id)}/`;
    const pill = (l) => `<span class="pill ${esc(l)}">${esc(l)}</span>`;
    const el = $('result');
    el.hidden = false;
    el.innerHTML = `
      <section class="card"><h2>Set <code>${esc(s.id)}</code></h2><p class="sub">${esc(s.brief.businessKey)} revision ${s.brief.revision} · review ${esc(s.reviewId)} · ${esc(s.model)} · AI spend $${s.cost.spentUsd.toFixed(4)} of the $${s.cost.capUsd} cap:${s.cost.calls.length} call(s), ${s.cost.calls.filter((c) => c.cacheHit).length} answered from the cache</p>
        <ul class="plain">${s.checks.map((c) => `<li>${pill(c.level)} <b>${esc(c.id)}</b>: ${esc(c.message)}</li>`).join('')}</ul>
        <p class="sub" style="margin-top:14px"><b>Publishing</b>: ${s.gate.publishable ? 'clear' : `${s.gate.blockers.length} blocker(s) before any concept can be published`}</p>
        ${s.gate.blockers.length ? `<ul class="plain">${s.gate.blockers.map((b) => `<li>${esc(b.what)}${b.questionId ? ` <span class="muted">(${esc(b.questionId)})</span>` : ''}</li>`).join('')}</ul>` : ''}
        <div class="scroll" style="margin-top:12px"><table><tr><th>Pair</th><th>Plan differences</th><th>First screen (desktop)</th><th>First screen (mobile)</th><th>Whole page</th><th></th></tr>
        ${s.distinctness.pairs.map((p) => `<tr><td>${p.a.toUpperCase()}–${p.b.toUpperCase()}</td><td>${esc(p.plan.join(', '))}</td><td>${p.heroDesktop}</td><td>${p.heroMobile}</td><td>${p.page}</td><td>${pill(p.pass ? 'pass' : 'fail')}</td></tr>`).join('')}</table></div>
        <p class="muted" style="font-size:13px">Similarity of the screenshots' structure (edges, not colours); a pair is distinct below ${s.distinctness.thresholds.heroDesktop} / ${s.distinctness.thresholds.heroMobile} / ${s.distinctness.thresholds.page}.</p>
        ${s.ranking ? `<h3 style="margin-top:18px">Directions considered (up to ${s.ranking.max})</h3><div class="scroll"><table><tr><th>Concept</th><th>Direction</th><th>Fit</th><th>Status</th><th>Why</th></tr>
        ${s.ranking.considered.map((d) => `<tr><td>${d.conceptId ? d.conceptId.toUpperCase() : '–'}</td><td>${esc(d.name)} <span class="muted">(${esc(d.directionId)})</span></td><td>${d.score}</td><td>${pill(d.status === 'kept' ? 'pass' : 'review')} ${esc(d.status)}</td><td>${esc(d.reasons.slice(0, 2).join('; '))}</td></tr>`).join('')}</table></div>` : ''}</section>
      <div class="concepts">${s.concepts.map((c) => `
        <article class="card concept"><h3>${c.id.toUpperCase()} · ${esc(c.name)}</h3><p class="thesis">${esc(c.thesis)}</p>
          <div class="chips">${Object.entries(c.axes).map(([k, v]) => `<span title="${esc(k)}">${esc(v)}</span>`).join('')}<span>${esc(c.tokens.fonts.heading.family)}</span><span>${c.planSource === 'ai' ? 'planned by Claude' : 'deterministic plan'}</span></div>
          <div class="shots"><a href="${base}${esc(c.preview.desktop)}" target="_blank" rel="noopener"><img src="${base}${esc(c.preview.desktopHero)}" alt="Concept ${c.id.toUpperCase()} on a desktop, first screen"></a><a href="${base}${esc(c.preview.mobile)}" target="_blank" rel="noopener"><img src="${base}${esc(c.preview.mobileHero)}" alt="Concept ${c.id.toUpperCase()} on a phone, first screen"></a></div>
          <p class="row"><a class="btnx" href="${base}${esc(c.preview.html)}" target="_blank" rel="noopener">Open the preview</a><a class="btnx ghost" href="${base}${esc(c.preview.desktop)}" target="_blank" rel="noopener">Full page</a></p>
          <p class="muted" style="font-size:13px;margin:10px 0 4px">${c.sections.map((x) => `${x.kind}: ${x.variant}`).join(' → ')}</p>
          <ul class="plain">${c.checks.map((k) => `<li>${pill(k.level)} ${esc(k.id)}: ${esc(k.message)}${k.details ? `<ul>${k.details.slice(0, 5).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>
          ${c.omitted.length ? `<p class="muted" style="font-size:13px;margin:10px 0 0">Left out until the owner answers: ${c.omitted.map((o) => esc(o.what)).join('; ')}</p>` : ''}
        </article>`).join('')}</div>`;
  }

  loadBusinesses();
  const q = new URLSearchParams(location.search);
  if (q.get('job')) watch(q.get('job'));
  else if (q.get('set')) showSet(q.get('set'));
})();
