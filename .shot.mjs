import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('http://localhost:4174/showcase/index.html', { waitUntil: 'networkidle' });

// Scroll to the performance section.
await page.evaluate(() => {
  const el = document.getElementById('performance');
  if (el) el.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/perf-section.png' });

// Also grab the hero meta.
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/hero-meta.png' });

console.log('SHOT_OK');
await browser.close();
