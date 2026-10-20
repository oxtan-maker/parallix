import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as fs from 'node:fs';
import { Board } from '../../../../web/src/board.js';
import type { MissionCard } from '../../../../src/application/projections/mission-board.js';
import { missionId as fixtureMissionId } from '../../../../src/domain/mission.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { toWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import type { WebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import type { BoardProjection } from '../../../../src/application/projections/board.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';
const snapshotOf = (overrides: Partial<BoardProjection>) => toWebBoardSnapshot({ ...makeProjection(), ...overrides });
const render = (snapshot: WebBoardSnapshot) => renderToStaticMarkup(React.createElement(Board, { snapshot, onRefresh: async () => {} }));
const browserSources = fs.readdirSync('web/src').filter(name => /\.(?:ts|tsx|css)$/.test(name)).map(name => ({ name, text: fs.readFileSync(`web/src/${name}`, 'utf8') }));
const refinementExecution = (family: string | null, complete = true): MissionCard['execution'] => ({
  observedAt: '2026-10-18T10:00:00Z', complete, limitations: complete ? [] : ['Provider execution could not be observed'],
  invocations: family === null ? [] : [{ runId: `draft-${family}-a1-test`, operationId: 'op-draft', family: agentFamily(family) }],
});
const refinementCard = (overrides: Partial<MissionCard>): MissionCard => makeCard({
  id: fixtureMissionId('task-refine') as MissionCard['id'], lane: 'backlog', status: 'backlog', agent: agentFamily('codex'), ...overrides,
});
const refinementWork = (overrides: Partial<NonNullable<MissionCard['currentWork']>> = {}): MissionCard['currentWork'] => ({
  operationId: 'op-draft', phase: 'draft', summary: 'refining acceptance criteria', agent: agentFamily('claude'),
  updatedAt: '2026-10-18T10:00:00.000Z', freshness: 'live', ...overrides,
});
const renderRefinement = (card: MissionCard): string => render(snapshotOf({ stages: makeProjection({ backlog: [card] }).stages }));

const intakeFan = (html: string): string => html.match(/class="fan[^"]*" style="[^"]*"/)?.[0] ?? '';
const headerOf = (html: string): string => {
  const start = html.indexOf('<article');
  return html.slice(start, html.indexOf('<p', start));
};

