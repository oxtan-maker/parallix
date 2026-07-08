---
id: TASK-1429
title: yesterday sometime the review publish to forgejo just stopped working
status: done
assignee: [custom]
created_date: '2026-07-05 06:34'
updated_date: '2026-07-05 06:36'
labels: ["ai_sdlc", "bug", "regression"]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
http://localhost:3300/magnus/parallix/pulls/106 reconcile this with its review state

it seems to also be a problem that when using --max-attempts even the disk state does not get updated
<!-- SECTION:DESCRIPTION:END -->

## Investigation Notes

### Symptom
Review publishing to ForgeJo "just stopped working" — the review loop no longer posts outcomes to the ForgeJo PR, and `review-state.json` stops updating. The `--max-attempts` flag causes the loop to exit without writing disk state.

### Related issues
- **TASK-1424** (backlog): "publish fails" — reports stale build artifacts blocking `captureVerifiedTreeProof()` and post-integrate hook failure (`refresh-global-px.sh` / `publish:guard`). Same root directory path (`/home/magnus/code/parallix/`) suggests this is the same environment.
- **TASK-1417** (mission): Injected `getBuildFreshnessStatus()` into `captureVerifiedTreeProof()` and `assertVerifiedTreeProof()` in `lib/core/verification.ts`. If build artifacts are stale, the verification proof capture fails **before** the forgejo sync step in `lib/commands/integrate.ts` line ~801-819.
- **TASK-1422** (mission): Modified `lib/review/review-loop.ts` (added `maybeFallbackToPersistedContinueReviewer()`), renamed `mistral` → `vibe` in `lib/review/review-prompts.ts`.
- **TASK-1388** (mission): Modified `lib/tools/gatekeeper.ts` (pushback body generation).

### Plausible causes (ranked by recency of relevant code change)
1. **Build freshness gate blocking forgejo sync** (task-1417): `captureVerifiedTreeProof()` in `lib/core/verification.ts:133` now calls `getBuildFreshnessStatus()` before reading published tree state. If build artifacts are stale, the entire integration aborts before forgejo sync at `lib/commands/integrate.ts:819`. This would explain why "publish to forgejo stopped working" — it never reaches the forgejo sync step.
2. **Auth/token resolution regression**: `readToken()` in `lib/tools/forgejo.ts:238` relies on `resolveTokenFile()` which uses heuristic detection via `resolveForgejoHome()`. If token file path is wrong, all forgejo API calls fail silently or with auth errors.
3. **Provider config corruption**: `workflow.config.json` has `"provider": "forgejo"`, but if `resolveReviewAdapter()` returns `null` for some reason, `withForgejo()` returns `{ ok: true, skipped: true }` which masks the failure.
4. **Review loop exit-path regression**: `exit(1)` called before `writeReviewStateFn()` in review-loop.ts when `consumeReviewerArtifacts` returns `{ consumed: true, ok: false }`.
5. **ForgeJo API regression**: Changes to `forgejoApi()` or `postReview()` in `lib/tools/forgejo.ts` (though no recent changes to this file).

### Key files to investigate
- `lib/core/verification.ts` — build freshness gate (task-1417)
- `lib/commands/integrate.ts` — integration flow ordering
- `lib/review/review-loop.ts` — state persistence in exit paths
- `lib/review/review-adapter.ts` — `withForgejo` noop pattern
- `lib/tools/forgejo.ts` — auth, API calls, PR resolution
- `lib/tools/forgejo.ts` lines 238-246 — `readToken()`
- `lib/tools/forgejo.ts` lines 112-119 — `resolveForgejoSettings()`
- `workflow.config.json` — review provider config

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
