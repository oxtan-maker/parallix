# Mission: Sync primary baseline on existing-PR push path (task-1349)

## Goal

Make `px review --push` force-sync Forgejo's primary baseline (`review/main`) to match local `main` on the existing-PR update path, not only during PR creation. This eliminates the stale-baseline bug where Forgejo's `main` diverges from the local authoritative primary, causing PR diffs to show hundreds of unrelated files.

## Why Now

The bug causes review to become unusable when local `main` has advanced since the PR was opened. Task-1325 PR #33 surfaced ~590 spurious changed files in the diff, making the actual mission diff invisible. The workaround (manual force-push of `main` → `review/main`) is fragile and breaks the automated review loop. This is a high-priority regression that blocks autonomous review completion.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: Review becomes unusable when baseline diverges; both push paths must share a single baseline-sync code path

## Scope

- **File under change**: `lib/tools/forgejo.js`
- **Function under change**: `createPr` — ensure `syncPrimaryBaseline` runs on both the PR-creation path AND the existing-PR update path, before any branch push
- **Test file under change**: `test/forgejo.test.js` — add regression test asserting `syncPrimaryBaseline` fires on the existing-PR path
- **Code path affected**: The existing-PR path in `createPr` (lines 484–499 of forgejo.js), which currently returns early after detecting an existing PR without pushing the branch

## Out of Scope

- Changes to `lib/review/review-commands.js` (the `pushRound` dispatcher)
- Changes to `lib/review/review-loop.js` (the review loop orchestrator)
- Changes to any agent, prompt, or launcher configuration
- Changes to `syncPrimaryBaseline` internals (verification gate, force-push logic, token resolution)
- Changes to `syncMerged` (post-merge baseline sync is separate)
- Refactoring of `buildCreatePrPushArgs` or other push-arg helpers
- Changes to the Forgejo API client layer (`forgejoApi`, `forgejoApiAsync`)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `createPr` calls `syncPrimaryBaseline` before pushing the branch on the existing-PR update path (the code path where an open PR is detected at line 484–499 of forgejo.js)
2. Both the PR-creation path and the existing-PR update path invoke `syncPrimaryBaseline` through the same code invocation (no separate inline force-push of `main:main`)
3. After a `--push` on an existing PR, Forgejo's `review/main` SHA equals the local `main` SHA (verified by the `syncPrimaryBaseline` force-push on `refs/heads/main:refs/heads/main`)
4. A regression test exists in `test/forgejo.test.js` that mocks the existing-PR path (open PR found via API) and asserts `syncPrimaryBaseline` is called (by spying on the git push to `main:main`)
5. The verification gate from `syncPrimaryBaseline` (via `assertVerifiedTreeProof`) is preserved on the existing-PR path — the baseline sync still fails if the verification proof does not match the tree

## Risks and Assumptions

- **Risk**: `syncPrimaryBaseline` performs a force-push to `review/main`. If the verification proof is stale, it will reject the sync. Mitigation: the proof is captured fresh at the top of `createPr` (line 429), so the same proof is used for both paths.
- **Risk**: Existing callers of `createPr` may rely on the early-return behavior when a PR exists. Mitigation: the early return still happens, but after the baseline sync completes successfully.
- **Assumption**: The existing PR detection logic (`resolvePrAccess` at line 484) correctly identifies the branch's PR. This is unchanged by this mission.
- **Assumption**: `syncPrimaryBaseline` already handles the case where `main` does not exist locally (returns `{ ok: true, skipped: true }` at line 745).
- **Assumption**: The verification proof captured at line 429 is valid for the baseline sync on both paths (same `rootDir`, same tree).

## Status

CLOSED — already-satisfied / no-op. The fix and regression test were introduced in
Initial commit `17e0b1c7` (2026-06-22), predating task creation (2026-06-25).
The stale-baseline bug described in this mission does not exist in the current
`createPr` control flow. See CP-2.md and CP-3.md for full reconciliation.

## Checkpoints

- CP 1: Identified the exact code location where the existing-PR path diverges from the PR-creation path in `createPr` (forgejo.js lines 484–499) and confirmed `syncPrimaryBaseline` is not called on that path
- CP 2: Verified `syncPrimaryBaseline` call at forgejo.js:435 predates mission (Initial commit `17e0b1c7`, 2026-06-22); both paths share single invocation; no separate inline force-push exists
- CP 3: Verified regression test at forgejo.test.js:301-334 predates mission; demonstrated falsifiability (test would fail if `syncPrimaryBaseline` were removed from forgejo.js:435)

## Gates

- [x] ./scripts/verify-local.sh docs — PASS
- [x] npm test passes with all existing tests green — 1660 pass, 0 fail, 22 skip

## Restricted Areas

- Do not modify `lib/review/review-commands.js` (the `pushRound` function)
- Do not modify `lib/review/review-loop.js` (the autonomous review loop)
- Do not modify `lib/tools/forgejo.js` outside the `createPr` function
- Do not modify `syncPrimaryBaseline`, `syncMerged`, `buildCreatePrPushArgs`, or any other exported function in forgejo.js
- Do not add new dependencies or modify package.json
- Do not modify any test file other than `test/forgejo.test.js`

## Stop Rules

- Stop if the fix requires refactoring more than one function in forgejo.js
- Stop if the verification proof captured at createPr's top cannot be reused for the existing-PR path (would indicate a deeper architectural issue requiring a separate mission)
- Stop if existing tests in `test/forgejo.test.js` break in a way that suggests the change affects unrelated functionality
- Stop if the fix introduces a second, separate baseline-sync code path (violates SC 3 — both paths must share a single sync invocation)
