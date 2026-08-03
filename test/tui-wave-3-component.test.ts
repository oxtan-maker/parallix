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
    // Card renders ▶ gutter marker for the selected card.
    assert.match(output, /▶/, `selected card needs a focused marker (▶) at ${columns} columns`);
    // Card title 'Test task-9999' is rendered below the slug line.
    // At narrow lane widths the title may be truncated to 'Test task-9…'.
    assert.ok(
      output.includes('Test task-9999') || output.includes('Test task-9'),
      `card title must be visible at ${columns} columns`,
    );
  }
});

test('component: selected mission focus marker is present and board renders without detail panel', async () => {
  // MissionDetailPanel was removed (not in design). The shell renders board + command log only.
  const projection = makeProjection({ active: [makeCard({ id: 'task-detail' as never, lane: 'active' })] });
  const output = await renderShell({ projection, initialSelectedMissionId: 'task-detail' });
  assert.match(output, /▶.*task-detail/, 'selected card has focus marker');
  assert.doesNotMatch(output, /MISSION DETAIL/, 'no detail panel in design');
  assert.doesNotMatch(output, /detail unavailable/, 'no detail unavailable message');
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
      assert.doesNotMatch(output, /CONFIRM CONSEQUENTIAL ACTION|COMPLETED:|CANCELLED:/,
        `${key} must not trigger a guarded workflow dispatch`);
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
