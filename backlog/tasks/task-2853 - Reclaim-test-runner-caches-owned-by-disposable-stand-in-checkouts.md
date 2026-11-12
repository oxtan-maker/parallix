---
id: TASK-2853
title: Reclaim test runner caches owned by disposable stand-in checkouts
status: backlog
assignee: []
created_date: '2026-11-12 10:50'
labels: [bug]
dependencies: []
priority: medium
---

## Description

Repeated test-harness runs leave checkout caches under `/tmp/px-tmp-<hash>` after their disposable stand-in checkouts are removed. On 2026-11-12, 78 of 98 inspected cache roots referenced absent checkouts; examples named runner-selection, runner-memory, lifetime-runner, integration-suite-meter, budget-guard-proof and cpu-guard-probe fixtures. The host's 16 GiB tmpfs had less than the real-agent smoke's required 512 MiB free. Retained manual database/evidence copies were the largest consumers, so this cache leak is a contributing accumulation mechanism, not the sole cause of exhaustion.

`test/run-default-tests.ts` creates stable caches through `checkoutTestTmpdir` / `ensureCheckoutCache`. Stand-in fixtures use `caseRoot`, whose disposal removes only the fixture root, while its hashed cache is a sibling under the temporary base. `abandonedCheckoutCacheVerdict` in `src/adapters/verification/temp-root-registry.ts` requires a complete linked-worktree identity before reclaiming an abandoned cache. Stand-ins without `.git` have null Git identities and are permanently reported as unresolved, even when the recorded owner is dead and the checkout is gone. The cache also lies outside the fixture root registered with the enclosing harness.

Focused reproduction on the current tree: create a temporary directory with a stand-in checkout lacking `.git`; call `ensureCheckoutCache(checkout, temporaryBase, { pid: 2147483647, startId: null })`; remove the stand-in; call `recoverRecordedTempRoots` with an isolated manifest directory, `ownerLiveness: () => false` and `legacyCoverageBases: [temporaryBase]`. Observed: `reclaimed: []`, cache remains, unresolved reason `durable linked-checkout identity is incomplete`. The reproduction cleaned up its own directory afterward.

Five whys: (1) the smoke stopped because shared temporary capacity was exhausted; (2) old manual artifacts and repeated cache allocations accumulated; (3) disposing a stand-in does not dispose its sibling cache; (4) abandoned-cache recovery only has retirement proof for real linked worktrees; (5) the ownership contract and regression coverage do not cover the cache lifetime of disposable stand-ins. The smoke capacity check detected the host condition before agent launch; this evidence does not establish a broken main revision.

Use the existing cache and fixture ownership mechanisms to make disposable caches reclaimable. Preserve conservative deletion for real checkouts, unknown identities and live or uncertain owners; do not weaken ownership validation to accept arbitrary absent paths. Inspect the existing owners and adjacent assertions before choosing whether case teardown should retire these caches or the enclosing runner should own them.

## Acceptance Criteria

- [ ] #1 Retain a focused regression that fails on the parent and proves cache reclamation after disposable stand-in success, failure and forced termination; extend the existing owning suites rather than adding task-named test files.
- [ ] #2 Repeated runner-fixture executions leave no additional abandoned sibling caches after teardown or the next supported recovery pass.
- [ ] #3 Live and uncertain owners, active real checkouts, symlinks and mismatched ownership records remain protected; preserve the existing assertions in test-runner-root-reclamation.test.ts and test-tmpdir.test.ts.
- [ ] #4 Manually exercise the runner against isolated stand-ins and verify cleanup without touching operator databases or shared agent state. Keep integration cases below 3.5 seconds and unit cases within the existing headroom requirement. Do not change gates, tiers or CPU budgets.
