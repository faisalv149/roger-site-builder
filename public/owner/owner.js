/* Roger owner editor: preview, customise, save, demo purchase and domain setup for one draft.
   The key comes from the link's #k= fragment (never sent to the server in a URL), is kept in sessionStorage for
   this tab only, and goes to /api/owner as a Bearer token. The preview is a same-origin srcdoc frame: no
   postMessage, and its lead forms are switched off while editing. */
(function () {
  'use strict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return [].slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  var store = {
    get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode: work stays in memory */ } },
    del: function (k) { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  var draftId = new URLSearchParams(location.search).get('d') || '';
  var key = null;
  var hm = location.hash.match(/(?:^#|&)k=([^&]+)/);
  if (hm) {
    key = decodeURIComponent(hm[1]);
    store.set('rk:' + draftId, key);
    history.replaceState(null, '', location.pathname + location.search); // the key leaves the address bar
  } else key = store.get('rk:' + draftId);

  var S = {
    info: null, plan: null, options: null, saved: null, work: null, undo: [], rendered: null, html: '', swatch: '#888',
    saveState: 'saved', orders: [], tab: 'colours', pendingSave: null, checkout: null,
  };

  // ── API ──
  function api(path, method, body) {
    return fetch('/api/owner/' + encodeURIComponent(draftId) + path, {
      method: method || 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + key }, body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) { var e = new Error(data.error || ('Request failed (' + r.status + ')')); e.status = r.status; e.data = data; throw e; }
        return data;
      });
    }, function () { var e = new Error('You seem to be offline. Your changes are kept on this device.'); e.status = 0; throw e; });
  }
  function fatal(msg) { $('#o-error-text').textContent = msg; $('#o-error').hidden = false; $('#o-loading').hidden = true; }

  // ── toasts ──
  function toast(text, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'o-toast' + (opts.bad ? ' bad' : '');
    el.textContent = text;
    if (opts.action) { var b = document.createElement('button'); b.type = 'button'; b.textContent = opts.action.label; b.onclick = function () { el.remove(); opts.action.run(); }; el.appendChild(b); }
    $('#o-toasts').appendChild(el);
    setTimeout(function () { el.remove(); }, opts.ms || (opts.action ? 9000 : 4200));
  }

  // ── working state ──
  var workKey = function () { return 'rw:' + draftId; };
  function savedWork() { return { appearance: S.saved.appearance, offerings: S.saved.offerings, planId: S.saved.planId, layout: {}, siteMode: null, seo: {} }; }
  function isDirty() { return !same(S.work, savedWork()); }
  function persistLocal() { store.set(workKey(), JSON.stringify({ revision: S.saved.revision, work: S.work })); }
  function setSaveState(st) {
    S.saveState = st;
    var label = { saved: 'Saved', dirty: 'Unsaved changes', saving: 'Saving…', failed: 'Not saved' }[st];
    var el = $('#o-status');
    el.textContent = label;
    el.className = 'o-status is-' + st;
    $('#o-save').classList.toggle('is-dirty', st === 'dirty' || st === 'failed');
    $('#o-save').setAttribute('aria-label', st === 'saving' ? 'Saving design' : 'Save design (' + label.toLowerCase() + ')');
    $('#o-undo').disabled = !S.undo.length;
    $('#o-reset').disabled = !isDirty();
  }
  function refreshDirty() { if (S.saveState !== 'saving') setSaveState(isDirty() ? 'dirty' : 'saved'); }

  /** One owner change. kind: 'tokens' (CSS variables only) or 'render' (layout, prices: re-rendered). */
  function change(mutate, kind) {
    S.undo.push(clone(S.work));
    if (S.undo.length > 60) S.undo.shift();
    mutate(S.work);
    persistLocal();
    refreshDirty();
    if (kind === 'tokens') scheduleTokens(); else scheduleRender();
    renderTab();
  }

  // ── live tokens ──
  var tokTimer = null, tokSeq = 0;
  function scheduleTokens() { clearTimeout(tokTimer); tokTimer = setTimeout(applyTokensNow, 90); }
  function applyTokensNow() {
    var seq = ++tokSeq;
    return api('/tokens', 'POST', { appearance: S.work.appearance, planId: S.work.planId }).then(function (r) {
      if (seq !== tokSeq) return;
      applyTokens(r);
    }).catch(function (e) { toast(e.message, { bad: true }); });
  }
  function frameDoc() { try { return $('#o-frame').contentDocument; } catch (e) { return null; } }
  function applyTokens(r) {
    var doc = frameDoc();
    if (doc && doc.head) {
      var st = doc.getElementById('rg-appearance');
      if (!st) { st = doc.createElement('style'); st.id = 'rg-appearance'; doc.head.appendChild(st); }
      st.textContent = r.css || '';
      var link = doc.getElementById('rg-font');
      if (r.fonts && r.fonts.url) {
        if (!link) { link = doc.createElement('link'); link.id = 'rg-font'; link.rel = 'stylesheet'; doc.head.appendChild(link); }
        if (link.getAttribute('href') !== r.fonts.url) link.setAttribute('href', r.fonts.url);
      } else if (link) link.remove();
      if (doc.body) doc.body.setAttribute('data-motion', r.motion || 'subtle');
    }
    S.swatch = r.swatch || S.plan.brand;
    $('#o-swatch').style.background = S.swatch;
    $('#o-swatch2').style.background = S.swatch;
    $('#o-note').textContent = (r.notes || []).join(' ');
  }

  // ── re-render (layout, prices, generated designs) ──
  var renTimer = null, renSeq = 0;
  function renderState() { var s = { appearance: S.work.appearance, offerings: S.work.offerings, planId: S.work.planId, layout: S.work.layout }; if (S.work.siteMode) s.siteMode = S.work.siteMode; if (S.work.seo && Object.keys(S.work.seo).length) s.seo = S.work.seo; return clone(s); }
  function scheduleRender() { clearTimeout(renTimer); renTimer = setTimeout(renderNow, 220); }
  function renderNow() {
    var want = renderState();
    if (S.rendered && same(want, S.rendered)) return scheduleTokens();
    var seq = ++renSeq;
    showLoading(true);
    return api('/render', 'POST', Object.assign({ page: S.page || '' }, want)).then(function (r) {
      if (seq !== renSeq) return;
      S.rendered = want;
      S.plan = r.plan; S.options = Object.assign({}, S.options, r.options);
      setFrame(r.html);
      renderTab();
    }).catch(function (e) {
      showLoading(false);
      if (e.status === 400 && S.undo.length) { S.work = S.undo.pop(); persistLocal(); refreshDirty(); renderTab(); }
      toast(e.message, { bad: true });
    });
  }
  function showLoading(on) { $('#o-loading').hidden = !on; }

  // the preview frame: the site as visitors see it, plus room for the dock and forms switched off
  function setFrame(html) {
    var f = $('#o-frame');
    var y = 0;
    try { y = f.contentWindow ? f.contentWindow.scrollY : 0; } catch (e) { /* first load */ }
    S.html = html;
    var ready = false, oldDoc = frameDoc();
    var init = function () {
      if (ready) return;
      var doc = frameDoc();
      if (!doc || doc === oldDoc || !doc.body || !doc.querySelector('h1')) return;
      ready = true;
      var st = doc.createElement('style');
      // room for the owner dock: the page ends above it and the site's Roger widget sits above it
      st.textContent = 'body{padding-bottom:150px}html{scroll-behavior:auto !important}.rw{bottom:calc(84px + env(safe-area-inset-bottom,0px)) !important}';
      doc.head.appendChild(st);
      doc.addEventListener('submit', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        toast('Preview only: forms are switched off while you edit. Visitors’ requests reach you once the site is live.');
      }, true);
      doc.addEventListener('click', function (ev) {
        var a = ev.target.closest && ev.target.closest('a[href]');
        if (!a) return;
        var href = a.getAttribute('href') || '';
        if (/^(tel|sms|mailto):/i.test(href)) return;
        ev.preventDefault();
        // the page has a <base> at the site's address: anchors scroll here, the site's other pages open in place
        if (href.charAt(0) === '#') { var target = doc.getElementById(href.slice(1)); if (target) target.scrollIntoView({ block: 'start' }); return; }
        // the owner's own preview address: the draft as edited, never a public link pinned to a saved version
        var root = location.origin + '/drafts/' + S.info.draft.slug + '/';
        if (a.href.indexOf(root) === 0) {
          var u = new URL(a.href);
          S.page = u.pathname.slice(('/drafts/' + S.info.draft.slug + '/').length);
          S.rendered = null; y = 0;
          renderNow();
          return;
        }
        window.open(a.href, '_blank', 'noopener');
      }, true);
      try { f.contentWindow.scrollTo(0, y); } catch (e) { /* ignore */ }
      showLoading(false);
    };
    // the page is usable once its HTML is parsed; images and fonts keep loading behind it
    var polls = 0;
    var poll = setInterval(function () { init(); if (ready || ++polls > 200) { clearInterval(poll); if (!ready) showLoading(false); } }, 50);
    f.onload = function () { init(); clearInterval(poll); showLoading(false); };
    f.srcdoc = html;
  }

  // ── dock ──
  function openPanel(open) {
    var p = $('#o-panel');
    p.hidden = !open;
    $('#o-customise').setAttribute('aria-expanded', String(open));
    if (open) { renderTabs(); renderTab(); var t = $('.o-tab[aria-selected=true]'); if (t) t.focus(); }
    else $('#o-customise').focus();
  }
  $('#o-customise').addEventListener('click', function () { openPanel($('#o-panel').hidden); });
  $('#o-close').addEventListener('click', function () { openPanel(false); });
  $('#o-panel').addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); openPanel(false); } });
  $('#o-min').addEventListener('click', function () { $('#o-panel').hidden = true; $('#o-customise').setAttribute('aria-expanded', 'false'); $('#o-dock').hidden = true; $('#o-restore').hidden = false; $('#o-restore').focus(); });
  $('#o-restore').addEventListener('click', function () { $('#o-restore').hidden = true; $('#o-dock').hidden = false; $('#o-customise').focus(); });
  $('#o-save').addEventListener('click', function () { save(); });
  $('#o-undo').addEventListener('click', function () {
    if (!S.undo.length) return;
    S.work = S.undo.pop(); S.offersVersion++; S.pend = {}; persistLocal(); refreshDirty(); scheduleTokens(); scheduleRender(); renderTab();
    toast('Undone');
  });
  $('#o-reset').addEventListener('click', function () {
    S.undo.push(clone(S.work)); S.work = clone(savedWork()); S.offersVersion++; S.pend = {}; persistLocal(); refreshDirty(); scheduleTokens(); scheduleRender(); renderTab();
    toast('Back to your saved design', { action: { label: 'Undo', run: function () { $('#o-undo').click(); } } });
  });
  window.addEventListener('beforeunload', function (e) { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  // ── save ──
  function save() {
    if (S.pendingSave) return S.pendingSave;
    if (!isDirty()) { setSaveState('saved'); return Promise.resolve(true); }
    setSaveState('saving');
    var body = Object.assign({ revision: S.saved.revision }, renderState());
    S.pendingSave = api('', 'PUT', body).then(function (r) {
      applyState(r);
      pollScores();
      S.work = clone(savedWork());
      S.rendered = renderState();
      store.del(workKey());
      setSaveState('saved');
      toast('Design saved. Your shared preview link now shows it.');
      return true;
    }).catch(function (e) {
      setSaveState('failed');
      if (e.status === 409) toast(e.message, { bad: true, action: { label: 'Reload latest', run: function () { store.del(workKey()); location.reload(); } } });
      else toast((e.status ? e.message : 'Couldn’t save: ' + e.message), { bad: true, action: { label: 'Try again', run: save } });
      return false;
    }).then(function (ok) { S.pendingSave = null; return ok; });
    return S.pendingSave;
  }

  function applyState(r) {
    S.info = Object.assign({}, S.info, r);
    S.plan = r.plan;
    S.options = r.options;
    S.saved = { appearance: r.appearance || {}, offerings: r.offerings || [], planId: r.plan.id, revision: r.draft.revision };
    if (r.orders) S.orders = r.orders;
    if (r.content !== undefined) S.content = r.content;
    updateBuyLabel();
  }
  function updateBuyLabel() {
    var o = S.orders[0];
    $('#o-buy-lbl').textContent = !o ? 'Buy this website' : o.onboarding.status === 'demo-complete' ? 'Your website' : 'Your order';
    $('#o-buy').hidden = !S.info.demo && !o;
  }

  // ── customiser tabs ──
  var TABS = [['business', 'Business'], ['photos', 'Photos'], ['colours', 'Colours'], ['fonts', 'Fonts'], ['layout', 'Layout'], ['details', 'Shape'], ['motion', 'Motion'], ['prices', 'Prices'], ['seo', 'Pages & search']];
  function renderTabs() {
    var tl = $('#o-tabs');
    tl.innerHTML = TABS.map(function (t) {
      var on = t[0] === S.tab;
      return '<button type="button" role="tab" class="o-tab" id="tab-' + t[0] + '" aria-controls="tp-' + t[0] + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">' + (t[0] === 'prices' ? esc(S.options.offeringsTitle.split(' ')[0] === 'Menu' ? 'Menu' : 'Prices') : t[1]) + '</button>';
    }).join('');
    $('#o-tabpanels').innerHTML = TABS.map(function (t) { return '<div class="o-tp" role="tabpanel" id="tp-' + t[0] + '" aria-labelledby="tab-' + t[0] + '" tabindex="0"' + (t[0] === S.tab ? '' : ' hidden') + '></div>'; }).join('');
    $$('.o-tab', tl).forEach(function (b, i) {
      b.addEventListener('click', function () { selectTab(TABS[i][0]); });
      b.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (e.key === 'Home') d = -i; if (e.key === 'End') d = TABS.length - 1 - i;
        if (!d) return;
        e.preventDefault();
        var n = (i + d + TABS.length) % TABS.length;
        selectTab(TABS[n][0]); $('#tab-' + TABS[n][0]).focus();
      });
    });
  }
  function selectTab(id) {
    S.tab = id;
    $$('.o-tab').forEach(function (b) { var on = b.id === 'tab-' + id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    $$('.o-tp').forEach(function (p) { p.hidden = p.id !== 'tp-' + id; });
    renderTab();
  }

  var COLORS = { brand: 'Brand colour', 'brand-deep': 'Deep brand', ink: 'Ink', forest: 'Forest', ocean: 'Ocean', plum: 'Plum', terracotta: 'Terracotta', gold: 'Gold' };
  var COLOR_HEX = { ink: '#101828', forest: '#166534', ocean: '#0369A1', plum: '#7E22CE', terracotta: '#C2410C', gold: '#B45309' };
  var GRADS = { 'brand-fade': 'Brand fade', sunset: 'Sunset', ocean: 'Ocean', forest: 'Forest', plum: 'Plum', slate: 'Slate' };
  var GRAD_HEX = { sunset: ['#EA580C', '#BE185D'], ocean: ['#0284C7', '#4338CA'], forest: ['#15803D', '#0F766E'], plum: ['#7C3AED', '#BE185D'], slate: ['#334155', '#0F172A'] };
  var DIRS = { 'clean-professional': 'Clean professional', 'local-trusted': 'Warm local', 'bold-direct': 'Bold practical', 'modern-premium': 'Editorial showcase' };
  var HEROES = { split: 'Text and photo', 'photo-led': 'Large photo', 'type-led': 'Typography', carousel: 'Photo carousel' };
  var GALS = { grid: 'Grid', masonry: 'Masonry', strip: 'Scrolling strip', large: 'Large feature' };
  var OFFS = { cards: 'Cards', 'price-list': 'Price list', plans: 'Plans', 'dense-list': 'Compact list', checklist: 'Checklist', index: 'Numbered index' };

  function opt(attrs, label, pressed, extra) {
    return '<button type="button" class="o-opt ' + (extra || '') + '" aria-pressed="' + !!pressed + '" ' + attrs + '>' + label + '</button>';
  }
  function group(title, body, help) { return '<fieldset class="o-group"><legend>' + esc(title) + '</legend>' + (help ? '<p class="o-help">' + esc(help) + '</p>' : '') + '<div class="o-opts">' + body + '</div></fieldset>'; }

  function renderTab() {
    if (!S.options || $('#o-panel').hidden) return;
    var host = $('#tp-' + S.tab);
    if (!host) return;
    if (S.tab === 'prices' && host.dataset.built === String(S.work.offerings.length) + ':' + S.offersVersion) return; // keep the cursor while typing
    var ae = document.activeElement && host.contains(document.activeElement) ? document.activeElement : null;
    var focusId = ae ? ae.getAttribute('data-fid') : null;
    var focusField = ae && ae.getAttribute('data-f') ? '[data-i="' + ae.getAttribute('data-i') + '"][data-f="' + ae.getAttribute('data-f') + '"]' : null;
    var a = S.work.appearance, c = a.color || {};
    var html = '';
    if (S.tab === 'colours') {
      var mode = c.mode || 'solid';
      html += group('Fill', opt('data-fid="m-solid" data-act="mode" data-v="solid"', 'Solid', mode === 'solid') + opt('data-fid="m-grad" data-act="mode" data-v="gradient"', 'Gradient', mode === 'gradient'), 'Buttons and colour bands use this. Text stays readable: colours are deepened if needed.');
      if (mode === 'solid') {
        html += group('Colour', Object.keys(COLORS).map(function (k) {
          var hex = k === 'brand' ? S.plan.brand : k === 'brand-deep' ? S.plan.brand : COLOR_HEX[k];
          var style = 'background:' + hex + (k === 'brand-deep' ? ';filter:brightness(.62)' : '');
          return opt('data-fid="c-' + k + '" data-act="preset" data-v="' + k + '" aria-label="' + COLORS[k] + '" title="' + COLORS[k] + '"', '<span class="o-dot" style="' + style + '"></span>', !c.accent && (c.preset || 'brand') === k, 'o-col');
        }).join('') + '<label class="o-opt" title="Your own colour"><span>Custom</span><input type="color" class="o-colorin" data-fid="c-custom" data-act="accent" value="' + esc(c.accent || S.plan.brand) + '" aria-label="Choose your own colour"></label>');
      } else {
        var g = c.gradient || {};
        html += group('Gradient', Object.keys(GRADS).map(function (k) {
          var pair = k === 'brand-fade' ? [S.plan.brand, '#1f2937'] : GRAD_HEX[k];
          return opt('data-fid="g-' + k + '" data-act="gpreset" data-v="' + k + '" aria-label="' + GRADS[k] + '" title="' + GRADS[k] + '"', '<span class="o-dot" style="background:linear-gradient(135deg,' + pair[0] + ',' + pair[1] + ')"></span>', (g.preset || (!g.from ? 'brand-fade' : '')) === k, 'o-col');
        }).join(''));
        html += group('Your own gradient', '<label class="o-opt">From <input type="color" class="o-colorin" data-fid="g-from" data-act="gfrom" value="' + esc(g.from || S.plan.brand) + '"></label><label class="o-opt">To <input type="color" class="o-colorin" data-fid="g-to" data-act="gto" value="' + esc(g.to || '#1f2937') + '"></label>');
        var ang = g.angle || 135;
        html += group('Direction', [[135, 'Diagonal'], [90, 'Left to right'], [180, 'Top to bottom']].map(function (x) { return opt('data-fid="ga-' + x[0] + '" data-act="gangle" data-v="' + x[0] + '"', x[1], ang === x[0]); }).join(''));
      }
    } else if (S.tab === 'fonts') {
      ensureFontSamples();
      html += group('Font pairing', opt('data-fid="f-def" data-act="font" data-v=""', '<span>Style default</span>', !a.font, 'o-wide') + S.options.fonts.map(function (f) {
        return opt('data-fid="f-' + f.id + '" data-act="font" data-v="' + f.id + '"', '<span class="o-font-sample" style="font-family:\'' + esc(f.heading) + '\',serif">Aa</span><span>' + esc(f.label) + '</span>', a.font === f.id, 'o-wide');
      }).join(''));
      html += group('Text size', ['compact', 'comfortable'].map(function (v) { return opt('data-fid="ts-' + v + '" data-act="textSize" data-v="' + v + '"', v === 'compact' ? 'Compact' : 'Comfortable', (a.textSize || 'comfortable') === v); }).join(''));
    } else if (S.tab === 'layout') {
      var p = S.plan, o = S.options, L = S.work.layout || {};
      var cur = function (k, fallback) { return L[k] != null ? L[k] : fallback; };
      var FAMS = { 'editorial-showcase': 'Editorial Showcase', 'warm-local': 'Warm Local', 'bold-practical': 'Bold Practical' };
      html += group('Design', Object.keys(FAMS).map(function (f) { return opt('data-fid="fa-' + f + '" data-act="layout" data-k="family" data-v="' + f + '"', FAMS[f], cur('family', p.family) === f); }).join(''), 'A complete page design: header, layout, sections and footer. Your colours, fonts, prices and details stay.');
      if (p.familyVersion < p.familyCurrent) html += '<div class="o-group"><p class="o-help">This site uses an earlier version of ' + esc(p.familyLabel) + '. Updating changes the layout; nothing changes until you choose to.</p><button type="button" class="o-secondary" data-fid="upg" data-act="upgrade">Update to the latest design</button></div>';
      html += group('Top of the page', ['split', 'photo-led', 'type-led', 'carousel'].map(function (h) {
        var ok = o.heroes.indexOf(h) >= 0;
        return opt('data-fid="h-' + h + '" data-act="layout" data-k="hero" data-v="' + h + '"' + (ok ? '' : ' disabled title="Needs more or larger photos"'), HEROES[h], cur('hero', p.hero) === h);
      }).join(''));
      html += group('Section order', opt('data-fid="ar-a" data-act="layout" data-k="arrangement" data-v="a"', 'Classic', cur('arrangement', p.arrangement) === 'a') + opt('data-fid="ar-b" data-act="layout" data-k="arrangement" data-v="b"', 'Alternate', cur('arrangement', p.arrangement) === 'b'));
      html += o.gallery.length ? group('Photos', o.gallery.map(function (g) { return opt('data-fid="ga-' + g + '" data-act="layout" data-k="gallery" data-v="' + g + '"', GALS[g], cur('gallery', p.gallery) === g); }).join('')) : '<p class="o-help">Not enough photos for a gallery yet.</p>';
      if (o.offerings.length) html += group(S.options.offeringsTitle, o.offerings.map(function (v) { return opt('data-fid="of-' + v + '" data-act="layout" data-k="offerings" data-v="' + v + '"', OFFS[v] || v, cur('offerings', p.offerings) === v); }).join(''));
      html += '<div class="o-group"><p class="o-glabel">Something different</p><p class="o-help">A new layout, type pairing and section order. Keeps your colours, fonts, prices, wording and the choices you made above.</p><button type="button" class="o-secondary" data-fid="gen" data-act="generate">Generate another design</button></div>';
    } else if (S.tab === 'details') {
      html += group('Buttons', [['rounded', 'Rounded'], ['pill', 'Pill'], ['square', 'Square']].map(function (x) { return opt('data-fid="b-' + x[0] + '" data-act="ap" data-k="buttons" data-v="' + x[0] + '"', x[1], a.buttons === x[0]); }).join(''));
      html += group('Corners', [['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Round']].map(function (x) { return opt('data-fid="co-' + x[0] + '" data-act="ap" data-k="corners" data-v="' + x[0] + '"', x[1], a.corners === x[0]); }).join(''));
      html += group('Spacing', [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']].map(function (x) { return opt('data-fid="sp-' + x[0] + '" data-act="ap" data-k="spacing" data-v="' + x[0] + '"', x[1], a.spacing === x[0]); }).join(''), 'Unselected options use the style’s own shapes and spacing.');
    } else if (S.tab === 'motion') {
      html += group('Motion', [['off', 'Off', 'No animation'], ['subtle', 'Subtle', 'Gentle hover and fade-in'], ['expressive', 'Expressive', 'Livelier hover and scroll effects']].map(function (x) {
        return opt('data-fid="mo-' + x[0] + '" data-act="ap" data-k="motion" data-v="' + x[0] + '"', '<span>' + x[1] + '</span><span style="font-weight:400;color:var(--o-muted)">' + x[2] + '</span>', (a.motion || 'subtle') === x[0], 'o-wide');
      }).join(''), 'Visitors who ask their device for reduced motion always get none.');
    } else if (S.tab === 'business') {
      if (host.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; // keep typing
      html = businessHtml();
    } else if (S.tab === 'photos') {
      html = photosHtml();
    } else if (S.tab === 'seo') {
      html = '<div id="o-seo-body"><p class="o-help">Loading pages…</p></div>';
      host.innerHTML = html; loadSeo(); return;
    } else if (S.tab === 'prices') {
      html = pricesHtml();
      host.dataset.built = String(S.work.offerings.length) + ':' + S.offersVersion;
    }
    host.innerHTML = html;
    if (S.tab === 'prices') bindPrices(host);
    var fe = focusId ? host.querySelector('[data-fid="' + focusId + '"]') : focusField ? host.querySelector(focusField) : null;
    if (fe) fe.focus();
    if (S.tab === 'prices') Object.keys(S.pend).forEach(function (i) { var e = $('#err-' + i); if (e) e.textContent = validPrice(S.pend[i].price) || ''; });
  }
  S.offersVersion = 0;

  // ── business details: confirm, correct or leave out what the site says ──
  var SRC = { google: 'From Google', website: 'From your website', claude: 'Read from your website', owner: 'From you', sample: 'Sample data' };
  var STATE = { unreviewed: 'To review', confirmed: 'Confirmed', corrected: 'Corrected', omitted: 'Left out' };
  var GOALS = { call: 'Call', quote: 'Request a quote', appointment: 'Request an appointment', order: 'Order enquiry', enquiry: 'Send an enquiry' };
  function factValue(f) {
    if (Array.isArray(f.value)) return f.value.join(f.key === 'hours' ? '\n' : ', ');
    if (typeof f.value === 'boolean') return f.value ? 'Yes' : 'No';
    if (f.key === 'primaryAction') return GOALS[f.value] || f.value;
    return String(f.value);
  }
  function businessHtml() {
    var c = S.content;
    if (!c) return '<p class="o-help">Business details become reviewable after the site is rebuilt.</p>';
    var blockers = c.readiness.filter(function (x) { return x.level === 'blocker'; }), warns = c.readiness.filter(function (x) { return x.level !== 'blocker'; });
    var h = '<div class="o-ready ' + (blockers.length ? 'is-todo' : 'is-ok') + '"><b>' + (blockers.length ? blockers.length + ' to review before publishing' : 'Ready to publish') + '</b>' +
      (blockers.length ? '<ul>' + blockers.slice(0, 6).map(function (x) { return '<li>' + esc(x.message) + '</li>'; }).join('') + '</ul>' : '') +
      (warns.length ? '<ul class="o-warn">' + warns.map(function (x) { return '<li>' + esc(x.message) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
    h += '<p class="o-help">Check what your site says. A confirmation applies to this exact wording; if it changes, you\u2019ll be asked again.</p>';
    h += c.facts.map(function (f) {
      var editable = f.key !== 'hours';
      var input = f.key === 'primaryAction'
        ? '<select data-fact-input="' + f.key + '">' + Object.keys(GOALS).map(function (g) { return '<option value="' + g + '"' + (g === f.value ? ' selected' : '') + '>' + GOALS[g] + '</option>'; }).join('') + '</select>'
        : typeof f.value === 'boolean' ? '<select data-fact-input="' + f.key + '"><option value="true"' + (f.value ? ' selected' : '') + '>Yes</option><option value="false"' + (!f.value ? ' selected' : '') + '>No</option></select>'
          : '<input data-fact-input="' + f.key + '" value="' + esc(Array.isArray(f.value) ? f.value.join(', ') : String(f.value)) + '" aria-label="' + esc(f.label) + '">';
      return '<div class="o-fact is-' + f.state + '" data-key="' + f.key + '"><div class="o-fact-top"><b>' + esc(f.label) + '</b><span class="o-chip o-st-' + f.state + '">' + (STATE[f.state] || f.state) + '</span></div>' +
        '<p class="o-fact-v">' + esc(factValue(f)).replace(/\n/g, '<br>') + '</p><p class="o-src">' + esc(SRC[f.source] || f.source) + (f.claim ? ' · a claim visitors will rely on' : '') + '</p>' +
        '<div class="o-fact-act">' + (f.state !== 'confirmed' && f.source !== 'sample' ? '<button type="button" class="o-mini" data-act="fact" data-a="confirm" data-key="' + f.key + '">Confirm</button>' : '') +
        (editable ? '<details class="o-fix"><summary class="o-mini">Correct</summary><label class="o-field">' + esc(f.label) + input + '</label><button type="button" class="o-mini" data-act="fact" data-a="correct" data-key="' + f.key + '">Save correction</button></details>' : '<span class="o-src">Change hours on your Google profile</span>') +
        (f.key !== 'name' ? (f.state === 'omitted' ? '<button type="button" class="o-mini" data-act="fact" data-a="restore" data-key="' + f.key + '">Show again</button>' : '<button type="button" class="o-mini" data-act="fact" data-a="omit" data-key="' + f.key + '">Leave out</button>') : '') + '</div></div>';
    }).join('');
    return h;
  }
  function reviewFactAction(b) {
    var key = b.getAttribute('data-key'), a = b.getAttribute('data-a'), body = { key: key, action: a };
    if (a === 'correct') {
      var inp = $('[data-fact-input="' + key + '"]', $('#tp-business'));
      var raw = inp.value.trim(), f = S.content.facts.find(function (x) { return x.key === key; });
      body.value = typeof f.value === 'boolean' ? raw === 'true' : typeof f.value === 'number' ? Number(raw) : Array.isArray(f.value) ? raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : raw;
    }
    b.disabled = true;
    api('/facts', 'POST', body).then(function (r) { S.content = r.content; S.rendered = null; renderTab(); scheduleRender(); toast(a === 'omit' ? 'Left out of the site' : a === 'restore' ? 'Shown again' : 'Saved'); })
      .catch(function (e) { b.disabled = false; toast(e.message, { bad: true }); });
  }

  // ── photos: upload, choose roles, order, alt text and focal point ──
  var ROLES = [['auto', 'Roger decides'], ['hero', 'Main photo'], ['gallery', 'Gallery'], ['team', 'Team'], ['omit', 'Leave out']];
  function photosHtml() {
    var c = S.content;
    if (!c) return '<p class="o-help">Photos become editable after the site is rebuilt.</p>';
    var h = '<div class="o-group"><p class="o-glabel">Add your photos</p><p class="o-help">JPEG, PNG or WebP up to 12 MB. Your own photos can appear on the published site; photos from Google stay in the preview.</p>' +
      '<div class="o-row"><label class="o-secondary o-upload">Upload photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload="photo" class="visually-hidden"></label><label class="o-secondary o-upload">Upload logo<input type="file" accept="image/png,image/webp,image/jpeg" data-upload="logo" class="visually-hidden"></label></div><p class="o-help" id="o-up-status" role="status" aria-live="polite"></p></div>';
    h += c.media.map(function (m, i) {
      var badge = m.source === 'owner' ? 'Yours · published' : m.source === 'google' ? 'Google · preview only' : m.source === 'sample' ? 'Sample · never published' : 'Website';
      var role = m.role || 'auto';
      var fx = m.focal ? Math.round(m.focal.x * 100) : 50, fy = m.focal ? Math.round(m.focal.y * 100) : 50;
      return '<div class="o-media" data-key="' + m.key + '"><div class="o-thumbbox"><img src="' + esc(m.url) + '" alt="" loading="lazy" data-focal-img="' + m.key + '"><span class="o-focal" style="left:' + fx + '%;top:' + fy + '%" aria-hidden="true"></span></div>' +
        '<div class="o-media-main"><span class="o-chip">' + badge + '</span>' + (m.attribution ? '<span class="o-src"> ' + esc(m.attribution.name) + '</span>' : '') +
        '<label class="o-field">Use as<select data-media-role="' + m.key + '">' + ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === role ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="o-field">Describe it (alt text)<input data-media-alt="' + m.key + '" value="' + esc(m.alt) + '" maxlength="160"></label>' +
        '<fieldset class="o-focus-set"><legend class="o-src">Keep in frame (tap the photo, or use the sliders)</legend><label class="o-field">Left–right<input type="range" min="0" max="100" value="' + fx + '" data-focal="' + m.key + '" data-axis="x"></label><label class="o-field">Top–bottom<input type="range" min="0" max="100" value="' + fy + '" data-focal="' + m.key + '" data-axis="y"></label></fieldset>' +
        '<div class="o-row"><button type="button" class="o-mini" data-act="media-move" data-k="' + m.key + '" data-v="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="Move earlier">↑</button><button type="button" class="o-mini" data-act="media-move" data-k="' + m.key + '" data-v="1"' + (i === c.media.length - 1 ? ' disabled' : '') + ' aria-label="Move later">↓</button></div></div></div>';
    }).join('');
    return h;
  }
  function mediaEdit(body) {
    return api('/media/edit', 'POST', body).then(function (r) { S.content = r.content; S.rendered = null; scheduleRender(); if (S.tab === 'photos') renderTab(); })
      .catch(function (e) { toast(e.message, { bad: true }); });
  }
  function mediaMove(key, dir) {
    var list = S.content.media.slice(), i = list.findIndex(function (m) { return m.key === key; }), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    var a = list[i]; list[i] = list[j]; list[j] = a;
    mediaEdit({ edits: list.map(function (m, n) { return { key: m.key, order: n }; }) });
  }
  function uploadFiles(files, kind) {
    var st = $('#o-up-status'), list = [].slice.call(files), done = 0;
    var next = function () {
      if (!list.length) { if (st) st.textContent = done ? done + ' uploaded.' : ''; return; }
      var f = list.shift(), fd = new FormData(); fd.append('file', f);
      if (st) st.textContent = 'Uploading ' + f.name + '…';
      fetch('/api/owner/' + encodeURIComponent(draftId) + '/media?kind=' + kind, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); })
        .then(function (j) { done++; S.content = j.content; S.rendered = null; scheduleRender(); renderTab(); next(); })
        .catch(function (e) { toast(f.name + ': ' + e.message, { bad: true }); next(); });
    };
    next();
  }

  // ── pages & search ──
  function loadSeo() {
    api('/seo', 'POST', renderState()).then(function (r) {
      var b = $('#o-seo-body'); if (!b) return;
      if (!r.supported) { b.innerHTML = '<p class="o-help">' + esc(r.reason) + '</p>'; return; }
      var mode = S.work.siteMode || r.mode;
      var h = group('Pages', opt('data-fid="sm-single" data-act="site-mode" data-v="single"', 'One page', mode === 'single') + opt('data-fid="sm-multi" data-act="site-mode" data-v="multi"', 'Several pages', mode === 'multi'), r.modeSource === 'auto' && !S.work.siteMode ? 'Roger chose this from how much there is to say. Extra pages only appear when they have something distinct to show.' : 'Your choice.');
      h += '<p class="o-help">Not shown in search until your site is published. ' + esc(r.note) + '</p>';
      h += r.pages.map(function (p) {
        var ov = (S.work.seo && S.work.seo[p.id]) || p.override || {};
        return '<div class="o-seo-page"><p class="o-glabel">' + esc(p.type === 'home' ? 'Home' : p.type === 'offering' ? 'Page: ' + p.title.split(' | ')[0] : p.type.charAt(0).toUpperCase() + p.type.slice(1)) + '</p>' +
          '<div class="o-serp" aria-label="Search result preview (approximate)"><span class="o-serp-url">' + esc(p.url) + '</span><span class="o-serp-t">' + esc(ov.title || p.title) + '</span><span class="o-serp-d">' + esc(ov.description || p.description) + '</span></div>' +
          '<label class="o-field">Title <span class="o-count">' + (ov.title || p.title).length + '/60</span><input data-seo="' + p.id + '" data-f="title" maxlength="70" value="' + esc(ov.title || '') + '" placeholder="' + esc(p.title) + '"></label>' +
          '<label class="o-field">Description <span class="o-count">' + (ov.description || p.description).length + '/160</span><textarea data-seo="' + p.id + '" data-f="description" maxlength="170" placeholder="' + esc(p.description) + '">' + esc(ov.description || '') + '</textarea></label>' +
          ((ov.title || ov.description) ? '<button type="button" class="o-mini" data-act="seo-reset" data-k="' + p.id + '">Use Roger\u2019s wording</button>' : '') + '</div>';
      }).join('');
      if (r.issues.length) h += '<div class="o-group"><p class="o-glabel">Worth fixing</p><ul class="o-issues">' + r.issues.map(function (x) { return '<li>' + esc(x.issue) + '</li>'; }).join('') + '</ul></div>';
      b.innerHTML = h;
    }).catch(function (e) { var b = $('#o-seo-body'); if (b) b.textContent = e.message; });
  }
  S.pend = {}; // price edits that aren't valid yet (e.g. a range without its top)

  var fontsLoaded = false;
  function ensureFontSamples() {
    if (fontsLoaded || !S.options) return;
    fontsLoaded = true;
    var fams = []; S.options.fonts.forEach(function (f) { if (fams.indexOf(f.heading) < 0) fams.push(f.heading); });
    var l = document.createElement('link'); l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?' + fams.map(function (f) { return 'family=' + f.replace(/ /g, '+') + ':wght@600'; }).join('&') + '&display=swap&text=Aa';
    document.head.appendChild(l);
  }

  // panel clicks: one handler for every option
  $('#o-tabpanels').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled || b.tagName === 'INPUT') return;
    var act = b.getAttribute('data-act'), v = b.getAttribute('data-v'), k = b.getAttribute('data-k');
    if (act === 'mode') change(function (w) { w.appearance.color = Object.assign({}, w.appearance.color, { mode: v }); }, 'tokens');
    else if (act === 'preset') change(function (w) { w.appearance.color = { mode: 'solid', preset: v }; }, 'tokens');
    else if (act === 'gpreset') change(function (w) { var g = (w.appearance.color || {}).gradient || {}; w.appearance.color = { mode: 'gradient', gradient: { preset: v, angle: g.angle || 135 } }; }, 'tokens');
    else if (act === 'gangle') change(function (w) { var c = w.appearance.color || {}; w.appearance.color = Object.assign({}, c, { mode: 'gradient', gradient: Object.assign({}, c.gradient, { angle: Number(v) }) }); }, 'tokens');
    else if (act === 'font') change(function (w) { if (v) w.appearance.font = v; else delete w.appearance.font; }, 'tokens');
    else if (act === 'textSize') change(function (w) { w.appearance.textSize = v; }, 'tokens');
    else if (act === 'ap') change(function (w) { if (w.appearance[k] === v && k !== 'motion') delete w.appearance[k]; else w.appearance[k] = v; }, 'tokens');
    else if (act === 'layout') change(function (w) { w.layout = Object.assign({}, w.layout); w.layout[k] = v; }, 'render');
    else if (act === 'generate') generate(b);
    else if (act === 'upgrade') change(function (w) { w.layout = Object.assign({}, w.layout, { upgradeFamily: true }); }, 'render');
    else if (act === 'fact') reviewFactAction(b);
    else if (act === 'media-role') mediaEdit({ key: k, role: v === 'auto' ? null : v });
    else if (act === 'media-move') mediaMove(k, Number(v));
    else if (act === 'site-mode') change(function (w) { w.siteMode = v; }, 'render');
    else if (act === 'seo-reset') change(function (w) { w.seo = Object.assign({}, w.seo); w.seo[k] = { title: '', description: '' }; }, 'render');
  });
  $('#o-tabpanels').addEventListener('change', function (e) {
    var i = e.target;
    if (i.matches('[data-media-role]')) mediaEdit({ key: i.getAttribute('data-media-role'), role: i.value === 'auto' ? null : i.value });
    else if (i.matches('[data-media-alt]')) mediaEdit({ key: i.getAttribute('data-media-alt'), alt: i.value });
    else if (i.matches('[data-focal]')) {
      var k = i.getAttribute('data-focal'), box = i.closest('.o-media');
      mediaEdit({ key: k, focal: { x: Number($('[data-axis=x]', box).value) / 100, y: Number($('[data-axis=y]', box).value) / 100 } });
    } else if (i.matches('[data-upload]')) { uploadFiles(i.files, i.getAttribute('data-upload')); i.value = ''; }
    else if (i.matches('[data-seo]')) {
      var pid = i.getAttribute('data-seo'), fld = i.getAttribute('data-f');
      change(function (w) { w.seo = Object.assign({}, w.seo); w.seo[pid] = Object.assign({}, w.seo[pid]); w.seo[pid][fld] = i.value.trim(); }, 'render');
    }
  });
  $('#o-tabpanels').addEventListener('click', function (e) {
    var img = e.target.closest('[data-focal-img]');
    if (!img) return;
    var r = img.getBoundingClientRect(), k = img.getAttribute('data-focal-img');
    mediaEdit({ key: k, focal: { x: Math.round(((e.clientX - r.left) / r.width) * 100) / 100, y: Math.round(((e.clientY - r.top) / r.height) * 100) / 100 } });
  });
  $('#o-tabpanels').addEventListener('input', function (e) {
    var i = e.target, act = i.getAttribute('data-act');
    if (!/^(accent|gfrom|gto)$/.test(act || '')) return;
    var v = i.value.toUpperCase();
    clearTimeout(i._t);
    i._t = setTimeout(function () {
      if (act === 'accent') change(function (w) { w.appearance.color = { mode: 'solid', accent: v }; }, 'tokens');
      else change(function (w) {
        var c = w.appearance.color || {}, g = Object.assign({}, c.gradient); delete g.preset;
        if (act === 'gfrom') { g.from = v; g.to = g.to || '#1F2937'; } else { g.to = v; g.from = g.from || S.plan.brand.toUpperCase(); }
        g.angle = g.angle || 135;
        w.appearance.color = { mode: 'gradient', gradient: g };
      }, 'tokens');
    }, 150);
  });

  function generate(btn) {
    btn.disabled = true; btn.textContent = 'Generating…';
    S.undo.push(clone(S.work));
    showLoading(true);
    api('/generate', 'POST', renderState()).then(function (r) {
      S.work.planId = r.planId; S.work.layout = {};
      S.plan = r.plan; S.options = Object.assign({}, S.options, r.options);
      // a site made from a concept set switches to the set's next concept, saved as chosen
      if (r.saved) { S.saved = Object.assign({}, S.saved, { planId: r.planId, revision: r.revision }); S.work = { planId: r.planId, layout: {} }; }
      S.rendered = renderState();
      persistLocal(); refreshDirty();
      setFrame(r.html);
      renderTab();
      toast(r.concept ? 'Design ' + r.concept.id.toUpperCase() + ', "' + r.concept.name + '": saved. Try another design to see the next of your three.' : 'New design: ' + r.plan.directionLabel + ', ' + (HEROES[r.plan.hero] || r.plan.hero).toLowerCase() + '. Save it to keep it.', r.concept ? {} : { action: { label: 'Undo', run: function () { $('#o-undo').click(); } } });
    }).catch(function (e) { S.undo.pop(); showLoading(false); toast(e.message, { bad: true }); renderTab(); });
  }

  // ── prices / offerings ──
  var KIND = { fixed: 'Fixed price', from: 'From', range: 'Range', unit: 'Per unit', quote: 'On request' };
  function money(n, cur) {
    var LOC = { USD: 'en-US', CAD: 'en-CA', GBP: 'en-GB', EUR: 'en-IE', AUD: 'en-AU', NZD: 'en-NZ', PKR: 'en-PK', INR: 'en-IN', AED: 'en-AE', ZAR: 'en-ZA', SGD: 'en-SG' };
    try { return new Intl.NumberFormat(LOC[cur] || 'en-US', { style: 'currency', currency: cur, minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n); } catch (e) { return cur + ' ' + n; }
  }
  function priceText(p) {
    if (p.kind === 'quote') return 'On request';
    if (p.kind === 'from') return 'From ' + money(p.amount, p.currency);
    if (p.kind === 'range') return money(p.amount, p.currency) + '–' + money(p.max, p.currency);
    if (p.kind === 'unit') return money(p.amount, p.currency) + ' / ' + p.unit;
    return money(p.amount, p.currency);
  }
  function pricesHtml() {
    var o = S.options;
    var src = { owner: 'Set by you', website: 'From your website', business: 'From your business details', sample: 'Sample price (demo business)', theme: 'Suggested service, no price' };
    return '<p class="o-help">Prices show exactly as you set them. Leave one "On request" to invite a quote instead.</p>' + S.work.offerings.map(function (x0, i) {
      var x = S.pend[i] || x0, p = x.price;
      var sel = function (name, list, v, labels) { return '<select data-i="' + i + '" data-f="' + name + '">' + list.map(function (k) { return '<option value="' + k + '"' + (k === v ? ' selected' : '') + '>' + esc(labels ? labels[k] : k) + '</option>'; }).join('') + '</select>'; };
      return '<details class="o-offer"' + (S.openOffer === i ? ' open' : '') + ' data-i="' + i + '"><summary><span>' + esc(x.name) + '</span><span class="o-pr" id="pr-' + i + '">' + esc(priceText(p)) + '</span></summary>' +
        '<label class="o-field">Name<input data-i="' + i + '" data-f="name" value="' + esc(x.name) + '" maxlength="60" required></label>' +
        '<label class="o-field">Description <textarea data-i="' + i + '" data-f="description" maxlength="160">' + esc(x.description || '') + '</textarea></label>' +
        '<div class="o-2"><label class="o-field">Price' + sel('kind', o.priceKinds, p.kind, KIND) + '</label><label class="o-field">Currency' + sel('currency', o.currencies, p.currency) + '</label></div>' +
        '<div class="o-2"' + (p.kind === 'quote' ? ' hidden' : '') + '><label class="o-field">' + (p.kind === 'range' ? 'From' : 'Amount') + '<input data-i="' + i + '" data-f="amount" type="number" inputmode="decimal" min="0" step="0.01" value="' + (p.amount == null ? '' : p.amount) + '"></label>' +
        (p.kind === 'range' ? '<label class="o-field">To<input data-i="' + i + '" data-f="max" type="number" inputmode="decimal" min="0" step="0.01" value="' + (p.max == null ? '' : p.max) + '"></label>' : '') +
        (p.kind === 'unit' ? '<label class="o-field">Per' + sel('unit', o.priceUnits, p.unit || 'hour') + '</label>' : '') + '</div>' +
        '<label class="o-field">Duration <input data-i="' + i + '" data-f="duration" value="' + esc(x.duration || '') + '" maxlength="24" placeholder="e.g. 45 min"></label>' +
        '<p class="o-err" id="err-' + i + '" role="alert"></p>' +
        '<div class="o-row" style="justify-content:space-between"><span class="o-src">' + esc(src[x.source] || '') + '</span><button type="button" class="o-ibtn" data-del="' + i + '" aria-label="Remove ' + esc(x.name) + '">Remove</button></div></details>';
    }).join('') + (S.work.offerings.length < 24 ? '<button type="button" class="o-secondary" id="o-add-offer" style="width:100%">Add ' + esc(o.noun) + '</button>' : '');
  }
  function validPrice(p) {
    if (p.kind === 'quote') return null;
    if (p.amount == null || !isFinite(p.amount)) return 'Enter an amount';
    if (p.amount < 0) return 'Amounts can’t be negative';
    if (p.amount > 10000000) return 'That amount is too large';
    if (p.kind === 'range' && !(p.max > p.amount)) return 'The top of the range must be higher than the bottom';
    if (p.kind === 'unit' && !p.unit) return 'Choose what the price is per';
    return null;
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'item'; }
  function bindPrices(host) {
    $$('details', host).forEach(function (d) { d.addEventListener('toggle', function () { if (d.open) S.openOffer = Number(d.dataset.i); }); });
    host.addEventListener('change', onPriceField);
    host.addEventListener('input', function (e) { if (e.target.matches('input[data-f=name],textarea,input[data-f=duration]')) { clearTimeout(e.target._t); e.target._t = setTimeout(function () { onPriceField(e); }, 500); } });
    $$('[data-del]', host).forEach(function (b) { b.addEventListener('click', function () {
      var i = Number(b.getAttribute('data-del'));
      S.offersVersion++;
      change(function (w) { w.offerings.splice(i, 1); }, 'render');
    }); });
    var add = $('#o-add-offer', host);
    if (add) add.addEventListener('click', function () {
      var base = 'New ' + S.options.noun, id = slug(base), n = 2;
      while (S.work.offerings.some(function (o) { return o.id === id; })) id = slug(base) + '-' + n++;
      S.openOffer = S.work.offerings.length; S.offersVersion++;
      change(function (w) { w.offerings.push({ id: id, name: base.charAt(0).toUpperCase() + base.slice(1), price: { kind: 'quote', currency: S.info.business.currency || 'USD' }, source: 'owner' }); }, 'render');
      setTimeout(function () { var i = $('#tp-prices details[open] input[data-f=name]'); if (i) { i.focus(); i.select(); } }, 0);
    });
  }
  function onPriceField(e) {
    var el = e.target, i = Number(el.getAttribute('data-i')), f = el.getAttribute('data-f');
    if (isNaN(i) || !f) return;
    var cur = clone(S.pend[i] || S.work.offerings[i]);
    if (f === 'name') { var nm = el.value.replace(/[<>]/g, '').trim(); if (nm.length < 2) { $('#err-' + i).textContent = 'Names need at least 2 characters'; el.setAttribute('aria-invalid', 'true'); return; } cur.name = nm; }
    else if (f === 'description') cur.description = el.value.replace(/[<>]/g, '').trim() || undefined;
    else if (f === 'duration') cur.duration = el.value.replace(/[<>]/g, '').trim() || undefined;
    else if (f === 'kind') { cur.price.kind = el.value; if (el.value === 'quote') { delete cur.price.amount; delete cur.price.max; delete cur.price.unit; } if (el.value !== 'range') delete cur.price.max; if (el.value === 'unit') cur.price.unit = cur.price.unit || 'hour'; else delete cur.price.unit; }
    else if (f === 'currency') cur.price.currency = el.value;
    else if (f === 'unit') cur.price.unit = el.value;
    else if (f === 'amount' || f === 'max') cur.price[f] = el.value === '' ? undefined : Number(el.value);
    var err = validPrice(cur.price);
    $('#err-' + i).textContent = err || '';
    $$('#tp-prices [data-i="' + i + '"][data-f=amount],#tp-prices [data-i="' + i + '"][data-f=max]').forEach(function (x) { x.setAttribute('aria-invalid', String(!!err && (x.getAttribute('data-f') === f || f === 'kind'))); });
    el.removeAttribute('aria-invalid');
    if (err) {
      S.pend[i] = cur;
      if (f === 'kind') { S.offersVersion++; renderTab(); }
      return;
    }
    delete S.pend[i];
    cur.source = 'owner';
    if (same(cur, S.work.offerings[i])) return;
    var structural = f === 'kind';
    if (structural) S.offersVersion++;
    change(function (w) { w.offerings[i] = cur; }, 'render');
    var pr = $('#pr-' + i); if (pr) pr.textContent = priceText(cur.price);
  }

  // ── demo checkout ──
  var dlg = $('#o-checkout');
  function openCheckout() {
    S.checkout = S.checkout || { step: 'review' };
    if (S.orders[0]) S.checkout = { step: 'order', order: S.orders[0] };
    drawCheckout();
    if (!dlg.open) dlg.showModal();
    var h = $('h2', dlg); if (h) { h.tabIndex = -1; h.focus(); }
  }
  function closeCheckout() { dlg.close(); }
  dlg.addEventListener('close', function () { if (S.checkout && S.checkout.step !== 'order') S.checkout = null; updateBuyLabel(); $('#o-buy').focus(); });
  $('#o-buy').addEventListener('click', openCheckout);

  function steps(cur) {
    var list = [['review', 'Review'], ['details', 'Your details'], ['confirm', 'Confirm']];
    var at = list.findIndex(function (x) { return x[0] === cur; });
    return '<ol class="o-steps" aria-label="Checkout steps">' + list.map(function (x, i) { return '<li' + (i === at ? ' aria-current="step"' : i < at ? ' class="done"' : '') + '>' + (i + 1) + '. ' + x[1] + '</li>'; }).join('') + '</ol>';
  }
  var banner = '<p class="o-demo-banner"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>Demo checkout — no payment will be taken</p>';
  function pkgCard() {
    var p = S.info.demo.package;
    var label = money(p.amount, p.currency) + (p.cadence === 'one-time' ? ' one-time' : ' / ' + p.cadence);
    return '<div class="o-card"><div class="o-price"><span>' + esc(p.name) + '</span><span>' + esc(label) + ' <span class="o-tag demo">Demo price</span></span></div><ul class="o-feat">' + p.features.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul><p class="o-help" style="color:#556">A sample package price for this demo, separate from your business’s own prices.</p></div>';
  }
  function drawCheckout() {
    var c = S.checkout, b = $('#o-co-body'), info = S.info, h = '';
    if (c.step === 'review') {
      if (isDirty() || S.saveState === 'saving' || S.saveState === 'failed') {
        h = '<h2 id="o-co-h">Save your design first</h2><p>Your latest changes aren’t saved yet. The purchase uses your saved design, so save it and then continue.</p>' +
          '<div class="o-actions"><button type="button" class="o-btn" data-co="cancel">Keep editing</button><button type="button" class="o-btn primary" data-co="save">Save and continue</button></div>';
      } else {
        h = '<h2 id="o-co-h">Buy this website</h2>' + steps('review') + banner +
          '<div class="o-card"><p style="margin:0 0 8px"><b>' + esc(info.business.name) + '</b><br><span class="o-help" style="color:#556">' + esc(info.business.categoryLabel) + (info.business.city ? ' · ' + esc(info.business.city) : '') + '</span></p>' +
          '<div class="o-thumb"><iframe title="Your saved design" sandbox="" srcdoc="' + esc(S.html.replace(/<script[\s\S]*?<\/script>/gi, '')) + '" tabindex="-1" aria-hidden="true"></iframe></div>' +
          '<p class="o-help" style="color:#556;margin-top:8px">Your saved design · version ' + info.draft.revision + ' · ' + esc(S.plan.directionLabel) + '</p>' +
          (info.scores && info.scores.new ? '<div class="o-co-scores">' + scoreRows(info.scores) + '</div>' : '') + '</div>' + pkgCard() +
          '<div class="o-actions"><button type="button" class="o-btn" data-co="cancel">Cancel</button><button type="button" class="o-btn primary" data-co="to-details">Continue</button></div>';
      }
    } else if (c.step === 'details') {
      var o = c.owner || {};
      h = '<h2 id="o-co-h">Your details</h2>' + steps('details') + banner +
        '<form class="o-form" id="o-co-form" novalidate>' +
        '<label>Your name<input type="text" name="name" autocomplete="name" required maxlength="80" value="' + esc(o.name || '') + '"></label>' +
        '<label>Email<input type="email" name="email" autocomplete="email" required maxlength="120" value="' + esc(o.email || '') + '"></label>' +
        '<label>Mobile phone <span style="font-weight:400;color:#667">(optional)</span><input type="tel" name="phone" autocomplete="tel" maxlength="30" value="' + esc(o.phone || '') + '"></label>' +
        '<fieldset style="border:0;padding:0;margin:4px 0 0"><legend style="font-weight:700;font-size:14px;margin-bottom:6px">Payment</legend>' +
        '<label class="o-pay"><input type="radio" name="pay" checked aria-describedby="o-pay-note"><span class="o-card-ic" aria-hidden="true"></span><span><b>Demo payment</b><br><span style="font-weight:400">Demo card ending 4242</span></span></label>' +
        '<p class="o-help" id="o-pay-note" style="color:#556">No card details are needed or collected. Nothing is charged.</p></fieldset>' +
        '<p class="o-ferr" id="o-co-err" role="alert"></p>' +
        '<div class="o-actions"><button type="button" class="o-btn" data-co="back-review">Back</button><button type="submit" class="o-btn primary">Continue</button></div></form>';
    } else if (c.step === 'confirm') {
      var p = info.demo.package;
      h = '<h2 id="o-co-h">Confirm</h2>' + steps('confirm') + banner +
        '<div class="o-card"><p style="margin:0"><b>' + esc(info.business.name) + '</b> · design version ' + info.draft.revision + '</p><p style="margin:6px 0 0">' + esc(p.name) + ': ' + esc(money(p.amount, p.currency)) + (p.cadence === 'one-time' ? ' one-time' : ' / ' + esc(p.cadence)) + ' <span class="o-tag demo">Demo price</span></p>' +
        '<p style="margin:6px 0 0">' + esc(c.owner.name) + ' · ' + esc(c.owner.email) + (c.owner.phone ? ' · ' + esc(c.owner.phone) : '') + '</p><p style="margin:6px 0 0">Demo payment · demo card ending 4242</p></div>' +
        '<label class="o-check o-form"><input type="checkbox" id="o-ack"><span>I understand this is a demo: no payment is taken, no domain is bought and nothing is published.</span></label>' +
        '<p class="o-ferr" id="o-co-err" role="alert"></p>' +
        '<div class="o-actions"><button type="button" class="o-btn" data-co="back-details">Back</button><button type="button" class="o-btn primary" data-co="complete" id="o-complete">Complete demo purchase</button></div>';
    } else if (c.step === 'order') {
      h = orderHtml(c.order);
    }
    b.innerHTML = h;
    bindCheckout();
  }

  function idemKey() {
    var k = 'idem:' + draftId + ':' + S.info.draft.revision, v = store.get(k);
    if (!v) { var a = new Uint8Array(16); crypto.getRandomValues(a); v = [].map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); store.set(k, v); }
    return v;
  }
  function bindCheckout() {
    var b = $('#o-co-body');
    $$('[data-co]', b).forEach(function (x) { x.addEventListener('click', function () { coAction(x.getAttribute('data-co'), x); }); });
    var form = $('#o-co-form', b);
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form), o = { name: String(fd.get('name') || '').trim(), email: String(fd.get('email') || '').trim(), phone: String(fd.get('phone') || '').trim() };
      var err = o.name.length < 2 ? ['name', 'Enter your name'] : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(o.email) ? ['email', 'Enter a valid email'] : o.phone && !/^[+\d][\d\s().-]{6,}$/.test(o.phone) ? ['phone', 'Enter a valid phone number, or leave it empty'] : null;
      $$('input', form).forEach(function (i) { i.removeAttribute('aria-invalid'); });
      if (err) { var i = form.elements[err[0]]; i.setAttribute('aria-invalid', 'true'); i.focus(); $('#o-co-err').textContent = err[1]; return; }
      S.checkout.owner = o; S.checkout.step = 'confirm'; drawCheckout(); $('h2', dlg).focus();
    });
    bindOnboarding(b);
  }
  function coAction(a, btn) {
    var c = S.checkout;
    if (a === 'cancel') return closeCheckout();
    if (a === 'save') { btn.disabled = true; btn.textContent = 'Saving…'; return save().then(function (ok) { if (ok) { c.step = 'review'; drawCheckout(); $('h2', dlg).focus(); } else { btn.disabled = false; btn.textContent = 'Save and continue'; } }); }
    if (a === 'to-details') { c.step = 'details'; drawCheckout(); $('h2', dlg).focus(); return; }
    if (a === 'back-review') { c.step = 'review'; drawCheckout(); $('h2', dlg).focus(); return; }
    if (a === 'back-details') { c.step = 'details'; drawCheckout(); $('h2', dlg).focus(); return; }
    if (a === 'complete') {
      if (!$('#o-ack').checked) { $('#o-co-err').textContent = 'Tick the box to confirm you understand this is a demo.'; $('#o-ack').focus(); return; }
      btn.disabled = true; btn.textContent = 'Completing…';
      var owner = { name: c.owner.name, email: c.owner.email }; if (c.owner.phone) owner.phone = c.owner.phone;
      (S.pendingSave || Promise.resolve(true)).then(function () {
        return api('/orders', 'POST', { idempotencyKey: idemKey(), revision: S.info.draft.revision, owner: owner, demoAcknowledged: true });
      }).then(function (r) {
        S.orders = [r.order].concat(S.orders.filter(function (o) { return o.id !== r.order.id; }));
        S.checkout = { step: 'order', order: r.order, fresh: true };
        updateBuyLabel(); drawCheckout(); $('h2', dlg).focus();
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = 'Complete demo purchase';
        if (e.status === 409) { c.step = 'review'; drawCheckout(); toast(e.message, { bad: true }); return; }
        $('#o-co-err').textContent = e.message + (e.status ? '' : ' Try again: you won’t be charged twice.');
      });
    }
  }

  // ── order + domain onboarding ──
  function orderHtml(o) {
    var ob = o.onboarding, fresh = S.checkout && S.checkout.fresh;
    var h = '<h2 id="o-co-h">' + (fresh ? 'Thank you' : 'Your website order') + '</h2>' +
      '<p class="o-success"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17 19 7"/></svg>Demo order created — no payment taken</p>' +
      '<div class="o-card"><p style="margin:0">Order reference <span class="o-ref">' + esc(o.reference) + '</span></p>' +
      (o.thumbnail ? '<div class="o-thumb" style="margin-top:10px"><img src="' + o.thumbnail + '" alt="The design you bought (version ' + o.snapshot.revision + ')"></div>' : '') +
      '<p style="margin:8px 0 0">Design version ' + o.snapshot.revision + ' · ' + esc(o.package.name) + ' ' + esc(o.package.label) + ' <span class="o-tag demo">Demo price</span></p>' +
      '<p style="margin:8px 0 0"><a href="' + esc(o.snapshot.siteUrl) + '" target="_blank" rel="noopener">View your website preview</a></p></div>';
    h += '<h3>Your domain</h3>';
    if (ob.status === 'demo-complete') {
      h += '<p class="o-success">Demo verification complete</p><p class="o-success">Demo launch complete</p>' +
        '<p class="o-info">This was a simulation for <b>' + esc(ob.domain.apex) + '</b>. Your real domain and DNS weren’t changed and nothing was published. When your website goes live for real, Roger checks the actual DNS records and the HTTPS certificate.</p>' + guideHtml(o, true);
    } else {
      h += '<div class="o-choices" role="group" aria-label="Domain setup">' +
        choice('connect', 'Connect a domain', 'I already own a domain, like yourbusiness.com', ob.choice) +
        choice('need', 'I need a domain', 'Ideas and how to get one', ob.choice) +
        choice('later', 'Do this later', 'Save my progress and go back to editing', ob.choice) + '</div>';
      if (ob.choice === 'connect') h += connectHtml(o);
      if (ob.choice === 'need') h += needHtml();
    }
    h += '<div class="o-actions"><button type="button" class="o-btn" data-co="cancel">Back to editing</button></div>';
    return h;
  }
  function choice(v, title, sub, cur) { return '<button type="button" class="o-choice" data-ob="choice" data-v="' + v + '" aria-pressed="' + (cur === v) + '"><b>' + title + '</b><span>' + sub + '</span></button>'; }
  function connectHtml(o) {
    var ob = o.onboarding, prov = S.info.providers;
    var h = '<form class="o-form" id="o-dom-form" novalidate style="margin-top:14px">' +
      '<label>Your domain<input type="text" name="domain" inputmode="url" autocomplete="off" spellcheck="false" placeholder="yourbusiness.com" value="' + esc(ob.domain ? ob.domain.input : '') + '" required></label>' +
      '<label>Where is your DNS managed?<select name="provider">' + prov.map(function (p) { return '<option value="' + p.id + '"' + (ob.provider && ob.provider.id === p.id ? ' selected' : '') + '>' + esc(p.label) + '</option>'; }).join('') + '</select></label>' +
      '<p class="o-help" style="color:#556;margin:-4px 0 0">Your DNS provider is where your domain’s records are edited. It’s often where you bought the domain (the registrar), but not always: for example, a domain bought at Namecheap may use Cloudflare for DNS.</p>' +
      '<label>Where you bought it <span style="font-weight:400;color:#667">(registrar, optional)</span><input type="text" name="registrar" maxlength="60" value="' + esc(ob.provider && ob.provider.registrar || '') + '"></label>' +
      '<p class="o-ferr" id="o-dom-err" role="alert"></p><button type="submit" class="o-btn primary">' + (ob.domain ? 'Update' : 'Show me the steps') + '</button></form>';
    if (ob.domain && o.guide) h += guideHtml(o, false);
    return h;
  }
  function guideHtml(o, done) {
    var g = o.guide, ob = o.onboarding;
    if (!g) return '';
    var rec = function (r) { return '<tr><td>' + esc(r.type) + '</td><td><code>' + esc(r.name) + '</code></td><td>' + (r.value.placeholder ? '<span class="o-ph-val">' + esc(r.value.text) + '</span><br><button type="button" class="o-copy" disabled aria-describedby="o-ph-why">Copy value</button>' : '<code>' + esc(r.value) + '</code>') + '</td></tr>'; };
    var h = '<h3>Steps for ' + esc(g.provider.label) + '</h3>' + (g.note ? '<p class="o-info">' + esc(g.note) + '</p>' : '') +
      '<ol class="o-stepchk">' + g.steps.map(function (s, i) { return '<li><label><input type="checkbox" data-ob="step" data-i="' + i + '"' + (ob.done.indexOf(i) >= 0 ? ' checked' : '') + (done ? ' disabled' : '') + '><span><b>' + (i + 1) + '. ' + esc(s.title) + '</b><p>' + esc(s.text) + '</p></span></label></li>'; }).join('') + '</ol>' +
      '<h3>Records to add for ' + esc(ob.domain.subdomain ? ob.domain.host : ob.domain.apex + ' and ' + ob.domain.host) + '</h3><table class="o-records"><thead><tr><th scope="col">Type</th><th scope="col">Name</th><th scope="col">Value</th></tr></thead><tbody>' + g.records.map(rec).join('') + '</tbody></table>' +
      '<p class="o-help" id="o-ph-why" style="color:#556">Striped values are placeholders: the real values appear here once your domain is added to your website project. Copying is switched off until then.</p>' +
      '<p class="o-help" style="color:#556"><b>Only if asked to verify ownership:</b></p><table class="o-records"><tbody>' + rec(g.verification) + '</tbody></table>' +
      '<p class="o-info">' + esc(g.keep) + ' ' + esc(g.nameservers) + '</p>';
    if (!done) h += '<div class="o-actions"><span class="o-help" style="color:#556;max-width:32ch">This demo can’t check real DNS. Simulate it to see the rest of the journey.</span><button type="button" class="o-btn primary" data-ob="simulate">Simulate DNS verification</button></div>';
    return h;
  }
  function needHtml() {
    return '<div class="o-card" style="margin-top:14px"><p style="margin-top:0">Buy a domain from any registrar (for example Namecheap, GoDaddy, Cloudflare or Squarespace Domains). Then come back and choose <b>Connect a domain</b>.</p>' +
      '<p style="margin:0"><b>Ideas</b> <span class="o-tag demo">Examples</span></p><ul class="o-ideas">' + S.info.ideas.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' +
      '<p class="o-help" style="color:#556">Availability not checked. Roger doesn’t reserve or buy domains in this demo.</p></div>';
  }
  function putOnboarding(body) {
    var o = S.checkout.order;
    return api('/orders/' + o.id + '/onboarding', 'PUT', body).then(function (r) {
      S.checkout.order = r.order; S.orders = [r.order].concat(S.orders.filter(function (x) { return x.id !== r.order.id; }));
      return r.order;
    });
  }
  function bindOnboarding(b) {
    $$('[data-ob=choice]', b).forEach(function (x) { x.addEventListener('click', function () {
      var v = x.getAttribute('data-v');
      putOnboarding({ choice: v }).then(function () {
        if (v === 'later') { closeCheckout(); toast('Saved. Finish your domain setup any time from “Your order”.'); return; }
        S.checkout.fresh = false; drawCheckout(); var f = $('[name=domain]', b) || $('.o-choice[aria-pressed=true]', b); if (f) f.focus();
      }).catch(function (e) { toast(e.message, { bad: true }); });
    }); });
    var form = $('#o-dom-form', b);
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(form), btn = $('button[type=submit]', form);
      btn.disabled = true;
      putOnboarding({ choice: 'connect', domain: String(fd.get('domain') || ''), provider: String(fd.get('provider') || 'other'), registrar: String(fd.get('registrar') || '') }).then(function () {
        drawCheckout(); var h = $('#o-co-body h3:nth-of-type(2)') || $('#o-co-body h3'); if (h) { h.tabIndex = -1; h.focus(); }
      }).catch(function (er) { btn.disabled = false; $('#o-dom-err').textContent = er.message; form.elements.domain.setAttribute('aria-invalid', 'true'); form.elements.domain.focus(); });
    });
    $$('[data-ob=step]', b).forEach(function (x) { x.addEventListener('change', function () {
      var done = $$('[data-ob=step]', b).filter(function (c) { return c.checked; }).map(function (c) { return Number(c.getAttribute('data-i')); });
      putOnboarding({ done: done }).catch(function (e) { toast(e.message, { bad: true }); });
    }); });
    var sim = $('[data-ob=simulate]', b);
    if (sim) sim.addEventListener('click', function () {
      sim.disabled = true; sim.textContent = 'Checking…';
      api('/orders/' + S.checkout.order.id + '/simulate-verification', 'POST', {}).then(function (r) {
        S.checkout.order = r.order; S.orders = [r.order].concat(S.orders.filter(function (x) { return x.id !== r.order.id; }));
        updateBuyLabel(); drawCheckout(); var s = $('#o-co-body .o-success:nth-of-type(2)') || $('h2', dlg); if (s) { s.tabIndex = -1; s.focus(); }
      }).catch(function (e) { sim.disabled = false; sim.textContent = 'Simulate DNS verification'; toast(e.message, { bad: true }); });
    });
  }

  // ── scores: current website vs. new site ──
  function scoreLine(sc) {
    if (!sc || !sc.new) return '';
    var n = sc.new, o = sc.old;
    return o ? 'Website check: your current site ' + o.score + '/100, your new site ' + n.score + '/100.' : 'Website check: your new site scores ' + n.score + '/100.';
  }
  function scoreRows(sc) {
    var n = sc.new || {}, o = sc.old;
    var row = function (label, a, b) {
      if (a == null && b == null) return '';
      var better = a != null && b != null && b > a;
      return '<tr><th scope="row">' + esc(label) + '</th>' + (o ? '<td>' + (a == null ? '—' : a) + '</td>' : '') + '<td><b>' + (b == null ? '—' : b) + '</b>' + (better ? ' <span class="o-up">+' + (b - a) + '</span>' : '') + '</td></tr>';
    };
    var dev = n.device === 'desktop' ? '' : ' (phones)';
    return '<table class="o-sc-t"><thead><tr><th></th>' + (o ? '<th scope="col">Current site</th>' : '') + '<th scope="col">New site</th></tr></thead><tbody>' +
      row('Website check', o && o.score, n.score) + row('Google speed' + dev, o && o.performance, n.performance) + row('Accessibility' + dev, o && o.accessibility, n.accessibility) +
      row('SEO' + dev, o && o.seo, n.seo) + (n.lcp ? '<tr><th scope="row">Main content appears</th>' + (o ? '<td>' + esc(o.lcp || '—') + '</td>' : '') + '<td><b>' + esc(n.lcp) + '</b></td></tr>' : '') + '</tbody></table>';
  }
  function renderScores() {
    var base = S.info && S.info.scores, ss = S.info && S.info.siteScores, el = $('#o-scores');
    // the new site's numbers come from the latest measurement of the current version when there is one
    var latest = ss && (ss.current || ss.previous);
    var sc = base ? clone(base) : latest ? { old: null, new: {} } : null;
    if (sc && latest) sc.new = { score: latest.score, performance: latest.scores && latest.scores.performance, accessibility: latest.scores && latest.scores.accessibility, seo: latest.scores && latest.scores.seo, lcp: latest.lcp, device: latest.device };
    if (!sc || !sc.new || sc.new.score == null || store.get('scores-closed:' + draftId)) { el.hidden = true; return; }
    var when = ss && ss.current ? 'Measured on design version ' + ss.current.revision + '.' : ss && ss.previous ? 'From design version ' + ss.previous.revision + (ss.pending ? '; your latest saved version is being measured.' : '; save to measure your changes.') : '';
    var env = latest ? (latest.env === 'google' ? ' Google PageSpeed Insights.' : ' Lab test (Lighthouse) on Roger’s server, not real-visitor data.') : '';
    el.innerHTML = '<div class="o-sc-head"><h2 id="o-scores-h">Your new site\u2019s score</h2><button type="button" class="o-ibtn" id="o-sc-x" aria-label="Hide scores"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
      scoreRows(sc) +
      '<p class="o-sc-note">' + (when ? esc(when) + esc(env) : sc.source === 'local' ? 'Measured on the design Roger built for you, with the same checks as your current site.' : 'Both measured with Google PageSpeed Insights.') + (sc.reportUrl ? ' <a href="' + esc(sc.reportUrl) + '" target="_blank" rel="noopener">Full comparison</a>' : '') + '</p>';
    el.hidden = false;
    $('#o-sc-x').addEventListener('click', function () { store.set('scores-closed:' + draftId, '1'); el.hidden = true; $('#o-customise').focus(); });
  }

  // a re-check runs in the background after a save: refresh the card when its result arrives
  var pollTimer = null;
  function pollScores() {
    clearTimeout(pollTimer);
    var tries = 0;
    var tick = function () {
      api('/scores').then(function (s) {
        S.info.siteScores = s; renderScores();
        if (s.pending && ++tries < 24) pollTimer = setTimeout(tick, 10000);
      }).catch(function () { /* scores are optional */ });
    };
    pollTimer = setTimeout(tick, 3000);
  }

  // ── start ──
  if (!draftId || !key) { fatal('This page needs the private link Roger sent you. Open that link, or text Roger for a new one.'); return; }
  api('').then(function (r) {
    applyState(r);
    S.work = clone(savedWork());
    var restored = false;
    try {
      var l = JSON.parse(store.get(workKey()) || 'null');
      if (l && l.revision === S.saved.revision && !same(l.work, S.work)) { S.work = l.work; restored = true; }
      else store.del(workKey());
    } catch (e) { /* ignore */ }
    $('#o-dock').hidden = false;
    renderScores();
    renderTabs();
    setSaveState(isDirty() ? 'dirty' : 'saved');
    var first = restored ? api('/render', 'POST', renderState()).then(function (x) { S.plan = x.plan; S.options = Object.assign({}, S.options, x.options); return x; }) : api('/preview');
    return first.then(function (x) {
      S.rendered = renderState();
      setFrame(x.html);
      return api('/tokens', 'POST', { appearance: S.work.appearance, planId: S.work.planId }).then(applyTokens);
    }).then(function () {
      if (restored) toast('Restored your unsaved changes from this device.', { action: { label: 'Discard', run: function () { $('#o-reset').click(); } } });
      if (S.orders[0] && S.orders[0].onboarding.status === 'in-progress') toast('Welcome back. Your domain setup is waiting.', { action: { label: 'Continue', run: openCheckout } });
    });
  }).catch(function (e) {
    if (e.status === 401 || e.status === 429) fatal(e.message);
    else fatal('Something went wrong loading your website: ' + e.message);
  });
})();
