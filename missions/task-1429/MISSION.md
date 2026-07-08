# Mission: Diagnose and repair review publish-to-forgejo regression (task-1429)

## Goal

Repair the review publish-to-forgejo regression so that the review loop successfully posts outcomes to the ForgeJo PR and persists local disk state (`review-state.json`) regardless of provider failures. The agent must diagnose the root cause — which may lie in the review loop, the forgejo API layer, the verification/build-freshness gate, authentication, or configuration — and fix it.

## Why Now

The user observed that review publishing to ForgeJo "just stopped working" — the review loop no longer posts outcomes to the ForgeJo PR at `http://localhost:3300/magnus/parallix/pulls/106`, and the local `review-state.json` file stops updating. The `--max-attempts` flag exacerbates the problem by causing the loop to exit without writing disk state, making it impossible to resume or diagnose.

Several recent missions touched code on the integration and review path, and any of them could have introduced or exposed the regression:

- **task-1417** (`lib/core/verification.ts`): Injected `getBuildFreshnessStatus()` into `captureVerifiedTreeProof()` and `assertVerifiedTreeProof()`. If build artifacts are stale, the verification proof capture fails **before** the forgejo sync step in `lib/commands/integrate.ts` (line ~801-819), aborting the entire integration before forgejo sync ever runs.
- **task-1424** (backlog): Reports the same stale-build symptom — "Could not verify the exact tree being published: [parallix] Stale build detected" — and a post-integrate hook failure (`refresh-global-px.sh` / `publish:guard`).
- **task-1422** (`lib/review/review-loop.ts`, `lib/review/review-prompts.ts`): Added `maybeFallbackToPersistedContinueReviewer()` logic and renamed `mistral` → `vibe` in prompt entrypoints.
- **task-1388** (`lib/tools/gatekeeper.ts`): Modified the gatekeeper pushback body generation (artifact-creation instructions).

The agent should investigate all plausible causes without pre-selecting one.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: Low-Medium (root cause unknown — this is a diagnostic mission)
- Selection note: The symptom is user-visible and blocks the core autonomous review workflow. Multiple recent missions touched the relevant code paths. The fix could be small (state persistence, config) or structural (verification gate, auth layer).

## Scope

### In scope

- **`lib/review/review-loop.ts`**: Review the full review loop lifecycle — artifact consumption, provider interaction, state persistence, and exit paths. Identify any path where disk state is not written before exit or where provider failures cause silent abort.
- **`lib/review/review-adapter.ts`**: Review the `withForgejo` noop-return pattern. Confirm it correctly distinguishes "provider disabled" (`{ ok: true, skipped: true }`) from "provider failed" (`{ ok: false, error: <detail> }`).
- **`lib/review/review-artifacts.ts`**: Review `postWorkflowReview` and `postWorkflowComment` failure paths. Confirm error propagation is correct.
- **`lib/tools/forgejo.ts`**: Review the raw ForgeJo API layer — `postReview`, `postComment`, `forgejoApi`, `resolveForgejoAuth`, `readToken`, `resolveForgejoSettings`. Check for regressions in auth resolution, API call construction, error handling, or PR number resolution.
- **`lib/core/verification.ts`**: Review `captureVerifiedTreeProof()` and `assertVerifiedTreeProof()` — particularly the build freshness gate added in task-1417. Determine whether stale-build failures are correctly surfacing and whether they should block forgejo sync.
- **`lib/commands/integrate.ts`**: Review the integration flow — the sequence of verification proof capture → forgejo sync → post-integrate hook. Identify any ordering issue or premature abort.
- **`lib/tools/gatekeeper.ts`**: Review any changes that could affect review posting.
- **`workflow.config.json` and `lib/core/product-config.ts`**: Review the review adapter configuration resolution. Check for misconfigurations that could cause silent provider disablement.
- **Authentication and token resolution**: Review `readToken`, `resolveTokenFile`, `resolveForgejoUser`, and `resolveForgejoAuth`. Check for token expiration, file path issues, or environment variable conflicts.
- **Test**: Author a reproduction test that captures the diagnosed bug (fails red at parent commit, passes green after fix).

### Out of scope

