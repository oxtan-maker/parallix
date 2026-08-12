import { EventEmitter } from 'node:events';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetrics } from '../src/application/projections/metrics.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';
import { missionOutcome } from './fixtures/mission-outcome.js';

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
    outcomes: [missionOutcome({ missionId: id, createdAt: '2026-07-21T00:00:00Z', closedAt: '2026-07-21T00:00:00Z', cycleTimeMinutes: 50, reviewFixRounds: 2 })],
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
    'Weekly completions: 1 (n=1)', 'Lifecycle review-bounce rate: 0 (n=1)', 'codex available',
    'claude unavailable',
  ]) {
    assert.ok(output.includes(expected), `FLOW panel must display ${expected}. Got: ${output}`);
  }
  assert.match(output, /review is the oldest lane at 2\.0h median age;/, `FLOW panel must display the bottleneck lead. Got: ${output}`);
  assert.match(output, /bounce 0\.0; 1 completed in the current reporting week\./, `FLOW panel must display the bottleneck detail. Got: ${output}`);
});

test('FLOW panel states every fallback and survives a zero-history projection', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { FlowPanel } = await import('../src/interfaces/tui/flow-panel.js');
  const metrics = buildMetrics({ initialStates: new Map(), transitions: [], outcomes: [], instants: ['2026-07-22T12:00:00Z'] });
  const output = plain(ink.renderToString(React.createElement(FlowPanel, { metrics, columns: 60 }), { columns: 60 }));

  for (const expected of ['Cumulative flow history: estimate', 'Median cycle time history: null', 'Median lane age history: null', 'Weekly completions history: skip', 'Lifecycle review-bounce rate history: estimate', 'Bottleneck unavailable: history is missing.']) {
    assert.ok(output.includes(expected), `Zero-history FLOW panel must display ${expected}. Got: ${output}`);
  }
});

test('FLOW panel visibly labels unavailable and partial health without treating population as metric coverage', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { FlowPanel } = await import('../src/interfaces/tui/flow-panel.js');
  const base = populatedMetrics();
  const unavailable = { ...base, health: { state: 'unavailable' as const }, provenance: { ...base.provenance, sampleSize: 3, adapterSucceeded: false } };
  const partial = { ...base, health: { state: 'partial' as const }, provenance: { ...base.provenance, sampleSize: 3 } };

  const unavailableOutput = plain(ink.renderToString(React.createElement(FlowPanel, { metrics: unavailable, columns: 240 }), { columns: 240 }));
  const partialOutput = plain(ink.renderToString(React.createElement(FlowPanel, { metrics: partial, columns: 240 }), { columns: 240 }));

  assert.match(unavailableOutput, /Statistics: unavailable · population n=3/);
  assert.match(partialOutput, /Statistics: partial · population n=3/);
  assert.match(partialOutput, /Weekly completions: 1 \(n=1\)/);
  assert.match(partialOutput, /Lifecycle review-bounce rate: 0 \(n=1\)/);
  assert.match(partialOutput, /review: 120 min \(n=1\)/);
});

test('FLOW panel renders supplied cohort values with metric-specific coverage in wide and narrow layouts', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { FlowPanel } = await import('../src/interfaces/tui/flow-panel.js');
  const base = populatedMetrics();
  const metrics = {
    ...base,
    cohorts: {
      dimension: 'label' as const,
      lowSampleThreshold: 5,
      cohorts: [{
        key: 'experiment-a', n: 3, lowSample: true, lowSamplePopulation: true,
        lowSampleByMetric: { cycleTime: true, activeDwell: true, reviewDwell: true, reviewBounce: true, reviewFixRounds: false, tokens: true, runtime: true, cost: false, netEngineeringLines: true },
        medianCycleTimeMinutes: 30, p75CycleTimeMinutes: 40,
        medianActiveDwellMinutes: 10, medianReviewDwellMinutes: null,
        reviewBounceRate: null, medianReviewFixRounds: 1,
        tokensPerMission: null, agentRuntimeMinutesPerMission: 12,
        costUsdPerMission: 1.5, netEngineeringLinesPerMission: null,
        observationCounts: { cycleTime: 3, activeDwell: 2, reviewDwell: 0, reviewBounce: 0, reviewFixRounds: 3, tokens: 0, runtime: 1, cost: 2, netEngineeringLines: 0 },
      }],
    },
  };
  for (const columns of [120, 60]) {
    const output = plain(ink.renderToString(React.createElement(FlowPanel, { metrics, columns }), { columns }));
    assert.match(output, /EXPERIMENT COHORTS · label/);
    assert.match(output, /experiment-a · low-sample · population n=3/);
    assert.match(output, /cycle median 30 min \(n=3\)[\s\S]*p75 40 min \(n=3\)/);
    assert.match(output, /active 10 min \(n=2\)[\s\S]*review unavailable \(n=0\)[\s\S]*bounces[\s\S]*unavailable \(n=0\)/);
    assert.match(output, /fix rounds 1 \(n=3\)[\s\S]*runtime 12 min \(n=1\)[\s\S]*tokens[\s\S]*unavailable \(n=0\)/);
    assert.match(output, /cost 1\.5 USD \(n=2\)[\s\S]*NEL unavailable \(n=0\)/);
  }
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
