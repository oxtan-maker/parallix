// TASK-2468 namespace coverage. The reviewer (round 1, F3) flagged that
// `px integrate` — the highest-risk lifecycle command — had zero adhoc coverage:
// its slug/task handling had not been shown to tolerate the new
// `parallix-adhoc-<NNNN>` namespace.
//
// integrate resolves its target through `inferSlug` (the single shared validator
// now owned by the domain layer, task-2468 F7) and then loads the mission record
// from the operator database. This test pins the entry point: the shared
// validator must recognize the DB-owned adhoc namespace exactly as it recognizes
// the `task-` and legacy `adhoc-` namespaces, and reject the non-namespaced
// free-text argument that used to fall through to a bogus `adhoc-<slug>`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inferSlug, isMissionSlugCandidate } from '../src/adapters/filesystem/mission-paths.js';

test('adhoc-lifecycle: the shared validator recognizes the DB-owned adhoc namespace at the integrate entry', () => {
  // integrate's first line: inferSlug(explicitSlug). It must return the adhoc
  // identity unchanged so the mission-store load downstream resolves it.
  assert.equal(inferSlug('parallix-adhoc-0001'), 'parallix-adhoc-0001');
  assert.equal(inferSlug('parallix-adhoc-12345'), 'parallix-adhoc-12345');

  // The other recognized backings still validate — one shared validator, no
  // second classifier (Restricted Area honored).
  assert.equal(inferSlug('task-architecture-migration'), 'task-architecture-migration');
  assert.equal(inferSlug('adhoc-fix-hello'), 'adhoc-fix-hello');

  // A non-namespaced free-text argument is not a slug candidate: it is rejected
  // at the intake boundary (resolveDraftTarget), not silently coerced into a
  // bogus `adhoc-<free-text>` downstream.
  assert.equal(isMissionSlugCandidate('fix hello world greeting'), false);
});
