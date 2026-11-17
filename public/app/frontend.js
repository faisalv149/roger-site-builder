/* Research -> confirmed identity -> verified brief -> custom code. Polling never starts a paid task. */
(() => {
  const $ = (id) => document.getElementById(id);
  const activeKey = 'roger-custom-demo-active', historyKey = 'roger-custom-demo-history';
  let busy = false, choosing = null;
  async function request(url, options) {
    const response = await fetch('/api/studio/' + url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  const post = (url, body) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
  const clear = () => { try { localStorage.removeItem(activeKey); } catch {} };
  const active = (phase, id, name, instruction = '') => write(activeKey, { phase, id, name, instruction });
  const wait = () => new Promise((resolve) => setTimeout(resolve, 2000));
  function setStatus(text) { $('progress').hidden = false; $('status').textContent = text; }
  function failure(error) { setStatus(error.message || String(error)); busy = false; $('start').disabled = false; }
  function showHistory() {
    const jobs = read(historyKey, []);
    $('history').hidden = !jobs.length;
    $('history-list').replaceChildren(...jobs.map((job) => {
      const li = document.createElement('li'), a = document.createElement('a');
      a.href = job.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = job.name + ' · ' + job.id;
      li.append(a); return li;
    }));
  }
  function saveHistory(job, name) {
    const jobs = read(historyKey, []).filter((item) => item.id !== job.id);
    jobs.unshift({ id: job.id, name, url: job.previewUrl }); write(historyKey, jobs.slice(0, 12)); showHistory();
  }
  async function pollResearch(id, name, instruction) {
    for (let count = 0; count < 450; count++) {
      const job = await request('jobs/' + encodeURIComponent(id));
      const stage = (job.stages || []).find((s) => s.status === 'running')?.name;
      setStatus('Researching ' + name + ' · ' + (stage || job.status));
      $('metrics').textContent = (job.stages || []).filter((s) => s.status === 'done').length + ' research stages complete';
      if (job.status === 'failed') throw new Error('Business research failed: ' + (job.error || 'unknown reason'));
      if (job.status === 'done') {
        if (!job.businessKey || !job.revision) throw new Error('Research finished without a usable business brief.');
        return startDesign(job.businessKey, job.revision, name, instruction);
      }
      await wait();
    }
    throw new Error('Research is still running. Reload to check this same saved job.');
  }
  async function startDesign(businessKey, revision, name, instruction) {
    setStatus('Checking photos and preparing a business-specific design…');
    const job = await post('frontend-jobs', { businessKey, revision, instruction });
    // a repeated submission returns the job already under way (or just finished): no second paid generation
    if (job.reused) $('metrics').textContent = job.note || 'This business is already being designed; showing that job.';
    active('design', job.id, name, instruction); await pollDesign(job.id, name);
  }
  async function pollDesign(id, name) {
    for (let count = 0; count < 600; count++) {
      const job = await request('frontend-jobs/' + encodeURIComponent(id));
      const checking = job.status === 'needs-review' && job.stage === 'checks';
      setStatus(checking ? 'Checking every page at desktop and phone width…' : { queued: 'Queued for the worker', generating: job.stage === 'pages' ? 'Writing the inner pages…' : 'Writing custom HTML and CSS…', 'needs-review': 'Draft ready for review', failed: 'Design generation failed' }[job.status] || job.status);
      $('metrics').textContent = `Job ${id} · ${job.attempts} attempt(s) · $${Number(job.costUsd).toFixed(3)} recorded AI cost`;
      // the actual error, prominently, whenever the job failed (a failed job can also have an idea: it stays separate)
      $('idea').textContent = job.idea || '';
      $('error').hidden = job.status !== 'failed';
      $('error-text').textContent = job.status === 'failed' ? (job.error || 'The job failed without a recorded reason.') : '';
      $('resume').hidden = !(job.status === 'failed' && job.stage === 'pages');
      $('resume').onclick = async () => { $('resume').disabled = true; try { await post('frontend-jobs/' + encodeURIComponent(id) + '/resume', {}); $('error').hidden = true; busy = true; $('start').disabled = true; active('design', id, name); await pollDesign(id, name); } catch (e) { $('error-text').textContent = e.message; } finally { $('resume').disabled = false; } };
      $('notes').replaceChildren(...(job.notes || []).map((note) => { const li = document.createElement('li'); li.textContent = note; return li; }));
      if (job.status === 'needs-review' && !checking) {
        $('open').href = job.previewUrl; $('open').hidden = false;
        // every page of this version, each at its own link
        const list = document.getElementById('pages') || Object.assign(document.createElement('ul'), { id: 'pages' });
        list.replaceChildren(...(job.pages || []).map((p) => { const li = document.createElement('li'), a = document.createElement('a'); a.href = p.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `${p.title} page`; a.addEventListener('click', (e) => { e.preventDefault(); $('frame').src = p.url; }); li.append(a); return li; }));
        if (!list.isConnected) $('progress').append(list);
        $('frame').src = job.previewUrl; $('preview').hidden = false; saveHistory(job, name);
      }
      if ((job.status === 'needs-review' && !checking) || job.status === 'failed') { clear(); busy = false; $('start').disabled = false; return; }
      await wait();
    }
    throw new Error('Design is still running. Reload to check this saved job; do not start a duplicate.');
  }
  function chooseBusiness(result) {
    return new Promise((resolve, reject) => {
      choosing = { resolve, reject };
      $('choice').hidden = false; $('choice-reason').textContent = result.reason || 'Confirm this is the correct business before research starts.';
      const candidates = result.status === 'confirmed' ? [result.candidate] : result.candidates || [];
      $('candidates').replaceChildren(...candidates.map((c) => {
        const button = document.createElement('button'); button.type = 'button';
        button.textContent = [c.name, c.address].filter(Boolean).join(' · ');
        button.addEventListener('click', () => { $('choice').hidden = true; choosing = null; resolve(c); });
        return button;
      }));
      if (!candidates.length) { $('choice').hidden = true; choosing = null; reject(new Error(result.reason || 'No matching business found.')); }
    });
  }
  $('cancel-choice').addEventListener('click', () => { $('choice').hidden = true; choosing?.reject(new Error('Business selection cancelled.')); choosing = null; });
  $('generate').addEventListener('submit', async (event) => {
    event.preventDefault(); if (busy) return; busy = true; $('start').disabled = true;
    $('progress').hidden = false; $('preview').hidden = true; $('open').hidden = true; $('choice').hidden = true;
    $('idea').textContent = ''; $('notes').replaceChildren(); $('metrics').textContent = '';
    // an earlier job's failure (and its retry button) belongs to that job, not to this new one
    $('error').hidden = true; $('error-text').textContent = ''; $('resume').hidden = true; $('resume').onclick = null;
    const website = $('website').value.trim(), name = $('name').value.trim(), address = $('address').value.trim(), saved = $('source').value;
    const instruction = $('instruction').value;
    try {
      if (saved && !website && !name) {
        const [businessKey, revision] = JSON.parse(saved); await startDesign(businessKey, revision, $('source').selectedOptions[0].textContent, instruction); return;
      }
      let google;
      if (!website) {
        if (!name) throw new Error('Enter a website, or a business name and ZIP/address.');
        setStatus('Finding the right Google business…');
        const found = await post('resolve', { name, address });
        google = (await chooseBusiness(found)).placeId;
      }
      const label = name || website;
      setStatus('Starting business research…');
      const job = await post('jobs', website ? { website } : { google });
      active('research', job.id, label, instruction); await pollResearch(job.id, label, instruction);
    } catch (error) { failure(error); }
  });
  $('desktop').addEventListener('click', () => $('frame').setAttribute('width', '1440'));
  $('mobile').addEventListener('click', () => $('frame').setAttribute('width', '390'));
  showHistory();
  request('businesses').then(({ businesses }) => {
    $('source').append(...businesses.map((b) => {
      const o = document.createElement('option'); o.value = JSON.stringify([b.businessKey, b.revision]); o.textContent = `${b.name} · brief r${b.revision}`; return o;
    }));
  }).catch(() => undefined);
  const previous = read(activeKey, null);
  if (previous?.id && /^((fe|sj)_[a-z0-9]+)$/.test(previous.id)) {
    busy = true; $('start').disabled = true;
    const resume = previous.phase === 'design' ? pollDesign(previous.id, previous.name) : pollResearch(previous.id, previous.name, previous.instruction || '');
    resume.catch(failure);
  }
})();
