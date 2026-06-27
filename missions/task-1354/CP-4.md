# CP-4 — `verifyRedGreenProof` gate + handoff integration

## Summary

Implemented the red→green proof gate in `lib/tools/gatekeeper.js` and wired it into the handoff verification flow as an additive step.

- `findReproTestPath(slug, rootDir)` locates a `Reproduction-Test: <path>` line in MISSION.md or any checkpoint document (regex `^Reproduction-Test:\s*(.+?)\s*$`) (`lib/tools/gatekeeper.js:116`).
- `resolveMissionParentCommit(slug, rootDir)` computes the mission fork point via `git merge-base <baseBranch> <missionBranch>`, using `resolveMissionBaseBranch` so a recorded non-primary base is honored (`lib/tools/gatekeeper.js:142`).
- `runReproAtRef(ref, testPath)` runs the repro inside a throwaway detached worktree, overlaying the test file from HEAD so it exists at the parent ref; never mutates the live worktree; returns `{ status }` or `{ skipped, reason }` (`lib/tools/gatekeeper.js:162`).
- `verifyRedGreenProof(slug, options)` (`lib/tools/gatekeeper.js:202`): skips non-bug missions (`{ ok:true, skipped:true, reason:'not-a-bug-mission' }`); blocks when no `Reproduction-Test:` is declared, when the parent commit is unresolved, when the repro passes at parent (`not-red`), or fails at HEAD (`not-green`); skips when no test runner is usable; otherwise returns `{ ok:true, skipped:false, reason:'red-green-verified' }`. All collaborators are injectable for testing.
- Exported all four functions (`lib/tools/gatekeeper.js:274`).
- Integrated as **Step 2.6** in `performHandoff`, after the mandatory-files gatekeeper and before the Backlog transition. A non-ok result blocks handoff (task stays active); skipped/verified results log and continue. `checkMandatoryFiles` and `runGatekeeper` control flow are untouched (`lib/commands/handoff.js:321`, `:325`).

## Goal Check

| Success criterion | Evidence (file:line / test) | Status |
| --- | --- | --- |
| #7 `verifyRedGreenProof` runs repro at parent (fail) + HEAD (pass) | `lib/tools/gatekeeper.js:202` + test `verifyRedGreenProof passes when repro is red at parent and green at HEAD` (`test/gatekeeper.test.js:360`) | ✅ |
| #8 Gate blocks when repro missing | `lib/tools/gatekeeper.js:224` + test `verifyRedGreenProof blocks when the reproduction test is not declared` (`test/gatekeeper.test.js:380`) | ✅ |
| #8 Gate blocks when repro passes at parent | `lib/tools/gatekeeper.js:248` (`not-red`) + test `verifyRedGreenProof blocks when repro PASSES at the parent commit (not red)` | ✅ |
| #9 Non-bug missions skip the gate | `lib/tools/gatekeeper.js:216` + test `verifyRedGreenProof skips entirely for non-bug missions` (`test/gatekeeper.test.js:346`) | ✅ |
| Handoff integration is additive | `lib/commands/handoff.js:321-339` (new Step 2.6; `checkMandatoryFiles`/`runGatekeeper` unchanged) + `test/handoff.test.js` 36 pass | ✅ |

Test run: `node --test test/handoff.test.js test/gatekeeper.test.js` → all pass.

Next action: CP-5 — finalize regression tests and run both mission gates (`./scripts/verify-local.sh docs`, `npm test`).
