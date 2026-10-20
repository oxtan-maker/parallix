// Manual observation only — no assertion suite, no gate membership.
// Run: node --import tsx test/fixtures/board-lane-layout-manual.mjs
//
// TASK-2773.06 walkthrough of the running board's public interface against the
// isolated pointer-board fixture (its own loopback server and browser, no
// operator mission, database or statistics). It prints the measured in-flight
// lane widths at a wide and a narrow viewport, both snapshot transition
// directions, selection and command continuity across them, a real drag onto a
// compact empty lane, horizontal lane access and per-lane vertical scrolling.
import { makeCard, makeProjection } from './board-projection.ts';
import { pointerBoard } from './web-pointer-board.ts';
import { toWebBoardSnapshot } from '../../src/interfaces/web/transport.ts';
import { missionId } from '../../src/domain/mission.ts';

const FLIGHT_LANES = ['active', 'review', 'integration'];
const VIEWPORTS = { wide: { width: 1600, height: 700 }, narrow: { width: 900, height: 600 } };

/** A card with the commands the walkthrough presses and drags. */
function card(id, lane) {
  return makeCard({
    id: missionId(id),
    title: `Lane layout fixture ${id}`,
    lane,
    status: lane,
    commands: [
      { command: 'handoff', enabled: true, reason: null, targetLane: 'review' },
      { command: 'integrate', enabled: true, reason: null, targetLane: 'integration' },
    ],
  });
}

const board = (cardsByLane) => toWebBoardSnapshot(makeProjection(cardsByLane));
const LAYOUTS = {
  'all-empty': board({}),
  mixed: board({ active: [card('task-layout-active-1', 'active'), card('task-layout-active-2', 'active')] }),
  populated: board({
    active: [card('task-layout-active-1', 'active')],
    review: [card('task-layout-review-1', 'review')],
    integration: [card('task-layout-integration-1', 'integration')],
  }),
};

/** Apply a snapshot to the already-mounted board, keeping its React state. */
async function apply(page, snapshot) {
  const applied = await page.evaluate(() => window.boardRenders);
  await page.evaluate((value) => window.renderBoard(value, false), snapshot);
  await page.waitForFunction((previous) => window.boardRenders > previous, applied, { timeout: 5000 });
  await page.waitForTimeout(30);
}

/** Everything the layout contract claims, read back out of the live page. */
const MEASURE = () => {
  const laneRow = document.querySelector('section[aria-label="active stage"]').parentElement.parentElement;
  const rowStyle = getComputedStyle(laneRow);
  const lanes = {};
  for (const lane of ['active', 'review', 'integration']) {
    const section = document.querySelector(`section[aria-label="${lane} stage"]`);
    const wrapper = section.parentElement;
    const wrapperBox = wrapper.getBoundingClientRect();
    const heading = section.querySelector('h2');
    const headingBox = heading.getBoundingClientRect();
    const count = heading.nextElementSibling;
    const body = section.querySelector(':scope > div:last-child');
    const cards = [...section.querySelectorAll('[data-board-card]')];
    const actions = cards.flatMap((element) => [...element.querySelectorAll('button[data-action-kind]')]);
    const clipped = actions.filter((action) => {
      const box = action.getBoundingClientRect();
      return box.right > wrapperBox.right + 1 || box.left < wrapperBox.left - 1;
    });
    lanes[lane] = {
      width: Math.round(wrapperBox.width),
      heading: heading.textContent,
      headingVisible: headingBox.width > 0 && headingBox.right <= wrapperBox.right + 1,
      count: count.textContent,
      empty: body.textContent.includes('no missions in this stage'),
      cards: cards.length,
      cardWidth: cards.length === 0 ? null : Math.round(cards[0].getBoundingClientRect().width),
      actions: actions.length,
      clippedActions: clipped.length,
      bodyOverflowY: getComputedStyle(body).overflowY,
      bodyScrollsIndependently: body.scrollHeight > body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight,
    };
  }
  return {
    lanes,
    rowOverflowX: rowStyle.overflowX,
    rowScrollWidth: laneRow.scrollWidth,
    rowClientWidth: laneRow.clientWidth,
    rowScrollLeft: laneRow.scrollLeft,
    pageScrollsVertically: document.documentElement.scrollHeight > window.innerHeight + 1,
    selected: [...document.querySelectorAll('[data-board-card][aria-current="true"]')].map((element) => element.dataset.boardCard),
    pending: [...document.querySelectorAll('[data-board-card] button[aria-label*="starting"], [data-board-card] button[aria-label*="working"]')].map((element) => element.dataset.actionKind),
    status: [...document.querySelectorAll('[role="status"]')].map((element) => element.textContent.trim()).filter(Boolean),
  };
};

function report(title, value) {
  console.log(`${title} :: ${JSON.stringify(value)}`);
}

