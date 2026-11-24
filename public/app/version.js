// Shows this deployment's version in the top-right corner of every staff page (nothing on a local run).
(() => {
  fetch('/api/version', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => {
      if (!b || !b.version || b.version === 'dev') return;
      const el = document.createElement('div');
      el.className = 'roger-version';
      el.setAttribute('aria-label', 'Roger version');
      el.textContent = 'v' + b.version + (b.commit ? ' · ' + b.commit : '');
      el.style.cssText = 'position:fixed;top:6px;right:8px;z-index:2147483647;padding:1px 8px;border-radius:999px;background:rgba(17,24,39,.82);color:#fff;font:600 11px/1.6 system-ui,sans-serif;letter-spacing:.02em;pointer-events:none';
      document.body.appendChild(el);
    })
    .catch(() => {});
})();
