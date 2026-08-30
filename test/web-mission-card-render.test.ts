import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MissionCardView } from '../web/src/mission-card.js';
import {
  toWebBoardSnapshot,
  validateWebBoardSnapshot,
} from '../src/interfaces/web/transport.js';
import { makeCard, makeFullCard, makeProjection } from './fixtures/board-projection.js';
import { agentFamily } from '../src/domain/agents.js';
import type { MissionCard, ReviewRoundSummary } from '../src/application/projections/mission-board.js';
import type { WebMissionCard } from '../src/interfaces/web/transport.js';

/**
 * DOM-free render tests for the presentational web card: the component is
 * rendered via `react-dom/server` `renderToString` from a validated, JSON
 * round-tripped wire card and must show only the received facts.
 */

const history: readonly ReviewRoundSummary[] = [
  {
    number: 1,
    reviewer: agentFamily('codex'),
    implementer: agentFamily('custom'),
    phase: 'fixing',
    disposition: 'REQUEST_CHANGES',
    comment: 'Two findings.',
    findingSummaries: ['transport.ts: review fields unvalidated'],
    pushbacks: [],
    fixes: [],
  },
  {
    number: 2,
    reviewer: agentFamily('claude'),
    implementer: agentFamily('custom'),
    phase: 'reviewing',
    disposition: null,
    comment: null,
    findingSummaries: ['web card omits the PR link'],
    pushbacks: ['F-2: url is null for a local review surface'],
    fixes: ['F-1: projected pullRequest one-to-one'],
  },
];

/** Validate a JSON round-tripped snapshot and return the wire card for `card.id`. */
function wireCard(card: MissionCard): WebMissionCard {
  const snapshot = toWebBoardSnapshot(makeProjection({ [card.lane]: [card] }));
  const validation = validateWebBoardSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.equal(validation.ok, true, 'the projected snapshot must validate');
  if (!validation.ok) { throw new Error('unreachable'); }
  const wire = validation.value.stages
    .flatMap((stage) => stage.cards)
    .find((c) => c.id === card.id);
  assert.ok(wire !== undefined, `wire card for ${card.id} must exist`);
  return wire;
}

test('web card renders received checkpoint, PR link, and review round from the wire DTO', () => {
  const card = wireCard(makeFullCard({
    reviewRound: 2,
    reviewPhase: 'fixing',
    reviewHistory: history,
  }));

  const html = renderToString(createElement(MissionCardView, { card }));

  assert.ok(html.includes('Checkpoint CP-2 (gate passed)'), `expected the received checkpoint label with .md stripped and gate state, got: ${html}`);
  // renderToString inserts <!-- --> comment nodes between text segments; strip them before comparing.
  const anchor = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/)?.[0] ?? '';
  assert.ok(anchor.includes('href="https://example.invalid/pr/42"'), `expected an anchor with the received pullRequest.url, got: ${html}`);
  assert.ok(anchor.replace(/<!--[\s\S]*?-->/g, '').includes('PR #42'), `expected the PR id as anchor text, got: ${anchor}`);
  assert.ok(html.includes('Review round 2 · fixing'), `expected the received review round and phase, got: ${html}`);
});

test('web card renders explicit unavailable text and no anchor when the new facts are absent', () => {
  const card = wireCard(makeCard()); // checkpoint null, pullRequest null, reviewRound/reviewPhase null

  const html = renderToString(createElement(MissionCardView, { card }));

  assert.ok(html.includes('Checkpoint unavailable'), `expected explicit unavailable checkpoint text, got: ${html}`);
  assert.ok(html.includes('Pull request unavailable'), `expected explicit unavailable PR text, got: ${html}`);
  assert.ok(html.includes('Review round unavailable'), `expected explicit unavailable meter text, got: ${html}`);
  assert.ok(!/<a[\s>]/.test(html), `absent-facts card must not contain an anchor element, got: ${html}`);
  assert.ok(!/Review round \d/.test(html), `absent-facts card must not fabricate a round number, got: ${html}`);
});

test('web card shows the PR id as plain text when the reference has a null url', () => {
  const card = wireCard(makeFullCard({
    pullRequest: {
      kind: 'pull-request',
      provider: 'forgejo',
      id: '77',
      url: null,
      sourceBranch: 'mission/task-1234',
      targetBranch: 'main',
    },
  }));

  const html = renderToString(createElement(MissionCardView, { card }));

  assert.ok(html.includes('PR #77 (no link)'), `expected the plain PR id without a link, got: ${html}`);
  assert.ok(!/<a[\s>]/.test(html), `a null url must not produce an anchor element, got: ${html}`);
});
