import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { makeCard, makeProjection } from './fixtures/board-projection.js';

async function renderShell(props: Record<string, unknown>): Promise<string> {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');
  return ink.renderToString(React.createElement(BoardShell, props as never), { columns: 120 });
}

test('component: selected mission has an explicit focused marker in wide and narrow board layouts', async () => {
  const projection = makeProjection({ active: [makeCard({ id: 'task-focus' as never, lane: 'active' })] });
  for (const columns of [120, 60]) {
    const output = await renderShell({ projection, columns, rows: 30, initialSelectedMissionId: 'task-focus' });
    assert.match(output, /▶.*task-focus/, `selected card needs a focused marker at ${columns} columns: ${output}`);
  }
});

test('component: selected mission detail renders the shared projection and stale source is explicit', async () => {
  const projection = makeProjection({ active: [makeCard({ id: 'task-detail' as never, lane: 'active' })] });
  const detail = { id: 'task-detail', checkpoints: [{ name: 'CP-1', nextActionText: 'verify' }], review: null, netEngineeringLines: 4, completedStatistics: null };
  const current = await renderShell({ projection, missionDetails: new Map([['task-detail', detail]]), initialSelectedMissionId: 'task-detail' });
  assert.match(current, /MISSION DETAIL · task-detail/);
  assert.match(current, /checkpoints: 1/);

  const stale = { ...projection, sourceFacts: [{ source: 'task-markdown', status: 'stale', value: 'fixture' }] };
  const staleOutput = await renderShell({ projection: stale, missionDetails: new Map([['task-detail', detail]]), initialSelectedMissionId: 'task-detail' });
  assert.match(staleOutput, /detail unavailable: source is stale/);
});

test('component: absent selected mission detail is explicitly unavailable', async () => {
  const projection = makeProjection({ active: [makeCard({ id: 'task-missing-detail' as never, lane: 'active' })] });
  const output = await renderShell({ projection, initialSelectedMissionId: 'task-missing-detail' });
  assert.match(output, /detail unavailable: no projection for selection/);
});

test('component: keyboard help is visible on demand and ordinary keys have no workflow action', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');
  class Stream extends EventEmitter {
    public columns = 120;
    public rows = 30;
    public readonly isTTY = true;
    public readonly writes: string[] = [];
    private readonly input: string[] = [];
    write(value: string): boolean { this.writes.push(value); return true; }
    setRawMode(_enabled: boolean): void {}
    setEncoding(_encoding: string): void {}
    resume(): void {}
    ref(): void {}
    unref(): void {}
    read(): string | null { return this.input.shift() ?? null; }
    send(value: string): void { this.input.push(value); this.emit('readable'); }
  }
  const projection = makeProjection({ active: [makeCard({ id: 'task-reserved' as never, lane: 'active' })] });
  for (const key of ['?', 'a', 'r', 'c', '\r'] as const) {
    const stdin = new Stream();
    const stdout = new Stream();
    const instance = ink.render(React.createElement(BoardShell, { projection } as never), {
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
      exitOnCtrlC: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 35));
    stdin.send(key);
    await new Promise((resolve) => setTimeout(resolve, 35));
    instance.unmount();
    const output = stdout.writes.join('');
    if (key === '?') {
      assert.match(output, /\?: hide help/, 'question mark must show the keyboard reference');
    } else {
      assert.doesNotMatch(output, /not yet available|approve|run workflow|cancel workflow/, `${key} must not trigger a workflow action`);
    }
  }
});

test('component: arrows and WASD map to navigation, excluding modified letter input', async () => {
  const { navigationKeyForInput } = await import('../src/interfaces/tui/shell.js');
  const noKey = { upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, ctrl: false, meta: false };
  assert.equal(navigationKeyForInput('', { ...noKey, downArrow: true }), 'down');
  assert.equal(navigationKeyForInput('w', noKey), 'up');
  assert.equal(navigationKeyForInput('a', noKey), 'left');
  assert.equal(navigationKeyForInput('s', noKey), 'down');
  assert.equal(navigationKeyForInput('d', noKey), 'right');
  assert.equal(navigationKeyForInput('s', { ...noKey, ctrl: true }), undefined);
});
