import type { BusinessBrief, SiteInventory } from './schema.js';

/**
 * Plain-text reports for a reviewer: which pages and documents were read, skipped or failed; where the sources
 * disagree. Every count comes from the inventory (its coverage and its asset summary) or the brief; nothing here
 * tallies on its own, so a report cannot disagree with the data it describes.
 */

const path = (u: string) => { try { const x = new URL(u); return `${x.pathname}${x.search}` || '/'; } catch { return u; } };
const file = (u: string) => decodeURIComponent(path(u).split('/').pop() || u);
const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const src = (s: { url: string; sourceType: string; locator?: string }) => (s.sourceType === 'google' ? 'Google listing' : `${path(s.url)}${s.locator ? ` (${s.locator})` : ''}`);

/** The counts of one business, from its inventory and brief: the summary table's row. */
export function countsOf(inv: SiteInventory, brief: BusinessBrief) {
  const c = inv.coverage, a = inv.assetSummary.website;
  return {
    name: brief.identity.name.value ?? inv.businessKey,
    pages: { found: c.discovered, read: c.read, rendered: c.rendered, skipped: c.skipped, failed: c.failed, partial: c.partial },
    documents: c.documents,
    offerings: { items: brief.offerings.items.length, priced: brief.offerings.items.filter((i) => i.price).length, priceNeedsReview: brief.offerings.items.filter((i) => i.price?.status === 'needs_review').length },
    services: brief.services.items.length,
    pictures: { total: a.total, usable: a.outcomes.usable, downloaded: a.examined.downloaded, downloadFailed: a.examined.downloadFailed, notDownloaded: a.examined.byFileName + a.examined.byRole, overBudget: a.examined.overBudget, google: inv.assetSummary.google.total },
    conflicts: brief.conflicts.length,
    held: brief.callsToAction.held.length,
    blocking: brief.ownerQuestions.filter((q) => q.blocking).length,
  };
}

/** One table for several businesses, each row from that business's inventory and brief. */
export function summaryTable(rows: { inventory: SiteInventory; brief: BusinessBrief }[]): string {
  const lines = [
    '| Business | Pages found / read / rendered / skipped / failed | PDFs found / read / failed / not read | Menu items (priced) | Services | Pictures: usable of total (downloaded, failed, judged without download, over budget) | Google photos | Conflicts | Held actions | Blocking questions |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const { inventory, brief } of rows) {
    const k = countsOf(inventory, brief);
    lines.push(`| ${cell(k.name)} | ${k.pages.found} / ${k.pages.read} / ${k.pages.rendered} / ${k.pages.skipped} / ${k.pages.failed}${k.pages.partial ? ' (partial)' : ''} | ${k.documents.found} / ${k.documents.read} / ${k.documents.failed} / ${k.documents.skipped} | ${k.offerings.items} (${k.offerings.priced}${k.offerings.priceNeedsReview ? `, ${k.offerings.priceNeedsReview} to check` : ''}) | ${k.services} | ${k.pictures.usable} of ${k.pictures.total} (${k.pictures.downloaded}, ${k.pictures.downloadFailed}, ${k.pictures.notDownloaded}, ${k.pictures.overBudget}) | ${k.pictures.google} | ${k.conflicts} | ${k.held} | ${k.blocking} |`);
  }
  return lines.join('\n') + '\n';
}

