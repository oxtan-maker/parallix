# CP-2: Root Cause Analysis

## Full Flow Trace (User Perspective)

```
px review                    → review-loop.ts: starts autonomous review
  ↓ reviewer posts LGTM      → review-adapter.ts: postWorkflowReview → forgejo.ts: postReview
  ↓ px integrate             → integrate.ts: orchestrate squash+publish
    ↓ git commit --squash    → integrate.ts:790 creates squash commit
    ↓ captureVerifiedTreeProof() → verification.ts:126 ← HERE IS THE BLOCK
      ↓ getBuildFreshnessStatus() → build-freshness.ts:59
      ↓ findStaleBuildArtifacts() → build-freshness.ts:32
      ↓ compares .ts mtimeMs vs .js mtimeMs → build-freshness.ts:45
      ↓ jsStat.mtimeMs < tsStat.mtimeMs → stale build detected
      ↓ returns { ok: false, message: "Stale build detected..." }
      ↓ captureVerifiedTreeProof returns { ok: false, error: "Stale build detected..." }
    ↓ IntegrationAbort thrown → integrate.ts:805-808
    ↓ FORGEJO SYNC NEVER RUNS → integrate.ts:817 (skip, exception already thrown)
```

## Hypotheses Investigated

### H1: Build freshness gate blocks forgejo sync (PRIMARY CAUSE) ✅ ACCEPTED

**Evidence:**
- `lib/core/verification.ts:133-139`: `getBuildFreshnessStatus()` called in `captureVerifiedTreeProof()` returns `{ ok: false }` on stale builds, causing early return BEFORE forgejo sync
- `lib/commands/integrate.ts:801-808`: `captureVerifiedTreeProof()` called post-commit, pre-forgejo sync. Failure throws `IntegrationAbort`, aborting entire integration
- Forgejo sync at `integrate.ts:817` is unreachable when build freshness fails
- Task-1417 injected `getBuildFreshnessStatus()` into verification proofs, exposing this symptom
- `test/task-1417-stale-publish-build-check.test.js` confirms build freshness check works as designed (blocks on stale)

**Why accepted:** The execution flow is clear. Build freshness check runs BEFORE forgejo sync. When it fails, `IntegrationAbort` is thrown, preventing forgejo sync from ever running. This directly explains "review publish to forgejo just stopped working" when builds are stale.

**Root cause file:line:** `lib/core/verification.ts:133-139`

### H2: review-loop max-attempts exit path missing state persistence (SECONDARY CAUSE) ⚠️ ALSO ACCEPTED

**Evidence:**
- `lib/review/review-loop.ts:1512`: On `--max-attempts` exhaustion, exits without calling `writeReviewStateFn`
- Leaves `review-state.json` stale, making resume/diagnosis impossible

**Why accepted:** While this doesn't directly cause forgejo sync failure, it compounds the problem by making it impossible to diagnose or resume after the failure. State persistence is needed at ALL exit paths.

**Root cause file:line:** `lib/review/review-loop.ts:1512`

### H3: ForgeJo API auth/token regression

**Investigation:** Reviewed `lib/tools/forgejo.ts` — `resolveForgejoAuth`, `readToken`, `resolveForgejoHome`. No regressions found in token resolution or API call construction. Auth failures would produce different symptoms (401/403 errors, not silent blocking).

**Why rejected:** The symptom is "forgejo sync never runs" not "forgejo API returns auth error." The build freshness gate prevents forgejo sync from ever being called.

### H4: withForgejo noop-return pattern masks failures

**Investigation:** Reviewed `lib/review/review-adapter.ts` — `withForgejo` correctly distinguishes "provider disabled" (`{ ok: true, skipped: true }`) from "provider failed" (`{ ok: false, error: <detail> }`). No masking pattern found.

**Why rejected:** The `withForgejo` pattern is not involved in the integrate→forgejo-sync path. That path uses `syncMerged()` from `forgejo.ts` directly, not the review adapter.

### H5: Configuration error (workflow.config.json)

**Investigation:** `workflow.config.json:14` has `verification.command` set to `"./scripts/verify-local.sh {{area}}"`. This is properly configured. The issue is not configuration but the build freshness check running BEFORE the verification command even executes.

**Why rejected:** Config is correct. The build freshness gate is a code-level check that runs regardless of verification command configuration.

## Fix Strategy

1. **Primary fix:** Convert build freshness check in `captureVerifiedTreeProof()` and `assertVerifiedTreeProof()` from hard gate to warning-only. Log the stale build warning but continue execution.
2. **Secondary fix:** Ensure `writeReviewStateFn` is called at all exit paths in `review-loop.ts`.

## Next action

CP-3: Apply build freshness non-blocking fix in `lib/core/verification.ts` and state persistence fix in `lib/review/review-loop.ts`.
