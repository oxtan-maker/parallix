import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoardShell } from '../src/interfaces/tui/shell.js';
import { toWebBoardSnapshot } from '../src/interfaces/web/transport.js';
import { TopBar } from '../web/src/top-bar.js';
import { makeCards, makeProjection } from './fixtures/board-projection.js';

function renderedWip(text: string): number {
  const renderedText = text.replace(/<[^>]+>/g, '');
  const match = renderedText.match(/wip\s+(\d+)/);
  assert.ok(match, `expected a WIP total in rendered output: ${text}`);
  return Number(match[1]);
}

test('TUI and web top bars share the in-flight WIP total', async () => {
  const integration = makeCards(1, 'integration');
  integration[0] = { ...integration[0], status: 'integration', rawStatus: 'approved' };
  const projection = makeProjection({
    backlog: makeCards(2, 'backlog'),
    refined: makeCards(1, 'refined'),
    active: makeCards(1, 'active'),
    review: makeCards(1, 'review'),
    integration,
    done: makeCards(2, 'done'),
  });
  const { renderToString } = await import('ink');
  const tuiWip = renderedWip(renderToString(React.createElement(BoardShell, { projection, columns: 120, rows: 30 })));
  const webWip = renderedWip(renderToStaticMarkup(React.createElement(TopBar, {
    snapshot: toWebBoardSnapshot(projection), flowOpen: false, onFlowToggle: () => {},
  })));

  assert.equal(tuiWip, 4, 'the eight-card board has four in-flight missions');
  assert.equal(tuiWip, webWip, 'both operator surfaces report the same WIP total');
});