export function coverageReport(inv: SiteInventory, brief?: BusinessBrief): string {
  const c = inv.coverage;
  const lines = [
    `## ${brief?.identity.name.value ?? inv.businessKey}: page coverage`,
    '',
    `Site: ${inv.site.home ?? 'no website (Google listing only)'} · snapshot \`${inv.snapshotId}\` · captured ${inv.capturedAt}`,
    `Budget: ${inv.site.budget.maxPages} pages, ${inv.site.budget.maxDepth} links deep · robots.txt ${inv.site.robots.found ? `found (${inv.site.robots.disallow.length} disallow rules, ${inv.site.robots.sitemaps.length} sitemap(s) named)` : 'not found'}`,
    `Sitemaps: ${inv.site.sitemaps.length ? inv.site.sitemaps.map((s) => `${path(s.url)} ${s.status}${s.status === 'read' ? ` (${s.urls} URLs)` : ` (${s.error})`}`).join(', ') : 'none found'}`,
    '',
    `**${c.discovered} addresses found: ${c.read} read, ${c.rendered} read after running scripts, ${c.skipped} skipped, ${c.failed} failed.**${c.partial ? ' Coverage is partial.' : ''}`,
    '',
  ];
  if (!inv.pages.length) lines.push('No pages: there is no website to read.', '');
  else {
    lines.push('| Page | Status | Type | How found | Tries | Detail |', '|---|---|---|---|---|---|');
    const order = { read: 0, rendered: 1, failed: 2, skipped: 3 } as const;
    for (const p of [...inv.pages].sort((a, b) => order[a.status] - order[b.status] || a.depth - b.depth || a.url.localeCompare(b.url))) {
      const detail = p.status === 'read' || p.status === 'rendered'
        ? [p.title && `"${p.title.slice(0, 50)}"`, p.services.length && `${p.services.length} services`, p.locations.length && `${p.locations.length} addresses`, p.forms.length && `${p.forms.length} form(s)`, p.images.length && `${p.images.length} pictures`].filter(Boolean).join(', ')
        : p.reason;
      lines.push(`| ${cell(path(p.url))} | ${p.status}${p.httpStatus && p.status === 'failed' ? ` (${p.httpStatus})` : ''} | ${p.type} | ${p.discoveredVia.join(', ')} | ${p.attempts} | ${cell(detail || '')} |`);
    }
    if (Object.keys(c.skippedReasons).length) {
      lines.push('', 'Skipped, by reason:');
      for (const [r, n] of Object.entries(c.skippedReasons)) lines.push(`- ${n} × ${r}`);
    }
  }

  // linked PDFs
  const d = c.documents;
  lines.push('', `### Linked PDFs: ${d.found} found, ${d.read} read, ${d.failed} failed, ${d.skipped} not read`, '');
  if (inv.documents.length) {
    lines.push('| Document | Kind | Status | Pages read (how) | Items | Detail |', '|---|---|---|---|---|---|');
    for (const doc of inv.documents) {
      const how = doc.pages.map((p) => `${p.page}: ${p.method}${p.ocrConfidence !== undefined ? ` (OCR ${p.ocrConfidence}%)` : ''}`).join(', ');
      lines.push(`| ${cell(file(doc.url))} | ${doc.kind} | ${doc.status}${doc.httpStatus && doc.status === 'failed' ? ` (${doc.httpStatus})` : ''} | ${doc.pages.length ? `${doc.pages.length}${doc.totalPages && doc.totalPages > doc.pages.length ? ` of ${doc.totalPages}` : ''} (${cell(how)})` : '-'} | ${doc.items}${doc.items ? ` (${doc.layout})` : ''} | ${cell(doc.reason ?? (doc.anchor ? `link: "${doc.anchor}"` : ''))} |`);
    }
  }

  // pictures: both lines add up to the same total, the asset summary's
  const a = inv.assetSummary.website, e = a.examined, o = a.outcomes;
  lines.push('', `### Pictures: ${a.total} on the website, ${inv.assetSummary.google.total} on the Google listing (preview only)`, '',
    `- How each was examined: ${e.downloaded} downloaded and measured, ${e.downloadFailed} download failed, ${e.byFileName} judged by file name and ${e.byRole} by their role on the page (logos, social badges; not downloaded), ${e.overBudget} over the download budget (not measured).`,
    `- How they came out: ${o.usable} usable photos, ${o.graphic + o.icon + o.map} not photographs (${o.graphic} graphics, ${o.icon} icons, ${o.map} maps), ${o.undersized} too small, ${o.duplicate} duplicates, ${o.broken} broken, ${o.notProbed} not measured.`, '');
  return lines.join('\n');
}

