# CP-1 — Recovery-path inventory and reproduction

Revalidated on 2026-08-25: the parent implementation was inspected for the
exit-code-only return, and the current reproduction suite passes under
`npm test -- test/task-2413-repro.test.ts`. Later implementation details in
this checkpoint are superseded by CP-4 where they differ.

## Summary

Established the current recovery architecture and reproduced the information-loss
path before any policy change, per the mission's "inventory before refactor"
rule.

**Reproduction test:** `test/task-2413-repro.test.ts`. It encodes the desired
(green) behaviour — a publication verifier failure must carry the structured
root failure (exact command, cwd, exit status, captured stdout/stderr). At the
mission parent commit `e31f21549` those assertions were **RED**: `captureVerifiedTreeProof`
returned only `verification gate failed for <dir> with exit code 1`, discarding
the captured output. The fix (`src/adapters/verification/verification.ts`) now
returns `exitCode`, `command`, `cwd`, `stdout`, `stderr` alongside the wrapper
string. The test is now **GREEN** (see Goal Check).

**Red state at parent commit (the reproduction):** running the two
assertions against `e31f21549` produced failures — `captureVerifiedTreeProof`
returned `ok: true` when no gate command was configured (no-op pass), and with a
configured command returned `ok: false` with an error string that contained no
captured stdout/stderr. That is exactly the task-2373.01 failure class: the
detailed verifier output was discarded and would propagate only as an
exit-code-only wrapper.

## Recovery/retry/relaunch producers and their current authority

Single policy authority today: **`src/application/rebound-kernel.ts`**
(`rebound()`) — owns ADR 0048 classification (`src/application/failure-classification.ts`),
one fix-prompt builder, launch through injected `startAgent`, verify loop, and a
fresh per-occurrence in-memory budget (`DEFAULT_REBOUND_ATTEMPTS = 2`). No
persistence (no SQLite retry column).

Producers that call `rebound()`:
- `src/application/handoff-command-use-case.ts` — final gate run (Step 1) +
  `remediateGatekeeperPushback` (nested `currentAttempt`/`retriesLeft` budget,
  recursion guard `> 3`).
- `src/application/rebase-workflow.ts:350` — pre-review Git hook bounce.
- `src/adapters/review/review-gate-handling.ts:216` — reviewer gate failure.
- `src/adapters/review/review-artifacts.ts:850` — incomplete artifacts
  (`ARTIFACT_REBOUND_ATTEMPTS`).
- `src/adapters/cli/commands/integrate.ts:613` — integrate gate failure.
- `src/adapters/cli/commands/active.ts:489,545,582` — agent launch/session
  recovery and timeout.

Producers with a **competing / non-rebound** recovery authority:
- `src/adapters/review/review-loop.ts:831,1107` — reviewer/implementer timeout
  relaunch via direct `startAgentFn` with its own retry loop (NOT rebound).
- `src/adapters/cli/commands/repair-handoff.ts` — `buildRelaunchPrompt` +
  `buildGateFailurePrompt` + `buildGoalCheckRepairPrompt`: a **duplicate**
  prompt/classification seam (its own gate-failure vs goal-check branches).

Verification-proof authority (reused/issued, not a retry producer):
- `src/adapters/verification/verification.ts` — `createVerificationProofIdentity`,
  `readReusableVerificationProof`, `writeReusableVerificationProof`,
  `assertVerifiedTreeProof`.
- `src/adapters/forgejo/forgejo-pr.ts` `createPr` → `captureVerifiedTreeProof`
  (the lossy publication verifier). `src/adapters/forgejo/forgejo-git.ts`
  `syncPrimaryBaseline` → `assertVerifiedTreeProof`.
- `src/application/handoff-command-use-case.ts` declared-gate runner reuses/
  writes proof per command (`readReusableVerificationProof`/`writeReusableVerificationProof`).

Other bounded recovery paths observed: `active.ts` launcher/session recovery,
provider/network retries in `forgejo-pr.ts` (push lease retry, API error
backoff), gatekeeper pushback relaunch, and true-exhaustion emits
`Manual intervention required` (e.g. handoff `performHandoff` recursion guard,
`rebase-workflow.ts` hook-stranded).

## Next action

CP-2: implement per-check fingerprinting/reclassification and proof-reuse
invalidation, then add stale-proof-cannot-publish coverage.
