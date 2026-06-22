# CP-2: Targeted fix — transient classifier + bounded in-family retry + telemetry test

## Summary

Applied the opencode-specific fix entirely inside the launcher
(`lib/agents/opencode.js`), leaving the agents.js reroute loop untouched
(Restricted Areas honored). Added regression tests via the existing injectable
I/O hooks.

### Code changes (`lib/agents/opencode.js`)

- Imported `detectLimitHit` (`lib/agents/opencode.js:4`) to reuse the existing
  limit-hit accounting and avoid double-handling.
- Added `TRANSIENT_OPENCODE_PATTERNS` (`lib/agents/opencode.js:62`) — network /
  5xx / overloaded signatures — and `HARD_OPENCODE_PATTERNS`
  (`lib/agents/opencode.js:84`) — model-not-found / auth.
- Added classifiers `isHardOpencodeFailure` (`lib/agents/opencode.js:97`),
  `isTransientOpencodeFailure` (`lib/agents/opencode.js:104`), and the gate
  `shouldRetryOpencodeFailure` (`lib/agents/opencode.js:114`). The gate retries
  **only** genuine non-zero exits with a transient signature; it short-circuits
  on spawn errors (ENOENT/EACCES), killing signals, recognized limit-hits (via
  `detectLimitHit`), and hard errors — so real failures still surface.
- Reworked `startOpencodeAgent` (`lib/agents/opencode.js:131`) with
  `runInvocationWithRetry` (`lib/agents/opencode.js:155`): a bounded loop capped by
  `maxTransientRetries` (default `1`) that re-runs the same invocation once on a
  transient failure, records `result.transientRetries`, and feeds the final
  result into the unchanged telemetry/session-id chain.
- Exported the three classifiers for unit testing
  (`lib/agents/opencode.js:211-213`).

The telemetry isolation guarantee (Scope: "Telemetry isolation guard") was
confirmed intact — `captureOpencodeExport` never rejects
(`lib/agents/opencode-export.js:18-19,39`) and the launcher's `try/catch` +
`.catch(() => result)` (`lib/agents/opencode.js:166-186`) absorb synchronous
throws and rejections — and is now locked in by tests.

### Tests (`test/opencode-retry.test.js`, new)

Eleven cases covering classification, bounded retry, no-mask-on-hard-failure,
and telemetry-status isolation.

## Goal Check

| Success criterion | Evidence (file:line / test) |
| --- | --- |
| 2. Recoverable conditions no longer generic failures | `shouldRetryOpencodeFailure` `lib/agents/opencode.js:114-129`; tests `shouldRetryOpencodeFailure retries a transient backend exit-1`, `startOpencodeAgent retries once on a transient failure then succeeds` (`test/opencode-retry.test.js:1`) |
| 3. Telemetry export cannot change launch status | `lib/agents/opencode.js:166-186`; tests `a throwing export capture leaves result.status unchanged`, `a rejecting export capture leaves result.status unchanged` |
| 4. Bounded mitigation, no masking | `runInvocationWithRetry` cap `maxTransientRetries=1` `lib/agents/opencode.js:155-164`; tests `retry is bounded — a persistently transient failure still surfaces`, `does NOT retry a hard model-not-found failure`, `does NOT retry a recognized limit-hit`, `does NOT retry a killing signal` |
| Restricted areas honored (no reroute-loop / other-launcher edits) | Only `lib/agents/opencode.js` + new `test/opencode-retry.test.js` changed |
| opencode + retry tests green | `node --test test/opencode-retry.test.js test/opencode*.test.js` → 57 pass, 0 fail |

Next action: In CP-3, confirm the backlog task label is exactly `["ai_sdlc"]`, run the full `npm test` suite and `./scripts/verify-local.sh docs` (if present), and record final Goal Check evidence.
