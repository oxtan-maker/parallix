import test from 'node:test';
import assert from 'node:assert/strict';
import { HTMLButtonElement as DomButton } from 'happy-dom';
import { act } from 'react';
import { renderBoard } from './web-board-harness.fixture.js';
import { toWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';
import { missionId } from '../../../../src/domain/mission.js';

const action = { command: 'handoff', enabled: true, reason: null, targetLane: 'review' } as const;
const commandResult = () => ({ kind: 'command-result' as const, transportVersion: 2, status: 'completed', value: null, error: null, durableEvidence: [] });
function snapshot() {
  return toWebBoardSnapshot(makeProjection({ active: [makeCard({ id: missionId('task-2436-interaction'), status: 'active', lane: 'active', commands: [action] })] }));
}
function payload(calls: readonly RequestInit[]) { return JSON.parse(String(calls[0].body)); }
function isSameNode(actual: unknown, expected: unknown) { return actual === expected; }

function familyBoard(kind = 'active:execute', enabled = true) {
  const board = snapshot();
  const card = board.stages.flatMap(stage => stage.cards)[0];
  const action = { ...card.actions[0], kind, state: enabled ? 'enabled' : 'unavailable' } as typeof card.actions[number];
  return { ...board, stages: board.stages.map(stage => ({ ...stage, cards: stage.cards.map(card => ({ ...card, actions: [action] })) })),
    agentAvailability: [
      { family: 'codex', available: true, blockedFor: { kind: 'finite' as const, ms: 0 }, reason: null },
      { family: 'custom', available: true, blockedFor: { kind: 'finite' as const, ms: 0 }, reason: null },
      { family: 'claude', available: false, blockedFor: { kind: 'indefinite' as const }, reason: 'usage blocked' },
    ] };
}

for (const kind of ['draft:create', 'active:execute', 'review:submit']) {
  for (const pointerType of ['mouse', 'touch']) {
    test(`agent menu holds ${kind} with ${pointerType}, suppresses release and selects one explicit family`, async (t) => {
      const page = await renderBoard({ board: familyBoard(kind) });
      t.mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const button = page.mount.querySelector<DomButton>(`button[data-action-kind="${kind}"]`)!;
        await act(async () => { button.dispatchEvent(new page.window.PointerEvent('pointerdown', { bubbles: true, pointerType, isPrimary: true, button: 0, pointerId: 1 })); t.mock.timers.tick(450); });
        const menu = page.window.document.querySelector('[role="menu"]')!;
        assert.ok(menu);
        await act(async () => { button.dispatchEvent(new page.window.PointerEvent('pointerup', { bubbles: true })); button.click(); });
        assert.equal(page.calls.length, 0);
        const items = [...menu.querySelectorAll<DomButton>('button')];
        assert.equal(items[2].disabled, true);
        await act(async () => { items[2].click(); });
        assert.equal(page.calls.length, 0);
        await act(async () => { items[1].click(); });
        assert.equal(page.calls.length, 1);
        assert.equal(payload(page.calls).kind, kind);
        assert.equal(payload(page.calls).agent, 'custom');
        assert.equal(payload(page.calls).missionId, 'task-2436-interaction');
        assert.equal(page.window.document.querySelector('[role="menu"]') === null, true);
      } finally { t.mock.timers.reset(); await page.close(); }
    });
  }
}

test('agent menu keyboard navigation and Escape restore action focus without a command', async () => {
  const page = await renderBoard({ board: familyBoard() });
  try {
    const button = page.mount.querySelector<DomButton>('button[data-action-kind="active:execute"]')!;
    await act(async () => { button.focus(); button.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    const items = [...page.window.document.querySelectorAll<DomButton>('[role="menuitem"]')];
    assert.equal(isSameNode(page.window.document.activeElement, items[0]), true);
    await act(async () => { items[0].dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'End', bubbles: true })); });
    assert.equal(isSameNode(page.window.document.activeElement, items[1]), true);
    await act(async () => { items[1].dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    assert.equal(isSameNode(page.window.document.activeElement, button), true);
    assert.equal(page.calls.length, 0);
    assert.equal(page.window.document.querySelector('[role="menu"]') === null, true);
    await act(async () => { button.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })); });
    await act(async () => { page.window.document.querySelectorAll<DomButton>('[role="menuitem"]')[1].click(); });
    assert.equal(payload(page.calls).agent, 'custom');
  } finally { await page.close(); }
});

test('agent menu cancels leaving, pointer cancellation and movement; short click retains default', async (t) => {
  const page = await renderBoard({ board: familyBoard() });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const button = page.mount.querySelector<DomButton>('button[data-action-kind="active:execute"]')!;
    for (const type of ['pointerout', 'pointercancel', 'pointermove']) {
      await act(async () => {
        button.dispatchEvent(new page.window.PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0 }));
        button.dispatchEvent(new page.window.PointerEvent(type, { bubbles: true, clientX: 30 }));
        t.mock.timers.tick(450); button.click();
      });
      assert.equal(page.window.document.querySelector('[role="menu"]') === null, true);
      assert.equal(page.calls.length, 0);
    }
    await act(async () => {
      button.dispatchEvent(new page.window.PointerEvent('pointerdown', { bubbles: true, isPrimary: true, button: 0 }));
      t.mock.timers.tick(100); button.dispatchEvent(new page.window.PointerEvent('pointerup', { bubbles: true })); button.click();
    });
    assert.equal(page.calls.length, 1);
    assert.equal(payload(page.calls).agent, undefined);
  } finally { t.mock.timers.reset(); await page.close(); }
});

test('agent menu dismisses outside and cannot bypass unavailable or pending action protection', async () => {
  let release!: (response: Response) => void;
  const page = await renderBoard({ board: familyBoard(), respond: () => new Promise(resolve => { release = resolve; }) });
  try {
    const button = page.mount.querySelector<DomButton>('button[data-action-kind="active:execute"]')!;
    await act(async () => { button.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    await act(async () => { page.window.document.body.dispatchEvent(new page.window.PointerEvent('pointerdown', { bubbles: true })); });
    assert.equal(page.window.document.querySelector('[role="menu"]') === null, true);
    assert.equal(page.calls.length, 0);
    await page.rerender(familyBoard('active:execute', false));
    await act(async () => { button.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    assert.equal(page.window.document.querySelector('[role="menu"]') === null, true);
    await page.rerender(familyBoard());
    await act(async () => { button.click(); });
    await act(async () => { button.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    assert.equal(page.window.document.querySelector('[role="menu"]') === null, true);
    assert.equal(page.calls.length, 1);
    await act(async () => { release(new Response(JSON.stringify(commandResult()))); });
  } finally { await page.close(); }
});
