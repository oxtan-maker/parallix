# CP-3: Codex/opencode diagnostic verification + required gates

## Work done
Verified the real missing-session diagnostics of Codex and opencode against the installed CLIs (offline, no account/network), then made only evidence-supported changes.

**Verified diagnostics (captured live):**
- opencode: `opencode run --session does-not-exist-123 --pure "hi"` → `Error: Session not found` (exit 1). This is the same literal `src/adapters/agents/opencode.ts` already matches. **No change** — its existing `Session not found` detector is correct.
- Codex: `codex resume <uuid> "prompt"` cannot produce a missing-session diagnostic offline — it falls back to the interactive session picker and reports `Error: stdin is not a terminal` (exit 1). The real missing-session message only surfaces in an interactive/TTY session, which cannot be reproduced in a mocked unit test and would require a real account. Per the mission Stop Rule ("Stop before changing Codex or opencode if their missing-session diagnostic cannot be verified"), **Codex is left unchanged.**

No code changes were made to `src/adapters/agents/codex.ts` or `src/adapters/agents/opencode.ts`, so no focused adapter tests were added for them (mission scope: focused coverage "where code changes").

**Required gates — both pass on the final tree:**
- `./scripts/verify-local.sh static-analysis`: ESLint clean, `tsc` typecheck clean, test-hygiene clean, test typecheck clean.
- `./scripts/verify-local.sh all`: 1949 tests, 1949 pass, 0 fail, 0 skipped.

Note: `./scripts/verify-local.sh all` initially failed on a **pre-existing** doc-drift test (`test/persistence-domain-mapping.test.ts`, SC1 "every invariant citation points at a line containing its anchor") unrelated to this mission — `src/domain/review.ts` `applyReviewerCommand` had moved from line 454 to 460. Fixed the one-line stale citation in `src/application/persistence-domain-map.ts` (commit `afb4b5d79`); the anchor now resolves at line 460. This reproduction failed at the mission parent `1465939fd`. The branch previously contained a commit mislabeled "chore: resolve pre-existing unmerged docs/agents.md" that silently reverted this mission's implementation and tests (touched zero docs files); that commit was removed from history so the net diff vs baseline `7ec5714a6` restores the fix and the reproduction tests.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Claude resume recognizes `No conversation found with session ID` alongside `Session not found` on stdout/stderr | `test/claude.test.ts`, tests `startClaudeAgent retries without --resume when spawn reports No conversation found with session ID` and `startClaudeAgent recognizes No conversation found on stdout too` | PASS |
| Stale marker deleted + same agent relaunched without `--resume` before any family selection | `test/claude.test.ts`, same tests assert `spawnCount === 2`, original `--resume`, `mockSessionPort.deleted`, fresh `result.status === 0` | PASS |
| Recognized stale-session resume never persists an `AgentBlock` | `test/agents-limit-hit.test.ts`, `shouldPersistLaunchFailureBlock returns false for Claude missing-session resume` | PASS |
| Codex/opencode diagnostics verified; only verified ones incorporated | `src/adapters/agents/opencode.ts:323` `Session not found` detector verified against live `opencode run --session does-not-exist-123` (exit 1), literal match, no change; Codex missing-session unverified offline per mission Stop Rule → left unchanged; no diff in either adapter confirmed by `./scripts/verify-local.sh integrate` | PASS |
| Red-to-green reproduction test present | `test/claude.test.ts` red at parent `1465939fd`, green after fix `afb4b5d79` | PASS |
| `./scripts/verify-local.sh static-analysis` passes | ESLint + `tsc` + test-hygiene clean | PASS |
| `./scripts/verify-local.sh all` passes | 1949 pass / 0 fail / 0 skipped | PASS |
| Mandatory integration gate ran | `./scripts/verify-local.sh integrate` (integration-suite + workflow + custom-agent-smoke) | PASS |

## Gates
- [x] `./scripts/verify-local.sh static-analysis` — PASS
- [x] `./scripts/verify-local.sh all` — PASS (1949 pass, 0 fail, 0 skipped)

## Next action
All checkpoints committed and both gates pass; hand off (do not push to `origin`; review remote is the sole push target for mission branches).
