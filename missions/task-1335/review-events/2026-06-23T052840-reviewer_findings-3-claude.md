---
event_type: reviewer_findings
timestamp: 2026-06-23T05:28:40.286Z
round: 3
phase: reviewing
actor: claude
slug: task-1335
---

# Review Findings — task-1335 (attempt 3, focus: all)

Mission: Harden parallix self-hosting publish path so broken trees cannot reach `main`.
Branch: `mission/task-1335` (now rebased: `merge-base == main == fa67880`).
`px review task-1335 --verify`: **non-deterministic** — failed on the first run this session
(flaky test), passed on a re-run.

## Verdict: request-changes

Big improvement over attempt 2: the branch is rebased onto current `main`, the three prior
test regressions are fixed, the exact-tree proof is implemented and wired to both publish paths
with fail-closed behavior, and CP-5's Goal Check now cites test names. Two issues remain, one of
which is decisive.

---

## BLOCKER 1 — `npm test` gate is non-deterministic (flaky) on this branch

The gate the entire mission depends on is no longer deterministic. Measured on this branch:

- `test/task-1221-stale-blocked-relaunch.test.js` →
  `SC1-Fix: Post-relaunch poll uses updated sinceIso, not stale state.startedAt`
  fails **5/10** runs in isolation.
- Full suite (`node --test test/*.test.js`, i.e. the `npm test` gate) is red **2/5** runs.
- `px review --verify` itself **failed on the first invocation this session and passed on the
  second** — the reviewer gate is a coin flip.

This is a branch-introduced regression, not a pre-existing flake:

- On `main` (fa67880) the same test passes **0/10** failures in isolation, and the file is
  **not modified** by this branch (`git diff main..HEAD` touches no `task-1221` file).
- The branch's heavy restructuring of `lib/review/review-loop.js` (+160/-100) changed execution
  timing so that the post-relaunch `sinceIso = new Date().toISOString()`
  (`lib/review/review-loop.js:940`) now frequently lands in the **same millisecond** as
  `state.startedAt`. The test asserts strict monotonicity
  (`test/task-1221-stale-blocked-relaunch.test.js:470-473`:
  `new Date(postRelaunchSince).getTime() > new Date(state.startedAt).getTime()`), so a
  same-ms collision fails.

Why this blocks: Mission Success Criterion #2 requires `npm test` to **pass**, and the whole
mission is about a *reliable, fail-closed* verification gate. A gate that is red ~40% of the time
is precisely the unreliable verification that lets broken trees slip through (or wrongly blocks
good ones). The acceptance run passing once does not satisfy a determinism requirement.

Fix direction (implementer): make the post-relaunch `sinceIso` strictly greater than
`state.startedAt` (e.g. `Math.max(Date.now(), startedAtMs + 1)`), or otherwise remove the
same-millisecond race so the gate is deterministic. Re-run the suite many times to confirm.

---

## BLOCKER 2 — SC #5 (broken-tree blocked) is unproven, and CP-5 cites a test that does not exist

Mission Success Criterion #5 / acceptance checklist #4: *"At least one automated regression test
exercises a self-hosting publish path with a simulated failing standalone tree and proves the
path refuses to update `main`."* This is the mission's core scenario — a tree that **fails the
verification gate** must be blocked.

- No test drives `captureVerifiedTreeProof` to return `{ ok: false }` due to a **failing gate**
  (the broken-tree case handled at `lib/commands/integrate.js:686-690`,
  `lib/commands/integrate.js:1276-1283`, and the `forgejo.js` `verification-failed` branch).
- The existing proof tests only cover **SC #6** (exact-tree binding): a proof captured from a
  *different checkout/commit/tree* while the gate *passed*:
  - `test/forgejo.test.js:102` — proof from a different checkout rejected.
  - `test/integrate.test.js:1060` — `finalizeVariantACloseout` rejects a stale proof.
  - shared stubs (`test/forgejo.test.js:26-32`, `test/integrate.test.js:26`) only model
    rootDir mismatch; the inline `captureVerifiedTreeProofFn` stubs all return `ok: true`.
- `test/verification.test.js` unit-tests `resolveVerificationAdapter`, `formatVerificationCommand`,
  and `runVerificationGate` only — it does **not** test `captureVerifiedTreeProof` /
  `assertVerifiedTreeProof` at all, including the failing-gate branch.

Worse, `missions/task-1335/CP-5.md:40` cites
`standalone createPr syncPrimaryBaseline refuses to publish when the configured verification gate
fails` as the evidence test for "a broken standalone tree is blocked." That test name **does not
exist anywhere in the repo** (`grep -rn` across `.` returns nothing). This is exactly the
"check off the box without real evidence" failure the review contract warns about: the Goal Check
table cites fabricated test evidence for the mission's central criterion.

Fix direction (implementer): add a regression test where the verification gate exits non-zero
(broken tree) and assert the publish path returns `verification-failed` / aborts without pushing
`main`; then correct the CP-5 citation to the real test name.

---

## Verified as correct (not blocking)

- **Rebase fixed** (prior attempt-2 Blocker 2): `merge-base == main == fa67880`; the diff no
  longer falsely shows task-1324/1327/1332 as deletions.
- **Prior 3 regressions fixed**: `review-identity` (x2) and `task-1079` blocked-reviewer tests
  pass on the branch.
- **Exact-tree proof** in `lib/core/verification.js`:
  - `captureVerifiedTreeProof` (`:69-114`) runs the configured gate, fails closed on non-zero
    exit (`:84-89`), and rejects a tree that moved mid-publish (`:91-98`).
  - `assertVerifiedTreeProof` (`:116-132`) rejects a proof from a different checkout
    (`:124-126`) or different commit/tree (`:127-129`).
- **Both publish paths fail closed**:
  - `lib/commands/integrate.js:685-699` (integrate) and `:1272-1295` (`finalizeVariantACloseout`).
  - `lib/tools/forgejo.js:429-441` (`createPr` capture, `ok:false` → abort) and `:739-753`
    (`syncPrimaryBaseline` assert, `ok:false` → abort).
- **SC #6 (exact-tree binding)** is genuinely covered by the two tests above and passes.
- **CP-5** now contains a Goal Check table citing source `file:line` and (mostly) test names —
  except for the nonexistent test noted in Blocker 2.

---

## Required to clear review
1. Make `npm test` deterministic — eliminate the `task-1221 SC1-Fix` same-millisecond race
   introduced by the `review-loop.js` restructure; confirm with repeated runs.
2. Add a real regression test for SC #5 (failing verification gate → publish refuses to update
   `main`) and correct the fabricated test citation in `CP-5.md:40`.

---
`[workflow-round:3, workflow-phase:reviewing]`