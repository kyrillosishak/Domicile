/**
 * Studio playground smoke test.
 *
 * Serves the repo root (so showcase/index.html can import ../dist/index.js),
 * drives the playground with Playwright, and verifies the REAL engine returns
 * ranked results with non-constant scores — the proof that the showcase no
 * longer runs the fake keyword ranker.
 *
 * Run: node showcase/showcase.smoke.mjs  (requires `npm run build` first)
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

async function main() {
  if (!existsSync('./dist/index.js')) {
    console.error('dist/index.js missing — run `npm run build` first.');
    process.exit(1);
  }

  // Serve the repo root statically so showcase/index.html can import ../dist/index.js.
  const server = spawn('npx', ['serve', '.', '-l', '4173', '--no-clipboard'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  server.stdout.on('data', (d) => logs.push(d.toString()));
  server.stderr.on('data', (d) => logs.push(d.toString()));

  await waitFor('http://localhost:4173/showcase/', 30000);

  const browser = await chromium.launch();

  // --- Landing page: pure marketing, no engine, no playground section ---
  const landing = await browser.newPage();
  const landingErrors = [];
  landing.on('pageerror', (e) => landingErrors.push(String(e)));
  await landing.goto('http://localhost:4173/showcase/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  // The playground section must be gone from the landing page.
  const landingResults = await landing.locator('#results').count();
  if (landingResults > 0) throw new Error('landing page still contains the playground #results element — not separated');
  // The Playground nav link must point at the separate page.
  const navHref = await landing.locator('.nav-links a:has-text("Playground")').first().getAttribute('href');
  if (!navHref || !navHref.endsWith('playground.html')) throw new Error(`Playground nav link wrong: ${navHref}`);
  if (landingErrors.length) throw new Error('landing page errors: ' + landingErrors.slice(0, 3).join(' | '));
  console.log('✓ landing page is pure marketing (no playground section, nav → playground.html)');

  // --- Playground page: the real engine ---
  const page = await browser.newPage();
  const errors = [];
  const consoleMsgs = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => consoleMsgs.push(`${m.type()}: ${m.text()}`));

  await page.goto('http://localhost:4173/showcase/playground.html', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // The playground bootstraps the real engine + caches the embedding model
  // (one-time download). Wait for results to render.
  try {
    await page.waitForSelector('#results .result', { timeout: 90000 });
  } catch (e) {
    const phText = await page.locator('#results').textContent().catch(() => '?');
    throw new Error(`no results. #results="${phText?.slice(0,300)}". pageerrors=${errors.slice(0,3).join(' | ')} console=${consoleMsgs.slice(-8).join(' | ')}`);
  }
  const resultCount = await page.locator('#results .result').count();
  if (resultCount === 0) throw new Error('playground returned no results');

  // Scores must be real (varied), not the fake-ranker's near-identical values.
  const scores = await page.locator('#results .result .score').allTextContents();
  const nums = scores.map((s) => parseFloat(s));
  const max = Math.max(...nums), min = Math.min(...nums);
  if (max - min < 1) throw new Error(`scores not varied (fake ranker?): min=${min} max=${max}`);

  console.log(`✓ playground page returned ${resultCount} real results (scores ${min.toFixed(1)}%–${max.toFixed(1)}%)`);

  if (errors.length) throw new Error('page errors: ' + errors.slice(0, 3).join(' | '));
  console.log('✓ no page errors');

  await browser.close();
  server.kill();
  process.exit(0);
}

async function waitFor(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`server not ready at ${url}\n${logs.join('')}`);
}

main().catch((e) => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
