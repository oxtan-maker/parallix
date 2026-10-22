// Mission identity and optional facts rendered through the validated production Board.
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Board } from '../../../../web/src/board.js';
import type { MissionCard } from '../../../../src/application/projections/mission-board.js';
import { toWebBoardSnapshot, validateWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import { makeCard, makeFullCard, makeProjection } from '../../../fixtures/board-projection.js';

// TASK-2784: retired card facts belong to the production Board, after wire validation.
function renderedCard(card: MissionCard): string {
  const wire = JSON.parse(JSON.stringify(toWebBoardSnapshot(makeProjection({ [card.lane]: [card] }))));
  const validation = validateWebBoardSnapshot(wire);
  assert.ok(validation.ok);
  const article = renderToStaticMarkup(React.createElement(Board, { snapshot: validation.value, onRefresh: async () => {} })).match(/<article\b[^>]*data-board-card="[^"]*"[\s\S]*?<\/article>/)?.[0];
  assert.ok(article);
  return article;
}

test('Board preserves populated mission identity, supplied PR URL and review phase (TASK-2784)', () => {
  const card = makeFullCard({ reviewRound: 2, reviewPhase: 'fixing', reviewDisposition: 'REQUEST_CHANGES' });
  const html = renderedCard(card);
  assert.ok(html.includes(card.id));
  assert.ok(html.includes(card.title));
  assert.match(html, /Recorded: CP-2\.md/);
  assert.match(html, /gate ✓<\/div>/);
  assert.match(html, /<a href="https:\/\/example\.invalid\/pr\/42"[^>]*>PR #42<\/a>/);
  assert.match(html, /aria-label="Review attempts"/, 'the review budget renders as a named group');
  assert.match(html, /data-review-attempt="2"[^>]*data-review-state="changes-requested"/,
    'the supplied round and its recorded disposition survive wire validation');
});

test('Board leaves absent checkpoint, PR and review facts unknown (TASK-2784)', () => {
  const html = renderedCard(makeCard({ gate: 'unavailable' }));
  assert.match(html, /Plan unavailable · Completion unknown/);
  assert.match(html, /gate · unavailable/);
  assert.doesNotMatch(html, /Recorded:|PR #|review round \d|round \d\/5/);
  assert.doesNotMatch(html, /<a\b[^>]*>PR /);
});

test('Board identifies a PR with null URL without inventing a PR anchor (TASK-2784)', () => {
  const card = makeFullCard();
  assert.ok(card.pullRequest);
  const html = renderedCard({ ...card, pullRequest: { ...card.pullRequest, id: '77', url: null } });
  assert.match(html, /<span[^>]*>PR #77<\/span>/);
  assert.doesNotMatch(html, /<a\b[^>]*>PR /);
  assert.doesNotMatch(html, /href="[^"]*(?:77|pull|pr\/)/);
});

