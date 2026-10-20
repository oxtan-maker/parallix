import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperationLog, EMPTY_LIVE_PROGRESS, OPERATION_LOG_LIMIT, recordProgress } from '../../../../web/src/operation-log.js';
import { toWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import { makeProjection } from '../../../fixtures/board-projection.js';
const renderLog = (timestamp: string, phase = 'checkpoint', message = phase, agent?: string) => {
  const snapshot = toWebBoardSnapshot(makeProjection());
  const entry = { operationId: 'op-original', sequence: 7, timestamp, phase, message, ...(agent === undefined ? {} : { agent }) };
  const before = JSON.stringify(entry);
  const html = renderToStaticMarkup(React.createElement(OperationLog, { snapshot: { ...snapshot, operationLog: [entry] } }));
  assert.equal(JSON.stringify(entry), before, 'display leaves source time and identity untouched');
  return html;
};
test('operation progress deduplicates reconnects and evicts oldest entries', () => {
  const progress = { kind: 'progress' as const, transportVersion: 2 as const, operationId: 'op-reconnect', sequence: 1, phase: 'run', message: 'one', timestamp: '2026-08-30T11:00:00.000Z' } satisfies Partial<NonNullable<Parameters<typeof recordProgress>[1]>>;
  const once = recordProgress(EMPTY_LIVE_PROGRESS, progress);
  assert.equal(recordProgress(once, progress).entries.length, once.entries.length);
  let bounded = once;
  for (let sequence = 2; sequence <= OPERATION_LOG_LIMIT + 2; sequence += 1) bounded = recordProgress(bounded, { ...progress, sequence });
  assert.equal(bounded.entries.length, OPERATION_LOG_LIMIT);
  assert.equal(bounded.entries.at(-1)?.sequence, OPERATION_LOG_LIMIT + 2);
});


for (const [zone, source, expected, date] of [
  ['UTC', '2026-01-01T00:02:03Z', '00:02:03', '1 January 2026'],
  ['America/New_York', '2026-01-01T00:02:03Z', '19:02:03', '31 December 2025'],
  ['Europe/Stockholm', '2026-03-29T00:59:59Z', '01:59:59', '29 March 2026'],
  ['Europe/Stockholm', '2026-03-29T01:00:00Z', '03:00:00', '29 March 2026'],
  ['Europe/Stockholm', '2026-10-25T00:59:59Z', '02:59:59', '25 October 2026'],
  ['Europe/Stockholm', '2026-10-25T01:00:00Z', '02:00:00', '25 October 2026'],
  ['Asia/Kolkata', '2026-01-01T23:02:03+00:00', '04:32:03', '2 January 2026'],
]) {
  test(`operation timestamp local detail ${zone}/${source} (TASK-2773.10)`, context => {
    const OriginalFormatter = Intl.DateTimeFormat;
    context.mock.method(Intl, 'DateTimeFormat', function (...[locales, options]: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      return new OriginalFormatter(locales, { ...options, timeZone: zone });
    });
    try {
      const html = renderLog(source);
      assert.ok(html.includes(`>${expected}</summary>`));
      assert.ok(html.includes(date));
      assert.ok(html.includes(Intl.DateTimeFormat().resolvedOptions().timeZone));
      assert.ok(html.includes(source));
      assert.ok(html.includes(`<summary aria-label="${expected} — full timestamp details"`));
      assert.match(html, /<details[^>]*><summary[^>]*>.*<\/summary><span>/);
    } finally { context.mock.restoreAll(); }
  });
}
for (const source of ['', 'not-a-time', '2026-01-01', '2026-01-01T10:00:00', '2026-99-99T00:00:00Z', '2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z', '   ']) {
  test(`operation timestamp honest fallback ${JSON.stringify(source)} (TASK-2773.10)`, () => {
    const html = renderLog(source);
    assert.match(html, />Time unavailable<\/summary>/);
    assert.ok(html.includes(source || 'No timestamp supplied'));
    assert.doesNotMatch(html, /Invalid Date|NaN/);
  });
}
test('operation rows suppress only exact duplicate text and retain attribution (TASK-2773.10)', () => {
  const same = renderLog('', 'checkpoint', 'checkpoint', 'codex');
  assert.equal(same.split('checkpoint').length - 1, 1);
  assert.match(same, /\(codex\)/);
  const distinct = renderLog('', 'checkpoint', 'CP-2 committed', 'claude');
  assert.match(distinct, /checkpoint  CP-2 committed  \(claude\)/);
  assert.match(renderLog('', 'Run', 'run'), /Run  run/);
  assert.match(renderLog('', 'run', 'run '), /run  run /);
});
