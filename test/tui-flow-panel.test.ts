import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetrics } from '../src/application/projections/metrics.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';

const id = missionId('task-flow');
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const plain = (value: string): string => value.replace(ANSI, '');

function populatedMetrics() {
  return buildMetrics({
    initialStates: new Map([[id, 'active']]),
    transitions: [
      { missionId: id, from: 'backlog', to: 'active', trigger: 'activate', actor: 'codex', occurredAt: '2026-07-22T08:00:00Z' },
      { missionId: id, from: 'active', to: 'review', trigger: 'submit-for-review', actor: 'codex', occurredAt: '2026-07-22T10:00:00Z' },
    ],
    outcomes: [{ missionId: id, repositoryId: 'test' as never, createdAt: '2026-07-21T00:00:00Z', closedAt: '2026-07-21T00:00:00Z', cycleTimeMinutes: 50, reviewFixRounds: 2, runs: [] }],
    instants: ['2026-07-22T12:00:00Z'],
    asOf: '2026-07-22T12:00:00Z',
    agentAvailability: [
      { family: agentFamily('codex'), available: true, blockedForMs: 0 },
      { family: agentFamily('claude'), available: false, blockedForMs: Infinity },
    ],
  });
}

class FakeStdout extends EventEmitter {
  public readonly isTTY = true;
  public readonly writes: string[] = [];
  constructor(public columns: number, public rows: number) { super(); }
  write(chunk: string): boolean { this.writes.push(chunk); return true; }
  resize(columns: number): void { this.columns = columns; this.emit('resize'); }
  lastFrame(): string {
    for (let index = this.writes.length - 1; index >= 0; index -= 1) {
      const frame = plain(this.writes[index] ?? '');
      if (frame.trim().length > 0) { return frame; }
    }
    return '';
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('FLOW panel renders projection labels, values, unavailable agent, and bottleneck sentence', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { FlowPanel } = await import('../src/interfaces/tui/flow-panel.js');
  const output = plain(ink.renderToString(React.createElement(FlowPanel, { metrics: populatedMetrics(), columns: 120 }), { columns: 120 }));

  for (const expected of [
    'FLOW', 'CUMULATIVE FLOW', 'Legend', 'Median cycle time', 'Median lane age',
    'Weekly completions: 1', 'Review-to-active loop rate: 2', 'codex available',
    'claude unavailable',
  ]) {
    assert.ok(output.includes(expected), `FLOW panel must display ${expected}. Got: ${output}`);
  }
  assert.match(output, /review is the oldest lane at 120 min median age;/, `FLOW panel must display the bottleneck lead. Got: ${output}`);
  assert.match(output, /loop 2\.0; 1 completed in the latest recorded week\./, `FLOW panel must display the bottleneck detail. Got: ${output}`);
});

test('FLOW panel states every fallback and survives a zero-history projection', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { FlowPanel } = await import('../src/interfaces/tui/flow-panel.js');
  const metrics = buildMetrics({ initialStates: new Map(), transitions: [], outcomes: [], instants: ['2026-07-22T12:00:00Z'] });
  const output = plain(ink.renderToString(React.createElement(FlowPanel, { metrics, columns: 60 }), { columns: 60 }));

  for (const expected of ['Cumulative flow history: estimate', 'Median cycle time history: null', 'Median lane age history: null', 'Weekly completions history: skip', 'Review-to-active loop rate history: estimate', 'Bottleneck unavailable: history is missing.']) {
    assert.ok(output.includes(expected), `Zero-history FLOW panel must display ${expected}. Got: ${output}`);
  }
});

test('FLOW panel visibly labels unavailable and partial health and places sample size beside rates and medians', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { FlowPanel } = await import('../src/interfaces/tui/flow-panel.js');
  const base = populatedMetrics();
  const unavailable = { ...base, health: { state: 'unavailable' as const }, provenance: { ...base.provenance, sampleSize: 3, adapterSucceeded: false } };
  const partial = { ...base, health: { state: 'partial' as const }, provenance: { ...base.provenance, sampleSize: 3 } };

  const unavailableOutput = plain(ink.renderToString(React.createElement(FlowPanel, { metrics: unavailable, columns: 240 }), { columns: 240 }));
  const partialOutput = plain(ink.renderToString(React.createElement(FlowPanel, { metrics: partial, columns: 240 }), { columns: 240 }));

  assert.match(unavailableOutput, /Statistics: unavailable · n=3/);
  assert.match(partialOutput, /Statistics: partial · n=3/);
  assert.match(partialOutput, /Weekly completions: 1 \(n=3\)/);
  assert.match(partialOutput, /Review-to-active loop rate: 2 \(n=3\)/);
  assert.match(partialOutput, /review: 120 min \(n=3\)/);
});

test('FLOW panel switches to textual layout at narrow width and after a resize', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { FlowPanel } = await import('../src/interfaces/tui/flow-panel.js');
  const stdout = new FakeStdout(120, 40);
  const instance = ink.render(React.createElement(FlowPanel, { metrics: populatedMetrics() }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  await delay(50);
  assert.doesNotMatch(stdout.lastFrame(), /FLOW · textual/, 'Wide FLOW layout must not claim textual mode');

  stdout.resize(60);
  await delay(80);
  const output = stdout.lastFrame();
  instance.unmount();
  assert.match(output, /FLOW · textual/, `Resized FLOW layout must expose textual mode. Got: ${output}`);
  assert.match(output, /Weekly completions: 1/, `Textual FLOW layout must retain its value. Got: ${output}`);
  assert.match(output, /Median lane age/, `Textual FLOW layout must retain its label. Got: ${output}`);
});
