import test from 'node:test';
import assert from 'node:assert/strict';
import { assignPhotos, type PhotoInfo } from '../src/design/photos.js';
import { mergeServices } from '../src/content/facts.js';
import { pickServices } from '../src/content/services.js';
import { cityFromComponents } from '../src/sources/places.js';
import { loadThemes } from '../src/theme/load.js';
import type { Business } from '../src/types.js';

const photo = (key: string, kind: PhotoInfo['kind']): PhotoInfo => ({
  key, kind, width: 1800, height: 1200, aspect: 1.5, owner: false,
  sharpness: 0.8, exposure: 0.8, resolution: 0.9, quality: 0.8,
  image: { publicPath: `assets/${key}.webp`, width: 1200, height: 800, alt: 'Business photo', source: 'google' },
});

test('a previously empty photo plan recovers relevant food, bakery, barber and trade images on rebuild', () => {
  for (const category of ['restaurant', 'bakery', 'barber', 'plumber', 'roofer']) {
    const photos = [photo(`${category}-a`, 'work'), photo(`${category}-b`, 'work'), photo(`${category}-c`, 'storefront')];
    const roles = assignPhotos(photos, { hero: null, team: null, projects: [] });
    assert.ok(roles.hero, category);
    assert.ok(roles.projects.length >= 1, category);
  }
  assert.equal(assignPhotos([photo('menu-screenshot', 'other')]).hero, undefined);
});

test('review mentions alone cannot create a restaurant menu or a trade service list', () => {
  const reviewText = 'The Shinwari Karahi was delicious and the roof repair was quick.';
  assert.deepEqual(mergeServices([], [
    { name: 'Shinwari Karahi', description: '', icon: 'utensils' },
    { name: 'Roof repair', description: '', icon: 'wrench' },
  ], { siteText: '', reviewText }), []);
  const restaurant = { name: 'Example', reviews: [{ rating: 5, text: reviewText }], photos: [], nearbyTowns: [] } as unknown as Business;
  const roof = loadThemes().get('roofing-classic')!.theme;
  const selected = pickServices(roof, restaurant, undefined, [], {});
  assert.equal(selected.hidden, true);
  assert.deepEqual(selected.items, []);
});

test('a district is not used as the city when Google omits locality', () => {
  const components = [
    { types: ['sublocality'], longText: 'Gulberg III' },
    { types: ['administrative_area_level_2'], longText: 'Lahore' },
  ];
  assert.equal(cityFromComponents(components), 'Lahore');
  assert.equal(cityFromComponents(components.slice(0, 1)), undefined);
});
