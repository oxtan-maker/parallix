/** Status presentation contract, separate from the over-cap general board renderer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import { Board } from '../../../../web/src/board.js';
import { makeCard, makeProjection, makeAttentionItem } from '../../../fixtures/board-projection.js';
import { missionId } from '../../../../src/domain/mission.js';
import { toWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';

function statusSnapshot() {
  const cards = ['task-status-a', 'task-status-b'].map((id, index) => makeCard({
    id: missionId(id), lane: 'active', status: 'active', gate: 'unavailable',
    blockingReason: 'Shared failure reason',
    currentWork: index === 0 ? null : { operationId: 'status-fixture', phase: 'execute',
      summary: 'Shared failure reason', agent: null, updatedAt: 'now', freshness: 'live' },
  }));
  const projection = makeProjection({ active: cards });
  return toWebBoardSnapshot({ ...projection, attentionQueue: cards.map((card, index) =>
    makeAttentionItem(card, { kind: 'blocking', detail: index === 0 ? 'Shared failure reason' : 'Distinct attention reason' }, index + 1)) });
}

test('identical reasons collapse only within their mission while distinct reasons stay visible (TASK-2773.08)', async () => {
  const window = new Window();
  try {
    window.document.body.innerHTML = renderToStaticMarkup(React.createElement(Board, {
      snapshot: statusSnapshot(), onRefresh: async () => {},
    }));
    const visible = Array.from(window.document.querySelectorAll('article')).map(article => {
      const copy = article.cloneNode(true) as typeof article;
      copy.querySelectorAll('details:not([open])').forEach(detail => {
        const summary = detail.querySelector('summary')!.textContent;
        detail.textContent = summary;
      });
      return copy.textContent;
    }).join('\n');
    assert.equal(visible.split('Shared failure reason').length - 1, 2);
    assert.equal(visible.split('Distinct attention reason').length - 1, 1);
    const disclosures = Array.from(window.document.querySelectorAll('article details')).filter(detail => /^(Blocking reason|Reason) ·/.test(detail.querySelector('summary')!.textContent));
    assert.equal(disclosures.length, 3);
    for (const detail of disclosures) {
      assert.match(detail.querySelector('summary')!.textContent, /task-status-[ab]/);
      assert.match(detail.textContent, /Shared failure reason/);
    }
  } finally { await window.happyDOM.close(); }
});

test('recovery and unknown gates disclose explicit facts while failed gates and borders stay prominent (TASK-2773.08)', async () => {
  const window = new Window();
  try {
    const snapshot = statusSnapshot();
    const stage = snapshot.stages.find(stage => stage.lane === 'active')!;
    const failed = { ...stage.cards[1], gate: 'failed' as const };
    const html = renderToStaticMarkup(React.createElement(Board, {
      snapshot: { ...snapshot, stages: snapshot.stages.map(stage => stage.lane === 'active'
        ? { ...stage, cards: [stage.cards[0], failed] } : stage) }, onRefresh: async () => {},
    }));
    window.document.body.innerHTML = html;
    const cards = window.document.querySelectorAll('section[aria-label="active stage"] article');
    for (const card of cards) {
      const recovery = Array.from(card.querySelectorAll('details')).find(detail => detail.querySelector('summary')?.textContent === 'Recovery')!;
      assert.ok(recovery);
      assert.equal(recovery.hasAttribute('open'), false);
      assert.match(recovery.textContent, /recovery evidence: coordinator/);
      assert.match(card.getAttribute('style')!, /border-top:2px solid #e2604e/);
    }
    const unknown = Array.from(cards[0].querySelectorAll('details')).find(detail => detail.textContent.includes('gate · unknown'))!;
    assert.match(unknown.textContent, /gate · unavailable/);
    assert.doesNotMatch(unknown.textContent, /✓|passed/);
    assert.match(cards[1].textContent, /gate ✗ FAIL/);
    assert.doesNotMatch(html, /repeating-linear-gradient|#dfbc68/);
  } finally { await window.happyDOM.close(); }
});

test('status disclosures do not open the card terminal panel (TASK-2773.08)', async () => {
  const { renderBoard } = await import('./web-board-harness.fixture.js');
  const { act } = await import('react');
  const fixture = await renderBoard({ board: statusSnapshot() });
  try {
    const summaries = fixture.mount.querySelectorAll('article summary');
    assert.ok(summaries.length > 0);
    for (const summary of summaries) {
      await act(async () => { summary.dispatchEvent(new fixture.window.MouseEvent('click', { bubbles: true })); });
      assert.equal(fixture.mount.querySelector('[role="dialog"]'), null);
    }
  } finally { await fixture.close(); }
});
