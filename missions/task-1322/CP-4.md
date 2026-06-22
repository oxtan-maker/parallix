# CP-4: All Existing Tests Pass — No Regressions

## Work Summary

Verified all success criteria from the mission contract:

1. **Opencode stale-session detection**: `startOpencodeAgent` detects "Session not found" in stderr/stdout, clears marker, retries without `-s`. Verified by unit tests in `test/opencode.test.js`.

2. **Claude stale-session detection**: Same pattern in `startClaudeAgent`. Verified by unit tests in `test/claude.test.js`.

3. **Codex stale-session detection**: Same pattern in `startCodexDraftAgent`. Verified by unit tests in `test/codex.test.js`.

4. **No regression on healthy resumes**: All existing resume tests still pass. The `-s`/`--resume`/`exec resume` flags are still used when the session is valid.

5. **All existing tests pass**: `npm test` completes with 0 failures (1566 pass, 22 skipped — pre-existing skips).

6. **Gates verified**: `npm test` passes with 0 failures. The mission's templated `./scripts/verify-local.sh docs` gate does not apply to this repo — `verify-local.sh` exists only in the `visualBoard` repos, not `parallix` (README.md:83 documents that repos without it declare their own command; task-1311's review accepted `npm test` as the documented substitute). `npm test` is therefore the effective gate and it passes.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| SC1: Opencode detects "Session not found" in stderr, clears marker, retries without `-s` | Impl `lib/agents/opencode.js:91-104` (`staleSessionHandler`); Test `startOpencodeAgent retries without -s when spawn returns "Session not found" in stderr` (test/opencode.test.js:92) — asserts spawnCount===2, clearSession called, result.status===0 | PASS |
| SC1: Opencode detects "Session not found" in stdout | Test `startOpencodeAgent retries without -s when "Session not found" appears in stdout` (test/opencode.test.js:142) — asserts spawnCount===2 on stdout detection | PASS |
| SC2: Claude detects "Session not found", clears marker, retries without `--resume` | Impl `lib/agents/claude.js:108` (`staleSessionHandler`); Test `startClaudeAgent retries without --resume when spawn returns "Session not found"` (test/claude.test.js:234) — asserts spawnCount===2, clearSession called, result.status===0 | PASS |
| SC3: Codex detects "Session not found", clears marker, retries without `exec resume` | Impl `lib/agents/codex.js:115` (`staleSessionHandler`); Test `startCodexDraftAgent retries without exec resume when spawn returns "Session not found"` (test/codex.test.js:185) — asserts spawnCount===2, clearSession called, result.status===0 | PASS |
| SC4: No regression — opencode healthy resume still uses `-s`, no marker clear | Test `startOpencodeAgent healthy resume still uses -s flag` (test/opencode.test.js:196) — asserts args.includes('-s'), spawnCount===1, result.status===0 | PASS |
| SC4: No regression — claude healthy resume still uses `--resume` | Test `startClaudeAgent healthy resume still uses --resume flag` (test/claude.test.js:285) — asserts args.includes('--resume'), spawnCount===1, result.status===0 | PASS |
| SC4: No regression — codex healthy resume still uses `exec resume` | Test `startCodexDraftAgent healthy resume still uses exec resume` (test/codex.test.js:235) — asserts args.includes('exec') && args.includes('resume'), spawnCount===1 | PASS |
| SC4: No retry when resume=false (all three launchers) | Tests `... does NOT retry when resume is false` (test/opencode.test.js:172, test/claude.test.js:264, test/codex.test.js:214) — assert spawnCount===1 | PASS |
| SC5: All existing tests pass | `npm test` → pass 1566, fail 0, skipped 22 (pre-existing) | PASS |
| Gate: npm test | `npm test` exits 0 with 0 failures | PASS |
| Gate: verify-local.sh docs | N/A in parallix — `verify-local.sh` is a visualBoard-only script (README.md:83); `npm test` is the accepted substitute per task-1311 review | N/A |

## Next action: Hand off to review — all mission gates pass, all checkpoint documents created.
