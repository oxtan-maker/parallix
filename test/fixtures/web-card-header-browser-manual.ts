/** Disposable Chromium board exercise; no operator missions, database or statistics. */
import assert from 'node:assert/strict';
import { pointerBoard } from './web-pointer-board.js';
import { makeCard, makeProjection } from './board-projection.js';
import { agentFamily } from '../../src/domain/agents.js';
import { projectProviderExecution } from '../../src/application/projections/provider-execution.js';
import { toWebBoardSnapshot } from '../../src/interfaces/web/transport.js';

const card = makeCard({
  title: 'Disposable header observation', agent: agentFamily('codex'),
  checkpoint: 'CP-1', gate: 'passed',
  checkpointEvidence: [{ name: 'CP-1', description: 'Header fixture',
    goalCheck: [{ criterion: 'Header first', evidence: 'Disposable browser observation' }] }],
  currentWork: { operationId: 'header-fixture', phase: 'execute', summary: 'Fixture activity',
    agent: agentFamily('codex'), updatedAt: new Date().toISOString(), freshness: 'live' },
  commands: [{ command: 'handoff', enabled: true, reason: null, targetLane: 'review' }],
});
const board = makeProjection({ active: [card] });
const availability = ['codex', 'claude'].map(family => ({ family: agentFamily(family), available: true, blockedForMs: 0 }));
const fixture = await pointerBoard();
try {
  const { page } = fixture;
  const states = [['populated', 'claude', true], ['empty', null, true],
    ['incomplete-populated', 'codex', false], ['incomplete-empty', null, false], ['absent', null, true]] as const;
  for (const [state, family, complete] of states) {
    const snapshot = toWebBoardSnapshot(state === 'absent' ? board : projectProviderExecution(
      { ...board, metrics: { ...board.metrics, agentAvailability: availability } }, {
        observe: () => ({ observedAt: new Date().toISOString(), complete,
          limitations: complete ? [] : ['fixture probe unavailable'],
          invocations: family ? [{ runId: `execute-${family}-a1-fixture`, operationId: 'header-fixture', family: agentFamily(family) }] : [] }),
      }));
    await fixture.render(snapshot);
    const article = page.locator(`[data-board-card="${card.id}"]`);
    const header = article.locator(':scope > div').first();
    assert.equal(await article.locator('[data-provider-execution]').count(), 0);
    assert.equal(await header.locator('.fan.spin').count(), 2);
    assert.ok((await header.innerText()).includes(card.id));
    assert.ok((await header.innerText()).includes(card.title));
    assert.doesNotMatch(await article.innerText(), /executing|execution unknown/);
    if (family) { assert.equal(await header.locator('[title*="active worker"]').innerText(), family); }
    console.log(JSON.stringify({ state, header: await header.innerText(), extraRows: 0 }));
    if (state !== 'populated') { continue; }
    const box = await header.boundingBox(); const bounds = await article.boundingBox();
    assert.ok(box && bounds && box.y - bounds.y <= 3, 'header starts at card top border');
    await article.focus();
    assert.equal(await article.getAttribute('aria-current'), 'true');
    assert.equal(await article.getAttribute('draggable'), 'true');
    await article.getByRole('button', { name: /View checkpoint evidence/ }).click();
    await page.getByRole('dialog', { name: /Checkpoint evidence/ }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog', { name: /Checkpoint evidence/ }).count(), 0);
    const response = page.waitForResponse(result => result.request().method() === 'POST');
    await article.locator('[data-action-kind="handoff:record"]').click();
    assert.equal((await response).status(), 200);
    assert.equal(fixture.requests.length, 1);
    assert.equal((fixture.requests[0] as { missionId: string }).missionId, card.id);
    const screenshot = process.argv[2];
    if (screenshot) { await page.screenshot({ path: screenshot }); }
    console.log(JSON.stringify({ headerOffsetPx: box.y - bounds.y, selection: true,
      draggable: true, checkpointOpenedAndClosed: true, handoffRequests: fixture.requests.length }));
  }
  console.log('PASS: five observation states; isolated browser assets and in-memory command endpoint only');
} finally { await fixture.close(); }
