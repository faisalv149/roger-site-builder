// A synthetic plumber for the splash tests: the plan, the generator's input, and an answer as Claude would give it.
// Loaded after the test has set its environment (the source modules read it when they load).
import type { SplashPlan } from '../src/splash/collect.js';
import type { FrontendInput } from '../src/studio/frontend/page.js';
import type { SplashCode } from '../src/splash/prompt.js';

export async function splashFixtures() {
  const { tradeRow } = await import('../src/splash/playbook.js');
  const { planScreens } = await import('../src/splash/screens.js');
  const { splashInput } = await import('../src/splash/build.js');
  const at = '2026-11-23T10:00:00Z';
  const F = (field: string, value: string | string[] | number | boolean, source: 'google' | 'website' | 'owner' = 'google') => ({ field, value, source, source_ref: `${source}:${field}`, retrieved_at: at });
  const row = tradeRow('plumber');
  const material = { reviews: 3, credentials: 1, offerings: 4, photos: 4, processStated: false, aboutName: false, aboutStory: false, faqs: 0 };
  const plan: SplashPlan = {
    placeId: 'PLACEtest', businessKey: 'place-PLACEtest', revision: 1, trade: { row: 'plumber', confidence: 0.95, via: 'primary-type' },
    fact_sheet: [F('name', 'Ridge Line Plumbing'), F('category', 'Plumber'), F('address', '1 Test Rd, Austin, TX 78701, USA'), F('phone', '(512) 555-0100'),
      F('hours', ['Monday: 8:00 AM – 5:00 PM', 'Saturday: Closed']), F('licence', 'Licensed master plumber', 'website'), F('service_area', ['Austin', 'Round Rock'], 'website')],
    conflicts: [], open_questions: [], questions: [], reviews: { selected: [], skipped: [], howChosen: '' }, material, screen_plan: planScreens(row, material), injection: [],
  };
  const listing = (n: number) => ({ id: `g${n}`, url: `google-listing:PLACEtest#${n}`, width: 1600, height: 1200, orientation: 'landscape' as const, uses: ['hero', 'card'], alt: 'Photo from Google Maps', seen: 'A plumber fitting a copper pipe under a sink', seenKind: 'work', services: [], fp: `fp${n}` });
  const base: FrontendInput = {
    business: { name: 'Ridge Line Plumbing', category: 'Plumber', website: 'https://ridgeline.example/', summary: null }, colours: ['#0B5FAD'],
    facts: { name: 'Ridge Line Plumbing', 'service-drains': 'Drain clearing', 'service-heaters': 'Water heaters', 'service-leaks': 'Leak repair', 'service-fixtures': 'Fixture installs' },
    actions: [{ id: 'call', label: 'Call', href: 'tel:+15125550100', kind: 'call', factId: 'phone' }], photos: [1, 2, 3, 4].map(listing), ownLines: [], services: [], items: [], story: null, notes: [],
  };
  const input = splashInput(plan, base, row);
  const screens = (p: SplashPlan) => p.screen_plan.screens.map((s) => s.screen);
  /** an answer as Claude would give it for a plan: every planned screen, bindings only for facts */
  const answer = (p: SplashPlan = plan): SplashCode => {
    const body: Record<string, string> = {
      hero: '<h1 data-copy="headline">Plumbing repairs across Austin</h1><p data-copy="subline">Leaks, drains and water heaters, fixed by a licensed local plumber.</p><a data-action="call">Call</a><div class="ph"><img data-photo="g1"></div>',
      proof: '<h2>What people say</h2><div data-google="reviews"></div><p data-fact="licence"></p>',
      offer: '<h2>What we fix</h2><ul><li data-fact="service-drains"></li><li data-fact="service-heaters"></li><li data-fact="service-leaks"></li><li data-fact="service-fixtures"></li></ul>',
      work: '<h2>Recent jobs</h2><div class="ph"><img data-photo="g2"></div><div class="ph"><img data-photo="g3"></div><div class="ph"><img data-photo="g4"></div>',
      expect: '<h2>How it works</h2><ol><li>Call or send the job details.</li><li>We confirm what is needed.</li><li>We fix it and walk you through it.</li></ol>',
      where: '<h2>Find us</h2><p data-fact="address"></p><p data-fact="hours"></p><p data-fact="phone"></p><a data-action="directions">Directions</a>',
      cta: '<h2>Need a plumber?</h2><a data-action="call">Call</a>',
    };
    return {
      motion: { hero: { treatment: 'subtle', reason: 'The headline names the trade and town; nothing needs staging.' }, section: { screen: screens(p)[1], treatment: 'subtle', reason: 'A plain list of services reads best without effects.' } },
      idea: 'Clean pipework lines.', design_tokens: { primary: '#0B5FAD' }, meta_description: 'Plumbing repairs, drains and water heaters in Austin from a licensed local plumber.', fonts: [],
      css: 'body{margin:0}', html: `<header><span data-fact="name"></span></header><main>${screens(p).map((s) => `<section id="${s}" data-screen="${s}"${s === 'hero' ? ' data-rk-hero="split" data-rk-sequence="direct"' : ''}>${body[s] ?? `<h2>${s}</h2>`}</section>`).join('')}</main><footer></footer>`,
    };
  };
  /** a stand-in for Claude: answers with `answer()`, counting its calls */
  const fakeTransport = () => {
    const calls: string[] = [];
    return { calls, transport: { via: 'fake' as const, model: 'claude-opus-5-5', async call(req: { prompt: string }) {
      calls.push(req.prompt);
      return { data: answer(), usage: { via: 'fake' as const, model: 'claude-opus-5-5', inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.05, costBasis: 'reported' as const } };
    } } };
  };
  return { at, F, row, material, plan, base, input, answer, fakeTransport };
}