- Changes to agent prompting (`lib/review/review-prompts.ts`) unrelated to the root cause.
- Graphify integration or pre-review gate logic.
- End-to-end integration testing against a live ForgeJo instance (mock-based testing is sufficient).
- Changes to the `vibe`/`mistral` rename introduced in task-1422 (unless directly tied to the root cause).

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- SC1: The reproduction test exists at `test/task-1429-review-publish-failure.test.js` (or equivalent name), is importable via the Node test runner, and fails red at the mission's parent commit demonstrating the diagnosed bug.
- SC2: After the fix, the reproduction test passes green.
- SC3: The review loop successfully posts outcomes to the ForgeJo PR (or correctly handles a confirmed environmental/config cause with a documented workaround) and persists `review-state.json` before any exit path.
- SC4: `./scripts/verify-local.sh static-analysis` passes clean on the final tree.
- SC5: The mission notes in a checkpoint document the diagnosed root cause, the files changed, and the rationale for the fix — including any alternative hypotheses that were investigated and ruled out.

## Risks and Assumptions

- **Risk:** The root cause may be environmental (ForgeJo server down, token expired, network unreachable, config corruption) rather than a code defect. If so, the mission should document the diagnosis and provide a clear remediation path rather than forcing a code fix.
- **Risk:** The build freshness gate added in task-1417 may be the primary culprit — stale build artifacts cause `captureVerifiedTreeProof()` to fail before forgejo sync runs. This is a coordination issue between the verification gate and the forgejo sync path, not a forgejo bug per se.
- **Risk:** The `withForgejo` pattern in `review-adapter.ts` may silently mask provider failures by returning `{ ok: true, skipped: true }` when the provider config is corrupted or the remote is unreachable.
- **Risk:** Token resolution may have regressed — `readToken` relies on `resolveTokenFile` which depends on `resolveForgejoHome` heuristic detection. If the token file path is wrong, all forgejo API calls fail with auth errors.
- **Assumption:** The ForgeJo instance at `localhost:3300` is reachable when it should be. The failure could be intermittent (network, server load, rate limiting) or persistent (auth, config, code regression).
- **Assumption:** `writeReviewStateFn` is reliable — it writes and commits `review-state.json` correctly. The issue is likely that it is not called in certain failure paths.

## Checkpoints

- CP 1: Reproduction test authored that fails red at the parent commit. The test should mock or simulate the failure condition (provider POST failure, stale build, auth failure, or whichever is the diagnosed root cause) and assert the buggy behavior (e.g., state not persisted, forgejo sync not reached).
- CP 2: Root cause analysis documented. The agent should trace the full integration/review flow from the user's perspective (click review → agent runs → post review to forgejo → persist state) and identify the exact point of failure. Document all hypotheses investigated and why they were accepted or rejected.
- CP 3: Fix implemented. The fix should address the diagnosed root cause. If the root cause is environmental/config, provide a clear remediation and/or defensive code changes.
- CP 4: Reproduction test passes green. All affected tests pass. `./scripts/verify-local.sh static-analysis` passes clean.
- CP 5: Final checkpoint with Goal Check table citing real evidence — file:line references, test names, and proof that the fix resolves the regression.

## Gates

- [x] ./scripts/verify-local.sh static-analysis

## Restricted Areas

- Do not modify files outside the in-scope list without justification documented in the mission notes.
- Do not introduce new dependencies.
- Do not change the review loop's exit code semantics (still exits 1 on unrecoverable failure).

## Stop Rules

- Stop if the root cause is confirmed to be purely environmental (e.g., ForgeJo server permanently down, token revoked by admin) — document the diagnosis and close the mission without code changes, providing clear remediation steps.
- Stop if fixing the root cause requires changes that conflict with a recent mission's design intent — escalate for scope review with specific references.
- Stop if the reproduction test cannot be authored because the bug is non-reproducible in a test environment — document the limitation and propose an alternative verification strategy (e.g., integration test against a test ForgeJo instance).
- Stop if `./scripts/verify-local.sh static-analysis` fails and the failure is unrelated to the fix — document the pre-existing failures and proceed with caution.

Reproduction-Test: test/task-1429-review-publish-failure.test.js
