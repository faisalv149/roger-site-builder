// A Vercel preview links to itself, never to the production domain; production is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const baseUrl = (env: Record<string, string>) => spawnSync(process.execPath, ['--import', 'tsx', '-e', "import('./src/config.ts').then((m) => console.log(m.config.publicBaseUrl))"], { env: { ...process.env, PUBLIC_BASE_URL: '', RENDER_EXTERNAL_URL: '', RAILWAY_PUBLIC_DOMAIN: '', VERCEL_URL: '', VERCEL_ENV: '', VERCEL_PROJECT_PRODUCTION_URL: '', ...env }, encoding: 'utf8' }).stdout.trim().split('\n').pop();

test('a Vercel preview uses its own URL; production keeps the production domain; PUBLIC_BASE_URL wins', () => {
  assert.equal(baseUrl({ VERCEL_ENV: 'preview', VERCEL_URL: 'app-abc123-team.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'app.vercel.app' }), 'https://app-abc123-team.vercel.app');
  assert.equal(baseUrl({ VERCEL_ENV: 'production', VERCEL_URL: 'app-abc123-team.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'app.vercel.app' }), 'https://app.vercel.app');
  assert.equal(baseUrl({ VERCEL_ENV: 'preview', VERCEL_URL: 'app-abc123-team.vercel.app', PUBLIC_BASE_URL: 'https://preview.example.com' }), 'https://preview.example.com');
});
