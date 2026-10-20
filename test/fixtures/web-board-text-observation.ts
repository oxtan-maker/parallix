/**
 * Disposable manual observation, not an E2E suite.
 * Run: npx tsx test/fixtures/web-board-text-observation.ts
 * Uses fixture HTTP only; never connects to a repository database or agent.
 */
import assert from 'node:assert/strict';
import { pointerBoard, pointerSnapshot } from './web-pointer-board.js';
import { makeCard, makeFullCard, makeProjection, makeAttentionItem } from './board-projection.js';
import { toWebBoardSnapshot } from '../../src/interfaces/web/transport.js';

const fixture = await pointerBoard();
try {
  const card = makeFullCard({ blockingReason: 'blocked fixture', agent: null,
    commands: [{ command: 'review', enabled: false, reason: 'unavailable', targetLane: null }] });
  const projection = {
    ...makeProjection({ review: [card], done: [makeCard({ lane: 'done', status: 'done', closed: true })] }),
    attentionQueue: [makeAttentionItem(card, { kind: 'review-lane', detail: 'needs review' }, 1)],
  };
  await fixture.render(toWebBoardSnapshot(projection));
  const { page } = fixture;
  await page.locator('.shipped > summary').click();
  assert.equal(await page.locator('.shipped').getAttribute('open'), '');
  // tsx preserves local function names with this helper in serialized callbacks.
  await page.evaluate('window.__name = (fn) => fn');
  const readings = await page.evaluate(() => {
    const rgb = (value: string) => value.startsWith('#')
      ? value.slice(1).match(/../g)!.map(part => parseInt(part, 16))
      : value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const blend = (front: number[], back: number[], opacity: number) => front.map((value, index) => value * opacity + back[index] * (1 - opacity));
    const lum = (color: number[]) => color.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
    const samples: Record<string, Element> = {
      body: document.querySelector('[aria-label="review stage"] [data-board-card="task-1234"] p[style*="font-size: 11px"]')!,
      footer: document.querySelector('[aria-label="review stage"] [data-board-card="task-1234"] button[data-action-kind="review:submit"]')!,
      attention: document.querySelector('[aria-labelledby="attention-heading"] article span')!,
      laneCount: document.querySelector('[aria-label="review stage"] h2 + span')!,
      doneDisclosure: document.querySelector('.shipped .rail-open h2 + span')!,
      doneTitle: document.querySelector('.shipped article p')!,
      doneId: document.querySelector('.shipped article span[style*="letter-spacing"]')!,
    };
    return Object.entries(samples).map(([name, element]) => {
      if (!element) { throw new Error('missing sample: ' + name); }
      const style = getComputedStyle(element);
      const ancestors: Element[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) { ancestors.unshift(current); }
      // Use the lightest page-gradient stop as a conservative backdrop bound.
      let background = rgb('#12151a');
      let text = rgb(style.color);
      let opacity = 1;
      let groupBackdrop = background;
      for (const ancestor of ancestors) {
        const current = getComputedStyle(ancestor);
        if (Number(current.opacity) < 1) { groupBackdrop = background; opacity *= Number(current.opacity); }
        if (current.backgroundColor !== 'rgba(0, 0, 0, 0)') { background = rgb(current.backgroundColor); }
        if (current.backgroundImage.includes('gradient')) {
          const stops = current.backgroundImage.match(/rgb\([^)]+\)/g);
          if (stops?.length) { background = stops.map(rgb).sort((a, b) => lum(b) - lum(a))[0]; }
        }
      }
      text = blend(text, groupBackdrop, opacity);
      const renderedBackground = blend(background, groupBackdrop, opacity);
      return { name, text: element.textContent, color: style.color, surface: background, opacity,
        fontSize: parseFloat(style.fontSize), ratio: Number(ratio(text, renderedBackground).toFixed(2)) };
    });
  });
  for (const sample of readings) {
    assert.ok(sample.ratio >= 4.5, JSON.stringify(sample));
    assert.ok(sample.fontSize >= 11, JSON.stringify(sample));
  }
  console.log(JSON.stringify(readings, null, 2));
  const border = await page.locator('[data-board-card="task-1234"]').last().evaluate(element => getComputedStyle(element).borderTopColor);
  assert.equal(border, 'rgb(226, 96, 78)');
  await page.locator('.shipped > summary').click();
  assert.equal(await page.locator('.shipped').getAttribute('open'), null);
  const failed = pointerSnapshot('active', undefined, 'idle');
  await fixture.render({ ...failed, stages: failed.stages.map(stage => stage.lane === 'active'
    ? { ...stage, cards: stage.cards.map((card, index) => index === 0 ? { ...card, gate: 'failed' as const } : card) }
    : stage) });
  assert.equal(await page.locator('[data-board-card]').evaluate(element => getComputedStyle(element).borderTopColor), 'rgb(226, 96, 78)');
  await fixture.render(pointerSnapshot('active', undefined, 'running'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.fan.spin').first().evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.locator('[data-board-card] button[data-action-kind="mission:cancel"]').click();
  assert.equal(fixture.requests.length, 0);
  await page.getByRole('button', { name: 'delete task-pointer-disposable lifecycle rows' }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  assert.equal(fixture.requests.length, 1);
  assert.equal((fixture.requests[0] as { kind: string }).kind, 'mission:cancel');
  console.log('PASS: red blocked border, native done disclosure, reduced motion and explicit two-stage cancellation; fixture HTTP only.');
} finally { await fixture.close(); }
