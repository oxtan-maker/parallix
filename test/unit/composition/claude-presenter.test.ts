import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { runClaudeStreamPresenter } from '../../../src/composition/claude-presenter.js';

// Owns the private presenter entry wiring: stdin chunks reach the render sink and stdin end closes it.
test('presenter forwards stdin chunks to stdout and closes on end (TASK-2735)', () => {
  const handlers = new Map<string, (_chunk?: unknown) => void>();
  const written: string[] = [];
  mock.method(process.stdin, 'on', ((event: string, handler: (_chunk?: unknown) => void) => { handlers.set(event, handler); return process.stdin; }) as never);
  mock.method(process.stdin, 'once', ((event: string, handler: () => void) => { handlers.set(event, handler); return process.stdin; }) as never);
  mock.method(process.stdout, 'write', ((chunk: string) => { written.push(String(chunk)); return true; }) as never);
  try {
    runClaudeStreamPresenter(resolveConfiguration({ PARALLIX_CLAUDE_RAW_STREAM: '1' }));
    handlers.get('data')!('hello');
    handlers.get('end')!();
  } finally {
    mock.restoreAll();
  }
  assert.deepEqual(written, ['hello']);
});