test('a refinement card shows the observed executing worker and published summary, not the assignee (TASK-2774)', () => {
  const html = renderRefinement(refinementCard({ currentWork: refinementWork(), execution: refinementExecution('claude') }));
  assert.match(html, /refining acceptance criteria/, 'the published work summary is visible');
  assert.match(html, /title="active worker family: claude"/, 'the header names the observed provider family');
  assert.match(intakeFan(html), /#d97757/, 'the fan takes the executing claude accent, not the codex assignee');
  assert.doesNotMatch(html, /codex/, 'assignment alone is never shown as the worker');
});

test('refinement cards keep preparing, handover, completion and blocked states distinct from execution (TASK-2774)', () => {
  const coordinator = { missionId: fixtureMissionId('task-refine') as MissionCard['id'], family: agentFamily('claude') };
  const preparing = renderRefinement(refinementCard({ currentWork: refinementWork({ summary: 'preparing draft context', agent: null }), execution: refinementExecution(null), liveSession: coordinator }));
  assert.match(preparing, /preparing draft context/);
  assert.doesNotMatch(preparing, /title="active worker|title="implementer/, 'a live coordinator and the assignee never name the worker');
  assert.doesNotMatch(intakeFan(preparing), /#d97757|#19b48c/, 'a live coordinator and the assignee never colour the worker fan');
  const handover = renderRefinement(refinementCard({ currentWork: refinementWork({ summary: 'handing over to reviewer' }), execution: refinementExecution(null), liveSession: coordinator }));
  assert.match(handover, /handing over to reviewer/);
  assert.doesNotMatch(handover, /title="active worker/, 'the previously published worker is not shown as executing');
  const completed = renderRefinement(refinementCard({ currentWork: null, execution: refinementExecution(null) }));
  assert.match(completed, /title="implementer family: codex"/, 'an idle card names its assignee as implementer in the header, as a flight card does');
  assert.doesNotMatch(completed, /no work observed|active worker|executing|execution unknown|data-provider-execution|working ·|>idle</, 'an idle intake card keeps its compact layout');
  assert.doesNotMatch(completed, /fan spin/);
  const blocked = renderRefinement(refinementCard({ blockingReason: 'draft needs operator answer', execution: refinementExecution(null) }));
  assert.match(blocked, /draft needs operator answer/);
  assert.match(blocked, /title="implementer family: codex"/, 'a blocked card names its assignee as implementer in the header, as a flight card does');
  assert.doesNotMatch(blocked, /fan spin|executing|title="active worker/);
});

test('refinement cards keep missing, stale and incomplete execution evidence uncertain (TASK-2774)', () => {
  const missing = renderRefinement(refinementCard({ currentWork: refinementWork(), execution: undefined }));
  assert.match(missing, /refining acceptance criteria/);
  assert.doesNotMatch(missing, /title="active worker|title="implementer|executing|execution unknown|codex/, 'no observation never prints a worker or a zero');
  assert.doesNotMatch(intakeFan(missing), /#d97757|#19b48c/);
  const stale = renderRefinement(refinementCard({ currentWork: refinementWork({ freshness: 'stale' }), execution: refinementExecution(null, false) }));
  assert.match(stale, /refining acceptance criteria/, 'the stale publication stays visible while no worker is claimed');
  assert.match(headerOf(stale), /class="fan"[^>]*#3f4a53/, 'a stale card colours no family and spins no fan');
  assert.doesNotMatch(stale, /title="active worker|0 executing|execution unknown|fan spin|working · /, 'an unreadable probe names no worker, never becomes a confirmed zero and prints no work badge');
  const incomplete = renderRefinement(refinementCard({ currentWork: refinementWork(), execution: refinementExecution('claude', false) }));
  assert.match(incomplete, /title="active worker family: claude"/, 'an incomplete probe still names the invocation it did observe');
  assert.doesNotMatch(incomplete, /1\+|executing|execution unknown/, 'the card states no count the probe could not confirm');
  for (const lane of ['backlog', 'refined'] as const) {
    const html = render(snapshotOf({ stages: makeProjection({ [lane]: [refinementCard({ lane, status: lane, currentWork: refinementWork(), execution: refinementExecution('claude') })] }).stages }));
    assert.match(html, /title="active worker family: claude"/, `${lane} intake cards name the executing worker`);
  }
});

test('refinement cards reuse the card design elements instead of a bespoke activity line (TASK-2774)', () => {
  assert.deepEqual(browserSources.filter((file) => /=\s*actorLine\(card\)/.test(file.text)).map((file) => file.name),
    ['card-activity.tsx'], 'one card element prints the published activity for every card design');
  assert.deepEqual(browserSources.filter((file) => /'active worker'/.test(file.text)).map((file) => file.name),
    ['card-activity.tsx'], 'one card element prints the worker identity for every card design');
  assert.deepEqual(browserSources.filter((file) => /data-provider-execution/.test(file.text)).map((file) => file.name),
    [], 'no card adds the execution count row the card design removed (px-0013)');
  for (const name of ['intake-column.tsx', 'flight-column.tsx']) {
    const text = browserSources.find((file) => file.name === name)!.text;
    assert.match(text, /<AgentLabel agent=\{(?:worker|agent)\}/, `${name} renders the shared worker label`);
    assert.match(text, /<ActorLine card=\{card\}/, `${name} renders the shared actor line`);
  }
  assert.deepEqual(browserSources.filter((file) => /workText|working · /.test(file.text)).map((file) => file.name),
    [], 'no card prints a work certainty badge; the other columns never did (TASK-2687)');
  const workerLabel = (markup: string): string | undefined => {
    const match = markup.match(/<span title="([^"]* family: [^"]*)"[^>]*>([^<]*)<\/span>/);
    return match ? `${match[1]} = ${match[2]}` : undefined;
  };
  const intake = renderRefinement(refinementCard({ currentWork: refinementWork(), execution: refinementExecution('claude') }));
  const flight = render(snapshotOf({ stages: makeProjection({ active: [refinementCard({ lane: 'active', status: 'active', currentWork: refinementWork(), execution: refinementExecution('claude') })] }).stages }));
  assert.ok(workerLabel(intake), 'the intake card states the worker in the design element, not in prose');
  assert.equal(workerLabel(intake), workerLabel(flight), 'an intake card states the worker exactly as a flight card does');
  assert.doesNotMatch(intake, /refining acceptance criteria[^<]*claude/, 'the published summary and the worker identity stay separate elements');
  const intakeHeader = headerOf(intake);
  const flightHeader = headerOf(flight);
  assert.match(intakeHeader, /title="active worker family: claude"/, 'the intake header carries the worker label where every other column carries it');
  assert.equal(workerLabel(intakeHeader), workerLabel(flightHeader), 'the label sits in the header, not beside the activity line');
  assert.match(intakeHeader, /family: claude"[^>]*>claude<\/span><\/div>$/, 'the label ends the header row, as it does on a flight card');
  assert.doesNotMatch(intakeHeader, /working ·|>idle<|>blocked<|●/, 'an intake header omits the work badge every flight lane omits (TASK-2687)');
  assert.doesNotMatch(intake, /working · (?:live|unknown|stale)/, 'an intake card prints no work certainty badge');
});
