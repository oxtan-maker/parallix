---
id: TASK-2865
title: Revert the checkout-cache lifecycle that leaks unreclaimable px-tmp roots
status: backlog
assignee: []
created_date: '2026-11-20 15:25'
updated_date: '2026-11-20 15:27'
labels:
  - bug
dependencies: []
references:
  - TASK-2816
  - TASK-2843
  - px-0074.02
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Close the systematic leak of /var/tmp/px-tmp-<hash> checkout-cache roots by rolling back the change that introduced it, not by adding new reclamation code on top.

Regression evidence (operator workstation, 2026-11-20): 722 px-tmp-* roots. 547 were fixture checkouts (checkoutPath /tmp/px-tmp-X/X-X-X, no checkoutLifecycle, null git dirs, dead owner, checkout gone) that temp-root-registry.ts refuses to reclaim as "durable linked-checkout identity is incomplete"; 144 more have no .parallix-checkout-cache.json so checkoutCacheRoots never finds them. The earliest fixture root is dated 2026-11-07 and creation then continues daily (8, 22, 46, 86, 60, 76, 30, 14, 20, 22, 82, 51, 22, 9 per day through 2026-11-20); no leftover parallix-test-tmp-* roots from the older naming scheme exist. 2026-11-07 is the date of 74b54902e "Complete TASK-2615 checkout-cache lifecycle without losing warm-cache performance" (task-2843), which created src/adapters/verification/checkout-cache.ts and the checkout-cache recovery in temp-root-registry.ts and changed test/lib/test-tmpdir.ts, integrate-post.ts and the runner. ea7766486 (2026-11-14, titled for multi-review progress) later changed the same files. This is strong correlation, not yet proof.

Direction: first prove the cause by reproducing the leak on the parent of 74b54902e versus on it (focused, in disposable state). If confirmed, roll back that mission's behavior (and the unrelated edits ea7766486 made to these files if they belong to it) instead of writing another reclamation layer, keeping the warm-cache performance requirement of TASK-2615 only if the original design can meet it without a leak. Any part of 74b54902e that later work depends on is adapted minimally in place. Rolling back also removes the tests that encoded the new behavior.

Context: the px-0074.02 unit gate overran its 280000 ms CPU budget once (286539 ms vs 213406 ms on rerun of the same tree). A synthetic-load measurement on one suite showed only about 10 percent CPU inflation, so the leak is not proven to cause that overrun; this task stands on the leak itself. Related earlier work: TASK-2816, TASK-2843.

Out of scope: deleting live worktree caches, changing gates or CPU budgets, new parallel reclamation mechanisms.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A focused reproduction in disposable state shows fixture checkouts leave unreclaimable px-tmp roots on the parent of the lifecycle change's successor and not before it, and the causing mission is named in the task evidence.
- [ ] #2 The causing behavior is rolled back in its existing owners rather than extended: producer, registry verdict and runner cleanup return to a design that leaves no unreclaimable root, and superseded code and tests are removed.
- [ ] #3 A focused regression in the existing temp-root reclamation or fixture-lifetime suite fails on the parent and passes after the rollback: a fixture checkout whose owner has exited leaves no px-tmp root behind.
- [ ] #4 After one test run on a clean /var/tmp the number of px-tmp-* roots does not grow, demonstrated manually without touching real Mission or statistics data, and warm-cache performance is measured and reported against the rollback.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Ownership rule from the operator: a mission-persistent cache is retired by Parallix's own merge flow; nothing else should persist. Measured 2026-11-20: that flow already exists (retireCheckoutCaches in src/adapters/cli/commands/integrate-post.ts retires the cache when a merged mission's worktree is removed), and the two roots of live mission worktrees (px-0074.02, px-0074.03) are correctly retained until their merge. So the leak is not mission caches. The other classes are: 548 fixture-checkout roots under /tmp/px-tmp-X (a test must never leave a persistent root; removed by hand on 2026-11-20, 547 had dead owners and gone checkouts), 28 roots of research checkouts under /mnt/data/code/parallix-research/px-0060/v08/integration-sample-18/checkouts/pr-* (no merge flow ever retires them; the research script that creates them must retire them or not create persistent roots), and 144 owner-less roots with only manifests/tsx-1000 contents. The fix must assign each class to its owner (merge flow, test, research script) instead of widening the registry's reclamation.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
