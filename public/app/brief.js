// Business brief (design studio, phase 1): start a job, watch its stages, read the brief and the inventory.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LABEL = { identity: 'Identity', page_inventory: 'Page inventory', crawl: 'Crawl', documents: 'Linked PDFs', assets: 'Asset analysis', brand: 'Brand analysis', brief: 'Business brief', qa: 'QA' };
  let timer = null;
  let current = null;

  const route = () => document.querySelector('input[name=route]:checked').value;
  document.querySelectorAll('input[name=route]').forEach((r) => r.addEventListener('change', () => {
    $('inputLabel').textContent = route() === 'website' ? 'Website address' : 'Google Maps link, or the business name and address';
    $('input').placeholder = route() === 'website' ? 'https://example.com' : 'Veracruz All Natural, 111 E Cesar Chavez St, Austin TX';
  }));

  $('start').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('startErr').hidden = true;
    const v = $('input').value.trim();
    if (!v) return;
    const res = await fetch('/api/studio/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(route() === 'website' ? { website: v } : { google: v }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { $('startErr').textContent = body.error || `Could not start (${res.status})`; $('startErr').hidden = false; return; }
    watch(body.id);
  });
  $('resume').addEventListener('click', async () => { if (current) { await fetch(`/api/studio/jobs/${current}/resume`, { method: 'POST' }); watch(current); } });
  $('rebuild').addEventListener('click', async () => { if (!current) return; const r = await fetch(`/api/studio/jobs/${current}/rebuild`, { method: 'POST' }); const b = await r.json(); if (b.id) watch(b.id); });

  function watch(id) {
    current = id;
    history.replaceState(null, '', `?job=${id}`);
    $('jobCard').hidden = false;
    $('result').hidden = true;
    clearInterval(timer);
    const tick = async () => {
      const r = await fetch(`/api/studio/jobs/${id}`);
      if (!r.ok) { clearInterval(timer); return; }
      const job = await r.json();
      renderJob(job);
      if (job.status === 'done' || job.status === 'failed') {
        clearInterval(timer);
        if (job.status === 'done') loadBrief(job);
        loadRecent();
      }
    };
    tick();
    timer = setInterval(tick, 1200);
  }

  function renderJob(job) {
    $('jobId').textContent = job.id;
    $('jobStatus').textContent = job.status;
    $('jobStatus').className = `pill ${job.status}`;
    const inp = job.input.fromSnapshot ? `Rebuild from snapshot ${job.input.fromSnapshot}` : job.input.website ? `Website: ${job.input.website}` : `Google: ${job.input.google}`;
    $('jobInput').textContent = `${inp} · started ${new Date(job.createdAt).toLocaleTimeString()}${job.resumes ? ` · resumed ${job.resumes}×` : ''}`;
    $('stages').innerHTML = job.stages.map((s) => {
      const p = s.progress && s.progress.total ? Math.round((s.progress.done / s.progress.total) * 100) : null;
      return `<li class="st ${s.status}"><span class="ic" aria-hidden="true"></span><span><b>${esc(LABEL[s.name] || s.name)}</b><br><span class="meta">${esc(s.status)}${s.attempts > 1 ? ` · try ${s.attempts}` : ''}</span></span><span>
        ${s.status === 'running' && s.progress ? `<span class="meta">${s.progress.done} of ${s.progress.total}${s.progress.note ? ` · ${esc(s.progress.note)}` : ''}</span><div class="bar"><i style="width:${p}%"></i></div>` : ''}
        ${s.error ? `<div class="e">${esc(s.error)}</div>` : ''}
        ${s.notes && s.notes.length ? `<ul class="notes">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</span></li>`;
    }).join('');
    $('resume').hidden = !(job.status === 'failed' || (job.status === 'running' && Date.now() - Date.parse(job.updatedAt) > 120000));
    $('rebuild').hidden = !(job.status === 'done' && job.snapshotId);
  }

  // a fact's value in words: an address, a rating, a logo, a list of places, a story
  const show = (v) => {
    if (v === null || v === undefined) return '';
    if (typeof v !== 'object') return esc(v);
    if (Array.isArray(v)) return esc(v.join('; '));
    if (v.formatted) return esc(v.formatted);
    if (v.rating !== undefined) return `${esc(v.rating)}★ from ${Number(v.count).toLocaleString()} reviews <span class="muted">· ${esc(v.restrictions)}</span>`;
    if (v.url && v.colors) return `<a href="${esc(v.url)}" target="_blank" rel="noopener">logo</a> ${v.width ? `${v.width}×${v.height}` : ''} ${v.colors.map((c) => `<span title="${esc(c)}" style="display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid var(--line);background:${esc(c)};vertical-align:-2px"></span>`).join(' ')}`;
    if (v.places) return esc([v.region, ...v.places].filter(Boolean).join(', '));
    if (v.text) return `<b>${esc(v.heading)}</b><br>${esc(v.text.slice(0, 320))}${v.text.length > 320 ? '…' : ''}`;
    return esc(JSON.stringify(v));
  };
  const srcs = (list) => list.map((s) => (s.sourceType === 'google' ? 'Google' : esc(path(s.url)))).join(', ');
  // a disputed fact: no value, every candidate with its sources
  const fact = (f) => !f ? '' : f.value === null && f.candidates?.length ? `<span class="pill conflicting">${esc(f.status)}: none chosen</span> <span class="muted">${esc(f.note || '')}</span><ul class="plain">${f.candidates.map((c) => `<li>${show(c.value)} <span class="muted">(${srcs(c.sources)})</span></li>`).join('')}</ul>` : f.value === null ? `<span class="pill unknown">unknown</span> <span class="muted">${esc(f.note || '')}</span>` : `${show(f.value)} <span class="pill ${f.status}">${esc(f.status)}</span> <span class="muted">${f.sources.map((s) => (s.sourceType === 'google' ? 'Google' : esc(path(s.url)))).join(', ')}</span>`;
  const path = (u) => { try { const x = new URL(u); return x.pathname || '/'; } catch { return u; } };

  async function loadBrief(job) {
    const r = await fetch(`/api/studio/briefs/${encodeURIComponent(job.businessKey)}?revision=${job.revision}`);
    if (!r.ok) return;
    const { brief: b, inventory: inv } = await r.json();
    const qa = job.qa;
    const el = $('result');
    el.hidden = false;
    el.innerHTML = `
      <div class="grid2">
        <section class="card"><h2>${esc(b.identity.name.value || 'Unnamed business')}</h2><p class="sub">Revision ${b.revision} · ${esc(b.route)} route · identity <span class="pill ${b.identity.status === 'verified' ? 'verified' : 'needs_review'}">${esc(b.identity.status)}</span> · QA <span class="pill ${qa?.status}">${esc(qa?.status || '')}</span></p>
          <dl class="kv"><dt>Category</dt><dd>${fact(b.identity.category)}</dd><dt>Website</dt><dd>${fact(b.identity.website)}</dd><dt>Phone</dt><dd>${fact(b.contact.phone)}</dd><dt>Email</dt><dd>${fact(b.contact.email)}</dd><dt>Address</dt><dd>${fact(b.contact.address)}</dd><dt>Locations</dt><dd>${b.locations.items.length} (${esc(b.locations.status)}) · main: ${b.locations.primaryId ? esc(b.locations.items.find((l) => l.id === b.locations.primaryId)?.address.formatted || '') : 'none chosen'}</dd><dt>Service area</dt><dd>${fact(b.serviceArea)}</dd><dt>Emergency</dt><dd>${fact(b.availability.emergency)}</dd><dt>Hours (Google)</dt><dd>${fact(b.hours.listing)}</dd><dt>Reviews</dt><dd>${fact(b.reviews)}</dd><dt>Story</dt><dd>${fact(b.story)}</dd></dl>
          ${b.summary.text ? `<p style="margin-top:12px"><b>Summary</b> <span class="muted">(AI, from the evidence; it does not change the facts)</span><br>${esc(b.summary.text)}</p>` : `<p class="muted">Summary: ${esc(b.summary.reason || b.summary.status)}</p>`}
        </section>
        <section class="card"><h2>Owner questions</h2><p class="sub">${b.ownerQuestions.filter((q) => q.blocking).length} must be answered before publishing</p>
          ${b.ownerQuestions.map((q) => `<div class="q ${q.blocking ? 'blocking' : ''}">${q.blocking ? '<b>Blocking.</b> ' : ''}${esc(q.question)}<br><span class="muted">${esc(q.why)}</span></div>`).join('')}
        </section>
      </div>
      <section class="card"><h2>Conflicts</h2>${b.conflicts.length ? b.conflicts.map((c) => `<div class="conflict"><b>${esc(c.field)}</b>: ${esc(c.summary)}<ul class="plain">${c.values.map((v) => `<li>${esc(v.value)} <span class="muted">(${v.sources.map((s) => (s.sourceType === 'google' ? 'Google' : esc(path(s.url)))).join(', ')})</span></li>`).join('')}</ul><span class="muted">${esc(c.resolution)}</span></div>`).join('') : '<p class="muted">The sources agree.</p>'}</section>
      <section class="card"><h2>Calls to action</h2><p class="sub">Primary: ${b.callsToAction.primary ? `${esc(b.callsToAction.primary.label)} → ${esc(b.callsToAction.primary.href)}` : 'none'} · Secondary: ${b.callsToAction.secondary ? `${esc(b.callsToAction.secondary.label)} → ${esc(b.callsToAction.secondary.href)}` : 'none'} · Booking: ${esc(b.callsToAction.booking || 'none')}</p>
        ${b.callsToAction.held.map((h) => `<div class="conflict"><b>Held:</b> ${esc(h.label)} → ${esc(h.href)} <span class="muted">${esc(h.reason)}</span></div>`).join('')}</section>
      <section class="card"><h2>Services</h2><p class="sub">${b.services.status === 'known' ? `${b.services.items.length} shown by the business` : 'unknown'}${b.services.proposals.length ? `; ${b.services.proposals.length} held for the owner` : ''}</p>
        ${b.services.items.length ? `<div class="scroll"><table><tr><th>Service</th><th>Where the business shows it</th><th>Pictures</th></tr>${b.services.items.map((s) => `<tr><td>${esc(s.name)}${s.primary ? ' <span class="pill verified">main</span>' : ''}</td><td>${s.evidence.map((e) => `${esc(e.kind)} ${esc(path(e.url))}`).join('<br>')}</td><td>${s.assets.length}</td></tr>`).join('')}</table></div>` : ''}
        ${b.services.proposals.length ? `<p class="muted" style="margin-top:10px">Held for the owner: ${b.services.proposals.map((p) => esc(p.name)).join(', ')}</p>` : ''}
      </section>
      <section class="card"><h2>Menu and prices</h2><p class="sub">${b.offerings.items.length ? `${b.offerings.items.length} items from the business's PDFs (text layer only; OCR is evidence, never an item)` : 'none read'}</p>
        ${b.offerings.documents.map((d) => `<p class="muted">${esc(path(d.url))}: ${esc(d.kind)}, ${esc(d.method)}, ${d.items} items</p>`).join('')}
        ${b.offerings.items.length ? `<div class="scroll"><table><tr><th>Item</th><th>Section</th><th>Price</th><th>Where</th></tr>${b.offerings.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.section || '')}</td><td>${i.price ? `${esc(i.price.text)} <span class="pill ${i.price.status}">${esc(i.price.status)}</span>` : '-'}</td><td>${i.sources.map((s) => esc(s.locator || '')).join('<br>')}</td></tr>`).join('')}</table></div>` : ''}
      </section>
      <section class="card"><h2>Linked PDFs</h2><p class="sub">${inv.coverage.documents.found} found: ${inv.coverage.documents.read} read, ${inv.coverage.documents.failed} failed, ${inv.coverage.documents.skipped} not read</p>
        ${inv.documents.length ? `<div class="scroll"><table><tr><th>Document</th><th>Kind</th><th>Status</th><th>Pages (how)</th><th>Items</th><th>Detail</th></tr>${inv.documents.map((d) => `<tr><td>${esc(path(d.url))}</td><td>${esc(d.kind)}</td><td><span class="pill ${d.status}">${esc(d.status)}</span></td><td>${d.pages.map((p) => `${p.page}: ${esc(p.method)}${p.ocrConfidence !== undefined ? ` (OCR ${p.ocrConfidence}%)` : ''}`).join(', ')}</td><td>${d.items}</td><td>${esc(d.reason || '')}</td></tr>`).join('')}</table></div>` : ''}
      </section>
      <section class="card"><h2>Pages</h2><p class="sub">${inv.coverage.discovered} found: ${inv.coverage.read} read, ${inv.coverage.rendered} after running scripts, ${inv.coverage.skipped} skipped, ${inv.coverage.failed} failed${inv.coverage.partial ? ' · partial coverage' : ''}</p>
        <div class="scroll"><table><tr><th>Page</th><th>Status</th><th>Type</th><th>Found via</th><th>Tries</th><th>Detail</th></tr>${inv.pages.map((p) => `<tr><td>${esc(path(p.url))}</td><td><span class="pill ${p.status}">${esc(p.status)}</span></td><td>${esc(p.type)}</td><td>${esc(p.discoveredVia.join(', '))}</td><td>${p.attempts}</td><td>${esc(p.reason || [p.title, p.services.length && `${p.services.length} services`, p.forms.length && `${p.forms.length} forms`].filter(Boolean).join(' · '))}</td></tr>`).join('')}</table></div>
      </section>
      <div class="grid2">
        <section class="card"><h2>Brand</h2><p class="sub">${esc(b.brand.status)} · confidence ${esc(b.brand.confidence)}</p>
          ${b.brand.colors.map((c) => `<div style="display:flex;gap:10px;align-items:center;margin:6px 0"><span style="width:28px;height:28px;border-radius:6px;border:1px solid var(--line);background:${esc(c.hex)}"></span><span><b>${esc(c.role)}</b> ${esc(c.hex)} <span class="muted">(${esc(c.confidence)}) ${esc(c.evidence)}</span></span></div>`).join('') || '<p class="muted">No brand colours read.</p>'}
          ${b.brand.fonts.length ? `<p>Type: ${b.brand.fonts.map((f) => `${esc(f.family)} <span class="muted">(${esc(f.role)})</span>`).join(', ')}</p>` : ''}
          <p>Logo: ${fact(b.brand.logo)}</p></section>
        <section class="card"><h2>Pictures</h2><p class="sub">Website: ${inv.assetSummary.website.outcomes.usable} usable of ${inv.assetSummary.website.total}, all awaiting the owner's confirmation · Google: ${inv.assetSummary.google.total}, preview only</p>
          <p class="muted">Examined: ${inv.assetSummary.website.examined.downloaded} downloaded, ${inv.assetSummary.website.examined.downloadFailed} download failed, ${inv.assetSummary.website.examined.byFileName + inv.assetSummary.website.examined.byRole} judged without a download, ${inv.assetSummary.website.examined.overBudget} over the download budget.</p>
          <p class="muted">${esc(b.assets.google.restriction)}</p>
          <h2 style="margin-top:12px">QA</h2><ul class="plain">${(qa?.checks || []).map((c) => `<li><span class="pill ${c.level}">${esc(c.level)}</span> ${esc(c.message)}</li>`).join('')}</ul></section>
      </div>`;
  }

  async function loadRecent() {
    const r = await fetch('/api/studio/jobs');
    if (!r.ok) return;
    const { jobs } = await r.json();
    $('recent').innerHTML = jobs.length ? `<p class="muted" style="margin:12px 0 6px">Recent jobs</p>${jobs.slice(0, 8).map((j) => `<a href="?job=${esc(j.id)}" data-job="${esc(j.id)}">${esc(j.input.website || j.input.google || `rebuild ${j.input.fromSnapshot || ''}`)} <span class="pill ${esc(j.status)}">${esc(j.status)}</span></a>`).join('')}` : '';
    $('recent').querySelectorAll('a[data-job]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); watch(a.dataset.job); }));
  }

  const q = new URLSearchParams(location.search).get('job');
  if (q) watch(q);
  loadRecent();
})();
