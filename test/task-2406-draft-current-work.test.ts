// @ts-nocheck -- mocked-port regression coverage for DraftCommandUseCase

import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftCommandUseCase } from '../src/application/draft-command-use-case.js';

function context(overrides: Record<string, unknown> = {}) {
  return {
    exited: false,
    slug: 'task-2406',
    agent: 'codex',
    ...overrides,
  };
}

function workflow(calls: string[], overrides: Record<string, unknown> = {}) {
  return {
    preflight: () => { calls.push('preflight'); return context(); },
    setup: (ctx: any) => { calls.push('setup'); return context(ctx); },
    scaffold: (ctx: any) => { calls.push('scaffold'); return context(ctx); },
    intake: async (ctx: any) => { calls.push('intake'); return context(ctx); },
    transition: async (ctx: any) => { calls.push('transition'); return context(ctx); },
    launchAgent: async (ctx: any) => { calls.push('launchAgent'); return context(ctx); },
    postProcess: async (ctx: any) => { calls.push('postProcess'); return context(ctx); },
    commitSafety: (ctx: any) => { calls.push('commitSafety'); return context(ctx); },
    finalTransition: async () => { calls.push('finalTransition'); },
    ...overrides,
  };
}

test('draft publishes running with phase execute before workflow and ended after finalTransition', async () => {
  const calls: string[] = [];
  const currentWork = {
    running: async (publication: any) => { calls.push(`running:${publication.phase}`); },
    blocked: async () => { calls.push('blocked'); },
    ended: async () => { calls.push('ended'); },
  };

  await new DraftCommandUseCase(workflow(calls), currentWork).execute(['task-2406']);

  assert.deepEqual(calls, [
    'preflight', 'running:execute', 'setup', 'scaffold', 'intake', 'transition',
    'launchAgent', 'postProcess', 'commitSafety', 'finalTransition', 'ended',
  ]);
});

test('draft publishes blocked with the workflow error and rethrows it', async () => {
  const calls: string[] = [];
  const currentWork = {
    running: async () => { calls.push('running'); },
    blocked: async (_publication: any, reason: string) => { calls.push(`blocked:${reason}`); },
    ended: async () => { calls.push('ended'); },
  };
  const failure = new Error('draft agent failed');

  await assert.rejects(
    new DraftCommandUseCase(workflow(calls, { launchAgent: async () => { throw failure; } }), currentWork).execute(['task-2406']),
    failure,
  );
  assert.deepEqual(calls, ['preflight', 'running', 'setup', 'scaffold', 'intake', 'transition', 'blocked:draft agent failed']);
});

test('draft skips current-work publication for an unparseable slug', async () => {
  const calls: string[] = [];
  const currentWork = {
    running: async () => { calls.push('running'); },
    blocked: async () => { calls.push('blocked'); },
    ended: async () => { calls.push('ended'); },
  };
  const draftWorkflow = workflow(calls, { preflight: () => context({ slug: 'not a slug' }) });

  await new DraftCommandUseCase(draftWorkflow, currentWork).execute(['not a slug']);

  assert.deepEqual(calls, ['setup', 'scaffold', 'intake', 'transition', 'launchAgent', 'postProcess', 'commitSafety', 'finalTransition']);
});
