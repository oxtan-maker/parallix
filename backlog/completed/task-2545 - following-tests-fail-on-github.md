---
id: TASK-2545
title: following tests fail on github
status: done
assignee: [custom]
created_date: '2026-09-20 13:43'
labels: ["ai_sdlc", "bug"]
dependencies: []
ordinal: 87008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix the following tests that fail on github:

✖ failing tests:

test at test/forgejo.test.ts:13:1142
✖ getPrStatus and syncMerged share the same FORGEJO_USER fallback contract (60.125207ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  false !== true
  
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/forgejo.test.ts:914:12)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at test/forgejo.test.ts:13:19042
✖ syncMerged treats 409 Conflict as success if commits match (already merged) (41.062733ms)
  AssertionError [ERR_ASSERTION]: Should be ok even with 409 if head/base match abc123
  
  false !== true
  
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/forgejo.test.ts:1630:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at test/forgejo.test.ts:13:20116
✖ syncMerged treats 405 Method Not Allowed as success if commits match (already merged) (42.467365ms)
  AssertionError [ERR_ASSERTION]: Should be ok even with 405 if head/base match abc123
  
  false !== true
  
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/forgejo.test.ts:1669:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at test/forgejo.test.ts:13:21170
✖ syncMerged fails on 409 Conflict if commits do NOT match (57.611741ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + 'overwrite-refused'
  - 'merge-conflict-sha-mismatch'
  
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/forgejo.test.ts:1705:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 'overwrite-refused',
    expected: 'merge-conflict-sha-mismatch',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at test/task-2544-sonar-worktree-isolation.test.ts:1:1383
✖ task-2544: two distinct branch analyses resolve to distinct identities (117.201293ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + 'parallix-github-publish-4ad0605539468148e2e9e0fd195d964d418bfa32-73a6f81e99dc049115da6184ba1678bcf56fde4c7be14e952bc0d712ac520f57'
  - 'parallix'
  
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/task-2544-sonar-worktree-isolation.test.ts:63:12)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.start (node:internal/test_runner/test:1262:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 'parallix-github-publish-4ad0605539468148e2e9e0fd195d964d418bfa32-73a6f81e99dc049115da6184ba1678bcf56fde4c7be14e952bc0d712ac520f57',
    expected: 'parallix',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at test/task-2544-sonar-worktree-isolation.test.ts:1:4305
✖ task-2544: querying one branch analysis targets only that branch identity (92.770355ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /^parallix-feature-[a-z0-9_-]+-[0-9a-f]+$/. Input:
  
  'parallix-github-publish-4ad0605539468148e2e9e0fd195d964d418bfa32-73a6f81e99dc049115da6184ba1678bcf56fde4c7be14e952bc0d712ac520f57'
  
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/task-2544-sonar-worktree-isolation.test.ts:155:12)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/test_runner/test:1467:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 'parallix-github-publish-4ad0605539468148e2e9e0fd195d964d418bfa32-73a6f81e99dc049115da6184ba1678bcf56fde4c7be14e952bc0d712ac520f57',
    expected: /^parallix-feature-[a-z0-9_-]+-[0-9a-f]+$/,
    operator: 'match',
    diff: 'simple'
  }

If they are not safe to run on github move them out of that pipeline
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

## Resolution (mission task-2545 draft)
All six assertions fixed in place; both files remain in the `integration-ci` lane.
- `test/task-2544-sonar-worktree-isolation.test.ts`: save + clear `GITHUB_REF_NAME` / `PARALLIX_SONAR_BRANCH` so `resolveSonarBranch` falls back to the seeded repo's real branch.
- `test/forgejo.test.ts`: add benign `gitRunner` contract to the three `syncMerged` fixtures and the `FORGEJO_USER` fallback test so `reconcileForgejoBase` never touches a real checkout.
- Evidence: `npm run test:integration:ci` exit 0 (all six pass); `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` exit 0. Draft committed; lifecycle transition left to the harness.
