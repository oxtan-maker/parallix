import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConfiguration } from '../../../src/composition/config.js';

// Owns the host-environment parsing contract; adapter suites own what they do with the typed values.
test('resolves typed slices from an explicit source and freezes them (TASK-2668.05)', () => {
  const source = { WORKFLOW_AGENT: 'codex', PARALLIX_NO_TUI: '1', CI: '1', FOREIGN_VALUE: 'ignored' };
  const config = resolveConfiguration(source);

  assert.equal(config.agents.override, 'codex');
  assert.equal(config.agents.watchdogEnabled, true);
  assert.equal(config.runtime.noTui, true);
  assert.equal(config.runtime.ci, true);
  assert.equal(config.forgejo.url, undefined);
  assert.equal(config.forwardedEnvironment, source);
  for (const slice of [config, config.agents, config.runtime, config.forgejo, config.decision]) {
    assert.equal(Object.isFrozen(slice), true);
  }
});

test('keeps false-like controls explicit (TASK-2668.05)', () => {
  const config = resolveConfiguration({ WORKFLOW_AGENT_NO_OUTPUT_WATCHDOG: '0', PARALLIX_NO_TUI: 'false', PARALLIX_NO_BUBBLEWRAP: '0' });

  assert.equal(config.agents.watchdogEnabled, false);
  assert.equal(config.runtime.noTui, false);
  assert.equal(config.agents.bubblewrapDisabled, false);
});

test('types numeric controls and drops missing or invalid values (TASK-2668.05)', () => {
  const valid = resolveConfiguration({
    AUTONOMOUS_REVIEW_POLL_INTERVAL_MS: '250', AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS: '9000',
    WORKFLOW_AGENT_NO_OUTPUT_INITIAL_MS: '0', WORKFLOW_REVIEW_AGENT_NO_OUTPUT_MAX_MS: '1500',
  });
  assert.equal(valid.runtime.reviewPollIntervalMs, 250);
  assert.equal(valid.runtime.reviewPollTimeoutMs, 9000);
  assert.equal(valid.agents.noOutputInitialMs, 0);
  assert.equal(valid.agents.reviewNoOutputMaxMs, 1500);

  const invalid = resolveConfiguration({
    AUTONOMOUS_REVIEW_POLL_INTERVAL_MS: 'abc', AUTONOMOUS_REVIEW_POLL_TIMEOUT_MS: '-5',
    WORKFLOW_AGENT_NO_OUTPUT_INTERVAL_MS: '-1', WORKFLOW_DRAFT_AGENT_NO_OUTPUT_INITIAL_MS: '',
  });
  assert.equal(invalid.runtime.reviewPollIntervalMs, null);
  assert.equal(invalid.runtime.reviewPollTimeoutMs, null);
  assert.equal(invalid.agents.noOutputIntervalMs, null);
  assert.equal(invalid.agents.draftNoOutputInitialMs, null);
  assert.equal(resolveConfiguration({}).runtime.reviewPollIntervalMs, null);
});

test('normalizes decision settings (TASK-2668.05)', () => {
  const decision = resolveConfiguration({ PARALLIX_JEV_REVIEW: ' Shadow ', JEV_CODE_TIMEOUT_MS: ' 500 ', TYPESAFE_API_KEY: ' k ' }).decision;

  assert.equal(decision.reviewMode, 'shadow');
  assert.equal(decision.timeoutMs, '500');
  assert.equal(decision.apiKeys.TYPESAFE_API_KEY, 'k');
});
