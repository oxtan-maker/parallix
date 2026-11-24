// Browser analytics read cases: the historical family reads on its own path, keeps the last validated read
// while a routine recheck is pending, and shows host degradation, failure and recovery honestly (TASK-2854.04, TASK-2859.17).
import test from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { HTMLButtonElement as DomButton } from 'happy-dom';
import { webProjection } from '../../../fixtures/web-projection.js';
import { makeProjection } from '../../../fixtures/board-projection.js';
import type { WebBoardAnalytics } from '../../../../src/interfaces/web/transport.js';
import { renderBoard as renderBoardFixture } from './web-board-harness.fixture.js';

const snapshot = () => webProjection.snapshot(makeProjection());

test('the browser re-observes the analytics family when the workflow revision moves and shows the settled value (TASK-2854.04)', async () => {
  const board = snapshot();
  const pending = { ...webProjection.analytics(makeProjection()), freshness: { state: 'unavailable' as const, revision: 'history-v1',
    refreshedAt: null, reason: 'Historical analytics refresh is in progress.' } };
  const base = webProjection.analytics(makeProjection());
  const fresh = { ...base, metrics: { ...base.metrics, weeklyCompletedMissions: 7 } };
  let answer: WebBoardAnalytics = pending;
  const page = await renderBoardFixture({ board, analytics: () => answer });
  try {
    assert.equal(page.analyticsReads, 1);
    assert.match(page.mount.textContent ?? '', /unknown/, 'an unobserved analytics family renders no value');
    answer = fresh;
    await page.rerender({ ...board, freshness: { ...board.freshness } });
    assert.equal(page.analyticsReads, 1, 'a re-render under the same workflow observation does not re-read');
    await page.rerender({ ...board, freshness: { ...board.freshness, revision: 'workflow-next' } });
    assert.equal(page.analyticsReads, 2, 'a new workflow revision re-observes the analytics family');
    assert.match(page.mount.textContent ?? '', /7 missions\/wk/, 'the settled fresh read replaces the pending state');
  } finally { await page.close(); }
});

test('the browser re-reads analytics when the workflow family recovers from stale under an unchanged revision (TASK-2854.04)', async () => {
  const board = snapshot();
  const base = webProjection.analytics(makeProjection());
  const staleAnalytics = { ...base, metrics: { ...base.metrics, weeklyCompletedMissions: 3 },
    freshness: { ...base.freshness, state: 'stale' as const, reason: 'projection refresh failed' } };
  const recovered = { ...base, metrics: { ...base.metrics, weeklyCompletedMissions: 7 } };
  let answer: WebBoardAnalytics = staleAnalytics;
  const page = await renderBoardFixture({ board, analytics: () => answer });
  try {
    assert.match(page.mount.textContent ?? '', /3 missions\/wk \(stale\)/);
    answer = recovered;
    // The host publishes the recovery with the same projection revision but a newer observation.
    await page.rerender({ ...board, freshness: { ...board.freshness, refreshedAt: '2026-11-15T12:00:00.000Z' } });
    assert.equal(page.analyticsReads, 2, 'a newer workflow observation re-reads even when the revision is unchanged');
    assert.match(page.mount.textContent ?? '', /7 missions\/wk(?! \(stale\))/, 'the recovered family clears the stale state');
  } finally { await page.close(); }
});

/** One analytics response the test releases by hand, so the interim UI can be observed. */
function heldRead() {
  let release!: (value: WebBoardAnalytics) => void;
  let fail!: (reason: Error) => void;
  const response = new Promise<WebBoardAnalytics>((resolve, reject) => { release = resolve; fail = reject; });
  return { response, release, fail };
}

const withWeekly = (value: number, freshness?: Partial<WebBoardAnalytics['freshness']>): WebBoardAnalytics => {
  const base = webProjection.analytics(makeProjection());
  return { ...base, metrics: { ...base.metrics, weeklyCompletedMissions: value }, freshness: { ...base.freshness, ...freshness } };
};

test('healthy analytics rechecks keep the validated value and FLOW steady until the replacement settles (TASK-2859.17)', async () => {
  const board = snapshot();
  const reads: Array<ReturnType<typeof heldRead>> = [];
  let served: () => Promise<WebBoardAnalytics> = async () => withWeekly(7);
  const page = await renderBoardFixture({ board, analytics: () => served() });
  const text = () => page.mount.textContent ?? '';
  const freshnessNotice = () => page.mount.querySelector('[data-analytics-freshness]');
  const hold = () => { const read = heldRead(); reads.push(read); served = () => read.response; return read; };
  const settle = async (read: ReturnType<typeof heldRead>, value: WebBoardAnalytics) => { await act(async () => { read.release(value); await read.response; }); };
  const publish = (revision: string) => page.rerender({ ...board, freshness: { ...board.freshness, revision } });
  try {
    assert.match(text(), /7 missions\/wk(?! \(stale\))/);
    await act(async () => { page.mount.querySelector<DomButton>('[data-view-nav="flow"]')!.click(); });
    assert.equal(freshnessNotice(), null, 'validated FLOW data carries no notice');
    const flowBefore = page.mount.querySelector('[data-flow-view]')!.innerHTML;

    const first = hold();
    await publish('workflow-2');
    const second = hold();
    await publish('workflow-3');
    assert.equal(page.analyticsReads, 3, 'each healthy workflow observation re-reads');
    assert.match(text(), /7 missions\/wk(?! \(stale\))/, 'the last validated value stays while the replacement is held');
    assert.equal(freshnessNotice(), null, 'no stale notice appears during a healthy read');
    assert.equal(page.mount.querySelector('[data-flow-view]')!.innerHTML, flowBefore, 'FLOW layout does not change while the read is pending');

    await settle(second, withWeekly(9));
    await settle(first, withWeekly(8));
    assert.match(text(), /9 missions\/wk(?! \(stale\))/, 'the newest settled read wins; a superseded read cannot replace it');
    assert.equal(freshnessNotice(), null);

    const degraded = hold();
    await publish('workflow-4');
    await settle(degraded, withWeekly(9, { state: 'stale', reason: 'projection refresh failed' }));
    assert.match(text(), /9 missions\/wk \(stale\)/, 'a host-reported stale family is shown stale');
    assert.match(freshnessNotice()?.textContent ?? '', /projection refresh failed/);

    const recheck = hold();
    await publish('workflow-5');
    assert.match(text(), /9 missions\/wk \(stale\)/, 'a pending read cannot clear a genuine stale state');
    assert.notEqual(freshnessNotice(), null);
    await settle(recheck, withWeekly(10));
    assert.match(text(), /10 missions\/wk(?! \(stale\))/, 'recovery clears the stale state');
    assert.equal(freshnessNotice(), null);

    const failing = hold();
    await publish('workflow-6');
    await act(async () => { failing.fail(new Error('analytics offline')); await failing.response.catch(() => undefined); });
    assert.match(text(), /missions\/wk unknown/, 'a failed read never keeps claiming a value');
    assert.match(text(), /historical analytics read failed: analytics offline/, 'the failure reason is on screen');

    const recovery = hold();
    await act(async () => { page.mount.querySelector<DomButton>('[data-analytics-reobserve]')!.click(); });
    assert.match(text(), /missions\/wk pending/, 'a manual re-observe shows its own pending state');
    await settle(recovery, withWeekly(11));
    assert.match(text(), /11 missions\/wk(?! \(stale\))/, 'a manual re-observe recovers from failure');
    assert.equal(freshnessNotice(), null);
  } finally { await page.close(); }
});
