// Roger Studio · Leads: the quote and appointment requests visitors send from splash pages, newest first, and whether
// each reached the owner. Everything a visitor typed is shown as text (never as markup).
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    for (const k of kids) if (k !== undefined && k !== null && k !== false) n.append(k instanceof Node ? k : String(k));
    return n;
  };
  const when = (iso) => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };
  const LABELS = { name: 'Name', phone: 'Phone', need: 'Needs', time: 'Preferred time', zip: 'ZIP' };

  function card(l) {
    const f = l.fields || {};
    const dl = el('dl');
    for (const k of ['name', 'phone', 'need', 'time', 'zip']) {
      if (!f[k]) continue;
      dl.append(el('dt', {}, LABELS[k]), el('dd', {}, k === 'phone' ? el('a', { href: `tel:${String(f.phone).replace(/[^\d+]/g, '')}` }, f.phone) : f[k]));
    }
    const owner = l.owner
      ? el('span', { class: `pill ${l.owner.delivered ? 'ok' : 'warn'}` }, l.owner.delivered ? 'Sent to the owner' : `In the owner's conversation only${l.owner.note ? ` (${l.owner.note})` : ''}`)
      : el('span', { class: 'pill' }, 'No owner conversation');
    const body = el('div', {},
      el('h3', {}, el('a', { href: l.previewUrl, target: '_blank', rel: 'noopener' }, l.business), el('span', { class: 'when' }, when(l.at)), l.trade ? el('span', { class: 'pill' }, l.trade) : null),
      dl,
      el('p', { class: 'hint' }, owner, l.photoNote ? ` · ${l.photoNote}` : ''));
    const photo = l.photoUrl ? el('a', { class: 'photo', href: l.photoUrl, target: '_blank', rel: 'noopener' }, el('img', { src: l.photoUrl, alt: `Photo sent by ${f.name || 'the visitor'}`, loading: 'lazy' })) : el('span');
    return el('article', { class: 'card lead' }, body, photo);
  }

  async function load() {
    $('summary').textContent = 'Loading…';
    try {
      const res = await fetch('/api/studio/splash-leads', { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { leads } = await res.json();
      const list = $('leads');
      list.replaceChildren(...leads.map(card));
      if (!leads.length) list.append(el('p', { class: 'card empty' }, 'No requests yet. They appear here when a visitor sends the form on a splash page.'));
      const sent = leads.filter((l) => l.owner?.delivered).length;
      $('summary').textContent = `${leads.length} request${leads.length === 1 ? '' : 's'}${leads.length ? ` · ${sent} delivered to owners` : ''}`;
    } catch (e) { $('summary').textContent = `Could not load the leads: ${e.message}`; }
  }
  $('refresh').addEventListener('click', load);
  load();
})();