const fixture = await pointerBoard();
const { page, requests } = fixture;
try {
  // The pointer fixture mounts Board directly, so the walkthrough supplies the
  // page container the Shell renders (height 100vh, flex column, overflow-y
  // auto). Board's own flex chain then decides where the scrolling lands.
  await page.addStyleTag({ content: '#root{height:100vh;display:flex;flex-direction:column;overflow-y:auto}' });
  for (const [label, viewport] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(viewport);
    await apply(page, LAYOUTS['all-empty']);
    report(`${label} ${viewport.width}x${viewport.height} all-empty`, await page.evaluate(MEASURE));
    await apply(page, LAYOUTS.mixed);
    report(`${label} ${viewport.width}x${viewport.height} mixed`, await page.evaluate(MEASURE));
    await apply(page, LAYOUTS.populated);
    const full = await page.evaluate(MEASURE);
    report(`${label} ${viewport.width}x${viewport.height} populated`, full);

    // Horizontal lane access: the lane row scrolls sideways instead of hiding a
    // lane or squeezing a card at this width.
    const scrolled = await page.evaluate(() => {
      const row = document.querySelector('section[aria-label="active stage"]').parentElement.parentElement;
      row.scrollLeft = row.scrollWidth;
      const active = document.querySelector('section[aria-label="active stage"]').parentElement.getBoundingClientRect();
      const after = { scrollLeft: row.scrollLeft, activeLeft: Math.round(active.left), activeWidth: Math.round(active.width) };
      row.scrollLeft = 0;
      return after;
    });
    report(`${label} horizontal lane access`, scrolled);

    // Independent vertical scrolling: one lane far taller than the viewport.
    const tall = board({
      active: Array.from({ length: 40 }, (_unused, index) => card(`task-layout-tall-${index}`, 'active')),
      review: [card('task-layout-review-1', 'review')],
    });
    await apply(page, tall);
    const vertical = await page.evaluate(() => {
      const body = document.querySelector('section[aria-label="active stage"] > div:last-child');
      const review = document.querySelector('section[aria-label="review stage"] > div:last-child');
      body.scrollTop = body.scrollHeight;
      const after = {
        activeScrollTop: body.scrollTop,
        activeScrollHeight: body.scrollHeight,
        activeClientHeight: body.clientHeight,
        reviewScrollTop: review.scrollTop,
        reviewScrollHeight: review.scrollHeight,
        laneWidths: ['active', 'review', 'integration'].map((lane) =>
          Math.round(document.querySelector(`section[aria-label="${lane} stage"]`).parentElement.getBoundingClientRect().width)),
      };
      body.scrollTop = 0;
      return after;
    });
    report(`${label} independent vertical scrolling`, vertical);
  }

  // Both transition directions on one mount, with a selection and a running
  // command held across them.
  await page.setViewportSize(VIEWPORTS.wide);
  await apply(page, LAYOUTS.mixed);
  // A coordinate click on a card body also opens that mission's history dialog,
  // so the walkthrough selects with focus, which is how the board's own
  // keyboard navigation selects a card.
  await page.locator('[data-board-card="task-layout-active-1"]').focus();
  fixture.hold();
  const handoff = page.locator('[data-board-card="task-layout-active-1"] button[data-action-kind="handoff:record"]');
  const handoffBox = await handoff.boundingBox();
  await page.mouse.click(handoffBox.x + handoffBox.width / 2, handoffBox.y + handoffBox.height / 2);
  await page.waitForFunction(() => !!document.querySelector('[data-board-card] button[aria-label*="starting"]'));
  report('transition start (mixed, selected + pending)', await page.evaluate(MEASURE));

  await apply(page, LAYOUTS.populated);
  report('after empty-to-populated', await page.evaluate(MEASURE));
  await apply(page, LAYOUTS.mixed);
  report('after populated-to-empty', await page.evaluate(MEASURE));
  fixture.release();
  await page.waitForFunction(() => !document.querySelector('[data-board-card] button[aria-label*="starting"]'));
  report('after the command settles', await page.evaluate(MEASURE));
  report('commands sent by the transitions and the press', requests.map((request) => request.kind));

  // Removal of the selected mission keeps the existing selection semantics.
  await apply(page, LAYOUTS['all-empty']);
  report('after the selected mission leaves the snapshot', await page.evaluate(MEASURE));

  // A real drag from a populated lane onto the compact empty lane.
  await apply(page, LAYOUTS.mixed);
  const dragged = await page.locator('[data-board-card="task-layout-active-2"]').boundingBox();
  const target = await page.locator('section[aria-label="review stage"] > div:last-child').boundingBox();
  await page.mouse.move(dragged.x + 30, dragged.y + 20);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  report('after a drag onto the compact empty lane', await page.evaluate(MEASURE));
  report('commands sent in total', requests.map((request) => request.kind));
} finally {
  await fixture.close();
}
