import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('http://localhost:4174/showcase/index.html', { waitUntil: 'networkidle' });
await page.evaluate(() => document.getElementById('performance')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(800);
// Clip to the perf region.
const box = await page.locator('#performance').boundingBox();
if (box) {
  await page.screenshot({ path: '/tmp/perf-table.png', clip: { x: 0, y: box.y, width: 1280, height: Math.min(box.height, 900) } });
}
console.log('SHOT2_OK');
await browser.close();
