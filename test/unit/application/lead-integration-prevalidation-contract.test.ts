import assert from 'node:assert/strict';
import test from 'node:test';
import {
  integrationPrevalidationDecision,
  superviseFleet,
  type AttentionObservation,
  type SupervisorPort,
} from '../../../src/application/recovery-supervisor.js';

const mission = 'px-idle-integration';
const integrationItem: AttentionObservation = {
  missionId: mission,
  lane: 'integration',
  reason: { kind: 'integrate-lane', detail: 'Awaiting integration' },
  action: { kind: 'integrate:merge', display: `px integrate ${mission}` },
  working: false,
  workingDetail: null,
  progress: 'integration@candidate',
};

function port(observation: { currentSuccessfulRun: boolean; cpuUtilization: number | null }, fail = false) {
  const calls = { dryRuns: [] as string[], landingActions: 0, claims: 0, livenessChecks: 0, releases: 0 };
  const value: SupervisorPort = {
    attention: async () => [integrationItem],
    missionExists: async () => true,
    liveness: async () => { calls.livenessChecks++; return { working: false, detail: null }; },
    runAction: async () => { calls.landingActions++; },
    observeIntegrationPrevalidation: async () => observation,
    runIntegrationDryRun: async slug => {
      calls.dryRuns.push(slug);
      if (fail) { throw new Error('gate red'); }
    },
    claimRecovery: async () => { calls.claims++; return async () => { calls.releases++; }; },
    launchRecovery: async () => { throw new Error('integration must not launch recovery'); },
    wait: () => ({ elapsed: Promise.resolve(), cancel: () => {} }),
  };
  return { value, calls };
}

for (const [cpu, expected] of [[0.2999, 'run'], [0.30, 'cpu-busy'], [0.91, 'cpu-busy']] as const) {
  test(`lead integration pre-validation decision at CPU ${cpu} is ${expected} (PX-0031)`, () => {
    assert.equal(integrationPrevalidationDecision({ currentSuccessfulRun: false, cpuUtilization: cpu }), expected);
  });
}

test('lead runs only the public dry-run admission below 30 percent and leaves landing human-owned (PX-0031)', async () => {
  const fixture = port({ currentSuccessfulRun: false, cpuUtilization: 0.12 });
  const [result] = await superviseFleet(fixture.value, { once: true });
  assert.deepEqual(fixture.calls.dryRuns, [mission]);
  assert.equal(fixture.calls.claims, 1);
  assert.equal(fixture.calls.livenessChecks, 1);
  assert.equal(fixture.calls.releases, 1);
  assert.equal(fixture.calls.landingActions, 0);
  assert.equal(result?.outcome, 'human');
  assert.match(result!.steps.join('\n'), /px integrate px-idle-integration --dry-run.*landing remains human-owned/);
  assert.match(result!.summary, /never integrates/);
});

test('lead declines integration dry-run when another supervisor holds the mission claim (PX-0031)', async () => {
  const fixture = port({ currentSuccessfulRun: false, cpuUtilization: 0.12 });
  const value: SupervisorPort = { ...fixture.value, claimRecovery: async () => null };
  const [result] = await superviseFleet(value, { once: true });
  assert.deepEqual(fixture.calls.dryRuns, []);
  assert.equal(fixture.calls.livenessChecks, 0);
  assert.match(result!.steps.join('\n'), /another supervisor run holds the mission claim/);
});

test('lead rechecks liveness inside the mission claim immediately before integration dry-run dispatch (PX-0031)', async () => {
  const fixture = port({ currentSuccessfulRun: false, cpuUtilization: 0.12 });
  const value: SupervisorPort = { ...fixture.value,
    liveness: async () => ({ working: true, detail: 'execute — agent is live' }) };
  const [result] = await superviseFleet(value, { once: true });
  assert.deepEqual(fixture.calls.dryRuns, []);
  assert.equal(fixture.calls.releases, 1);
  assert.match(result!.steps.join('\n'), /integration dry-run not admitted: execute — agent is live/);
});

for (const [scenario, observation] of [
  ['equal threshold', { currentSuccessfulRun: false, cpuUtilization: 0.30 }],
  ['above threshold', { currentSuccessfulRun: false, cpuUtilization: 0.75 }],
  ['unavailable CPU', { currentSuccessfulRun: false, cpuUtilization: null }],
  ['current successful evidence', { currentSuccessfulRun: true, cpuUtilization: null }],
] as const) {
  test(`lead declines integration dry-run for ${scenario} and never lands (PX-0031)`, async () => {
    const fixture = port(observation);
    const [result] = await superviseFleet(fixture.value, { once: true });
    assert.deepEqual(fixture.calls.dryRuns, []);
    assert.equal(fixture.calls.landingActions, 0);
    assert.equal(result?.outcome, 'human');
  });
}

test('a failed opportunistic dry-run remains a human landing decision (PX-0031)', async () => {
  const fixture = port({ currentSuccessfulRun: false, cpuUtilization: 0.05 }, true);
  const [result] = await superviseFleet(fixture.value, { once: true });
  assert.deepEqual(fixture.calls.dryRuns, [mission]);
  assert.equal(fixture.calls.landingActions, 0);
  assert.equal(result?.outcome, 'human');
  assert.match(result!.steps.join('\n'), /pre-validation failed: gate red; landing remains human-owned/);
});
