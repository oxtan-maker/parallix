/**
 * Deterministic Mission Flow visual acceptance. Run after `npm run build:web`:
 *   npx tsx test/fixtures/web-flow-browser-manual.ts <reference.png> [output-dir]
 *
 * The production host serves the production Shell and its packaged fonts. The
 * reference crop removes only the documented 17px left / 11px top capture
 * chrome; no content mask, scaling or tolerance is applied.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createWebHost } from '../../src/interfaces/web/host.js';
import { loadWebAssets } from '../../src/adapters/web/asset-store.js';
import { flowReferenceProjection } from './flow-reference.js';

const reference = resolve(process.argv[2] ?? 'backlog/assets/mission-flow-reference.png');
const output = resolve(process.argv[3] ?? '/tmp/task-2836-flow-visual');
mkdirSync(output, { recursive: true });
const referenceHash = createHash('sha256').update(readFileSync(reference)).digest('hex');
assert.equal(referenceHash, '575afb2e0f99b1a1c6bbf202de1ad27fe821b0c17724ddeb309eca44f427d300');

const runImage = (args: readonly string[]) => {
  const result = spawnSync('magick', args, { encoding: 'utf8' });
  if (result.status !== 0) { throw new Error(`magick ${args.join(' ')}: ${result.stderr}`); }
};
const crop = `${output}/reference-crop.png`;
const actual = `${output}/actual.png`;
const overlay = `${output}/overlay.png`;
const difference = `${output}/difference.png`;
runImage([reference, '-crop', '1288x1646+17+11', '+repage', crop]);

const host = createWebHost({ assets: loadWebAssets('build/web'), buildProjection: async () => flowReferenceProjection() });
const info = await host.start();
const browser = await chromium.launch({ executablePath: process.env.PARALLIX_CHROMIUM ?? '/usr/bin/chromium', headless: true,
  args: ['--disable-extensions'], timeout: 10_000 });
try {
  const page = await browser.newPage({ viewport: { width: 1288, height: 1646 }, deviceScaleFactor: 1 });
  await page.goto(info.origin);
  await page.getByRole('button', { name: 'Flow', exact: true }).click();
  await page.locator('[data-flow-view]').waitFor();
  await page.evaluate(async () => { await Promise.all([
    document.fonts.load('400 12px "JetBrains Mono"'), document.fonts.load('500 12px "JetBrains Mono"'),
    document.fonts.load('700 15px "JetBrains Mono"'),
  ]); });
  assert.equal(await page.evaluate(() => document.fonts.check('400 12px "JetBrains Mono"')
    && document.fonts.check('500 12px "JetBrains Mono"') && document.fonts.check('700 15px "JetBrains Mono"')), true);
  assert.deepEqual(await page.locator('[data-flow-node]').evaluateAll(nodes => nodes.flatMap(node => node.scrollHeight > node.clientHeight
    ? [`${node.getAttribute('data-flow-node')}:${node.scrollHeight}/${node.clientHeight}`] : [])), [], 'Flow node text is clipped');
  const routeLabelBlockers = await page.locator('[data-flow-region="graph"]').evaluate(root => {
    const labels = [...root.querySelectorAll<HTMLElement>('[data-flow-edge-label], [data-flow-edge-suffix]')].flatMap(element => {
      const id = element.getAttribute('data-flow-edge-label') ?? element.getAttribute('data-flow-edge-suffix');
      if (!id) { return []; }
      const rect = element.getBoundingClientRect();
      return [{ id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }];
    });
    return [...root.querySelectorAll<SVGGElement>('[data-flow-edge]')].flatMap(group => {
      const id = group.getAttribute('data-flow-edge'), line = group.querySelector<SVGPolylineElement>('polyline');
      if (!id || !line) { return []; }
      const svg = line.ownerSVGElement!.getBoundingClientRect();
      const points = Array.from({ length: line.points.numberOfItems }, (_, index) => line.points.getItem(index))
        .map(point => ({ x: svg.left + point.x, y: svg.top + point.y }));
      return labels.filter(label => label.id !== id && points.slice(1).some((point, index) => {
        const prior = points[index]!;
        return prior.x === point.x
          ? prior.x > label.left && prior.x < label.right && Math.max(Math.min(prior.y, point.y), label.top) < Math.min(Math.max(prior.y, point.y), label.bottom)
          : prior.y > label.top && prior.y < label.bottom && Math.max(Math.min(prior.x, point.x), label.left) < Math.min(Math.max(prior.x, point.x), label.right);
      })).map(label => `${id} crosses ${label.id}`);
    });
  });
  assert.deepEqual(routeLabelBlockers, [], 'a deterministic high-count edge crosses another edge label');
  await page.screenshot({ path: actual });
  const regions = await page.locator('[data-flow-view]').evaluate(root => Object.fromEntries(
    [...root.querySelectorAll<HTMLElement>('[data-flow-region]')].map(element => {
      const box = element.getBoundingClientRect();
      return [element.dataset.flowRegion!, { x: box.x, y: box.y, width: box.width, height: box.height }];
    }),
  ));
  const metadata = await page.evaluate(() => ({
    userAgent: navigator.userAgent, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight],
    font: getComputedStyle(document.querySelector('[data-flow-view]')!).fontFamily,
    loadedFonts: [...document.fonts].filter(face => face.family.includes('JetBrains')).map(face => `${face.weight}:${face.status}`),
  }));
  runImage([crop, actual, '-compose', 'blend', '-define', 'compose:args=50,50', '-composite', overlay]);
  runImage([crop, actual, '-compose', 'difference', '-composite', difference]);
  const metric = spawnSync('compare', ['-metric', 'RMSE', crop, actual, 'null:'], { encoding: 'utf8' });
  assert.ok(metric.status === 0 || metric.status === 1, metric.stderr);
  console.log(JSON.stringify({ reference, referenceHash, crop: '1288x1646+17+11 at 1:1', masks: [], actual, overlay, difference,
    rmse: metric.stderr.trim(), regions, ...metadata }, null, 2));
} finally {
  await browser.close();
  await host.close();
}
