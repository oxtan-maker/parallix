/** Disposable Chromium checkpoint exercise; no operator data or workflow writes. */
import assert from 'node:assert/strict';
import { pointerBoard } from './web-pointer-board.js';
import { makeProjection } from './board-projection.js';
import { fixtureMission } from './mission-builders.js';
import { projectMissionCard } from '../../src/application/projections/mission-board.js';
import { toWebBoardSnapshot } from '../../src/interfaces/web/transport.js';

const fixture = await pointerBoard();
try {
  for (const scenario of ['sparse', 'partial', 'first-start', 'repair', 'review', 'gate', 'complete', 'unattributed']) {
    const status = scenario === 'review' ? 'review' : 'active';
    const mission = fixtureMission('task-checkpoint-disposable', { status });
    const numbers = scenario === 'sparse' ? [2, 5, 9] : [1, 2, 3];
    const checkpoints = numbers.map((number, index) => ({
      missionId: mission.id, name: `CP-${number}`, firstLine: `Step ${number}`,
      goalCheck: scenario === 'complete' || (scenario !== 'first-start' && index === 0)
        ? [{ criterion: 'Fixture checked', evidence: 'Disposable browser observation' }] : [],
      nextActionText: scenario === 'first-start' ? '' : 'Continue the recorded plan',
    }));
    const phase = scenario === 'repair' ? 'review-response' : scenario === 'review' ? 'review' : scenario === 'gate' ? 'gate' : 'execute';
    const summary = `Fixture ${scenario} activity`;
    const card = projectMissionCard({ ...mission, checkpoints }, {
      latestGate: 'unavailable', reviewApproval: null, flags: [], blockingReason: null,
      currentWork: scenario === 'complete' ? null : { operationId: 'fixture-work', phase, summary,
        agent: null, updatedAt: new Date().toISOString(), freshness: scenario === 'unattributed' ? 'unverified' : 'live' },
    });
    await fixture.render(toWebBoardSnapshot(makeProjection({ [status]: [card] })));
    const article = fixture.page.locator(`[data-board-card="${card.id}"]`);
    const text = await article.textContent() ?? '';
    const recordedNumber = scenario === 'complete' ? numbers.at(-1)! : numbers[0];
    const pips = article.locator('[aria-label="Checkpoint plan"] > span');
    const states = await pips.evaluateAll(elements => elements.map(element => ({
      name: element.getAttribute('aria-label'), state: element.getAttribute('data-checkpoint-state'),
      color: getComputedStyle(element).backgroundColor, blinking: element.classList.contains('review-pip--running'),
    })));
    assert.deepEqual(states.map(pip => pip.state), scenario === 'complete' ? ['completed', 'completed', 'completed']
      : scenario === 'first-start' ? ['current', 'future', 'future']
        : scenario === 'review' ? ['completed', 'future', 'future'] : ['completed', 'current', 'future']);
    assert.equal(states.some(pip => pip.blinking), scenario !== 'complete' && scenario !== 'review');
    assert.equal(card.currentCheckpoint, scenario === 'complete' || scenario === 'review' ? null : `CP-${numbers[scenario === 'first-start' ? 0 : 1]}`);
    if (card.currentCheckpoint) { assert.ok(text.includes(`current: ${card.currentCheckpoint}`)); }
    if (scenario !== 'complete') { assert.ok(text.includes(summary)); }
    if (scenario !== 'first-start') {
      assert.ok(text.includes(`last recorded: CP-${recordedNumber}`));
      assert.ok(text.includes(`recorded guidance (CP-${recordedNumber}):`));
      await article.getByRole('button', { name: /View checkpoint evidence/ }).click();
      const dialog = fixture.page.getByRole('dialog', { name: /Checkpoint evidence/ });
      assert.ok((await dialog.textContent())?.includes('Last recorded Goal Check evidence'));
      assert.ok((await dialog.textContent())?.includes(`Step ${recordedNumber}`));
      await fixture.page.keyboard.press('Escape');
    } else { assert.ok(!text.includes('last recorded:')); }
    console.log(JSON.stringify({ scenario, label: card.checkpoint, activity: card.currentWork?.summary ?? null, states }));
  }
  assert.equal(fixture.requests.length, 0);
  console.log('PASS: eight isolated board scenarios, evidence dialogs reachable, zero command writes');
} finally { await fixture.close(); }