export function conflictReport(brief: BusinessBrief): string {
  const lines = [`## ${brief.identity.name.value ?? brief.businessKey}: conflicts and open questions`, ''];
  if (!brief.conflicts.length) lines.push('No conflicts between the website and the Google listing.', '');
  for (const c of brief.conflicts) {
    lines.push(`### ${c.field}: ${c.summary}`);
    for (const v of c.values) lines.push(`- **${v.value}**: ${v.sources.map(src).join('; ')}`);
    lines.push(`- Until the owner decides: ${c.resolution}`, `- Question: ${brief.ownerQuestions.find((q) => q.id === c.questionId)?.question ?? c.questionId}`, '');
  }
  // the facts left without a value, each candidate with its sources
  const disputed = ([['phone', brief.contact.phone], ['address', brief.contact.address]] as const).filter(([, f]) => f.candidates?.length);
  if (disputed.length) {
    lines.push('### Facts with no chosen value');
    for (const [k, f] of disputed) {
      lines.push(`- ${k}: ${f.status}, ${f.note ?? ''}`);
      for (const cand of f.candidates!) lines.push(`  - ${typeof cand.value === 'string' ? cand.value : cand.value.formatted}: ${cand.sources.map(src).join('; ')}`);
    }
    lines.push('');
  }
  const ca = brief.callsToAction;
  lines.push('### Calls to action', `- Primary: ${ca.primary ? `"${ca.primary.label}" → ${ca.primary.href}` : 'none'}`, `- Secondary: ${ca.secondary ? `"${ca.secondary.label}" → ${ca.secondary.href}` : 'none'}`, `- Booking: ${ca.booking ?? 'none'}`);
  for (const h of ca.held) lines.push(`- Held: "${h.label}" → ${h.href}: ${h.reason} (until ${h.questionId} is answered)`);
  lines.push('');
  if (brief.locations.items.length) {
    lines.push(`### Locations (${brief.locations.status}; main location: ${brief.locations.primaryId ? brief.locations.items.find((l) => l.id === brief.locations.primaryId)?.address.formatted : 'none chosen'})`);
    for (const l of brief.locations.items) lines.push(`- ${l.address.formatted}${l.listing ? ' ← the Google listing' : ''}: ${l.sources.map((s) => (s.sourceType === 'google' ? 'Google' : path(s.url))).join(', ')}`);
    lines.push('');
  }
  if (brief.contact.otherPhones.length) lines.push(`Other phone numbers on the website: ${brief.contact.otherPhones.map((p) => `${p.value} (${p.sources.map((s) => path(s.url)).join(', ')})`).join('; ')}`, '');
  if (brief.unknowns.length) { lines.push('### Unknown'); for (const u of brief.unknowns) lines.push(`- ${u.field}: ${u.why}`); lines.push(''); }
  lines.push(`### Owner questions (${brief.ownerQuestions.filter((q) => q.blocking).length} blocking)`);
  for (const q of brief.ownerQuestions) lines.push(`- ${q.blocking ? '**[blocking]** ' : ''}${q.question}${q.options ? ` (options: ${q.options.join(' / ')})` : ''}`);
  lines.push('');
  return lines.join('\n');
}

/** The menu or price list as Roger read it: each item with its price, how the price was tied to it, and its page. */
export function offeringsReport(brief: BusinessBrief): string {
  const o = brief.offerings;
  const lines = [`## ${brief.identity.name.value ?? brief.businessKey}: menu and prices from linked PDFs`, ''];
  if (!o.documents.length) return [...lines, 'No menu or price-list PDF was read.', ''].join('\n');
  for (const d of o.documents) lines.push(`- ${file(d.url)} (${d.kind}): ${d.method}; ${d.items} items`);
  lines.push('', '| Item | Section | Price | Price status | Tags | Where |', '|---|---|---|---|---|---|');
  for (const i of o.items) lines.push(`| ${cell(i.name)} | ${cell(i.section)} | ${cell(i.price?.text ?? '-')} | ${i.price ? `${i.price.status} (${cell(i.price.how)})` : '-'} | ${cell(i.tags.join(', '))} | ${cell(i.sources.map((s) => `${file(s.url)}: ${s.locator}`).join('; '))} |`);
  lines.push('');
  return lines.join('\n');
}
