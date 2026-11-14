// The synthetic consultancy the open-planner tests share: its catalog, its brief, and a well-grounded DesignSpec.
type Spec = import('../../src/studio/concepts/designspec.js').DesignSpec;

// ── a synthetic consultancy: own lines, two services, a story, email + contact page, no phone, no photos ──
export const cat = {
  business: { name: 'Northline Systems, LLC', category: null, website: 'https://northline.example.com', summary: 'A systems consultancy.' },
  ownLines: ['Systems that talk to each other.', 'Integration', 'Migration', 'The person you talk to does the work.', 'Tell me what needs to connect.'],
  services: [{ id: 'svc-int', name: 'Integration', description: 'Connect your ERP to the tools around it.' }, { id: 'svc-mig', name: 'Migration', description: 'Move from the old system without losing history.' }],
  story: { heading: 'About', text: 'I combine business operations experience with engineering.' },
  actions: [{ id: 'cta-primary', label: 'Discuss your project', href: 'https://northline.example.com/contact', kind: 'site', factId: 'cta-primary' }, { id: 'email', label: 'Email us', href: 'mailto:hello@northline.example.com', kind: 'email', factId: 'email' }],
  omitted: [{ what: 'phone number and every call button', reason: 'no phone number found' }],
  photos: [], logo: { url: 'https://northline.example.com/og.png', colors: [] }, email: 'hello@northline.example.com',
  claims: [], items: [], facts: {}, allowedText: '',
} as unknown as import('../../src/studio/concepts/review.js').Catalog;
export const brief = {
  businessKey: 'site-northline.example.com', revision: 1, identity: { status: 'website-only' },
  brand: { colors: [{ role: 'primary', hex: '#000018' }, { role: 'accent', hex: '#005BEA' }], fonts: [{ family: 'Outfit' }, { family: 'Manrope' }, { family: 'JetBrains Mono' }], logo: { value: { url: 'https://northline.example.com/og.png', width: 1200, height: 630 }, status: 'needs_review' } },
} as unknown as import('../../src/studio/schema.js').BusinessBrief;

/** a spec as the API returns it: every field the schema requires is present, null or empty where unused */
export const answered = (s: Spec): Spec => ({
  ...s, hero: { backgroundPhoto: null, ...s.hero },
  sections: s.sections.map((x) => ({ media: { placement: 'none' as const, photoIds: [] }, ...x, items: x.items.map((it) => ({ photoId: null, ...it })) })),
  referencesUsed: s.referencesUsed ?? [],
});
export const good = (): Spec => answered({
  thesis: 'A quiet, engineered page: one strong sentence, then the work laid out like a ledger.',
  palette: { ground: 'white', surface: 'tint:#005BEA:6', ink: '#000018', inverse: '#000018', accent: '#005BEA', onAccent: 'white' },
  type: { heading: 'Outfit', body: 'Manrope', mono: 'JetBrains Mono', base: 17, scale: 1.333, headingWeight: 500, headingCase: 'none', tracking: -0.02, measure: 62 },
  grid: { maxWidth: 1200, gutter: 28, margin: 48 },
  shape: { radius: 4, rule: 'hairline' },
  header: { style: 'split', links: ['work', 'about'], action: 'cta-primary', sticky: true },
  hero: { composition: 'Headline across seven columns, the services as an index on the right.', background: 'ground', minHeight: 72, verticalAlign: 'end', align: 'start', textStart: 1, textSpan: 7, headlineSize: 4.6, kicker: { label: 'Systems consultancy' }, headline: { ownLine: 0 }, lede: { ownLine: 3 }, actions: ['cta-primary', 'email'], aside: { kind: 'service-index', start: 9, span: 4, items: [{ service: 'svc-int', field: 'name' }, { service: 'svc-mig', field: 'name' }], photoId: null } },
  sections: [
    { id: 'work', purpose: 'what the firm does', kind: 'services', heading: { label: 'What I do' }, intro: null, layout: { arrangement: 'side-by-side', headingStart: 1, headingSpan: 4, contentStart: 6, contentSpan: 7, itemColumns: 1, itemStyle: 'numbered', density: 'airy' }, background: 'surface', items: [{ title: { service: 'svc-int', field: 'name' }, body: { service: 'svc-int', field: 'description' } }, { title: { service: 'svc-mig', field: 'name' }, body: { service: 'svc-mig', field: 'description' } }], actions: [] },
    { id: 'about', purpose: 'who does the work', kind: 'story', heading: { story: 'heading' }, intro: { story: 'text' }, layout: { arrangement: 'stack', headingStart: 3, headingSpan: 8, contentStart: 3, contentSpan: 8, itemColumns: 1, itemStyle: 'large-type', density: 'regular' }, background: 'inverse', items: [{ title: { ownLine: 3 }, body: null }], actions: [] },
    { id: 'contact', purpose: 'one clear next step', kind: 'contact', heading: { ownLine: 4 }, intro: null, layout: { arrangement: 'stack', headingStart: 1, headingSpan: 12, contentStart: 1, contentSpan: 12, itemColumns: 1, itemStyle: 'plain', density: 'regular' }, background: 'ground', items: [], actions: ['cta-primary', 'email'] },
  ],
  imagery: { approach: 'No photos are verified: type, rules and space carry the page.', roles: [] },
  mobile: { heroOrder: 'text-first', navigation: 'menu-button', stickyAction: 'cta-primary', headingScale: 0.62, itemColumns: 1 },
});
