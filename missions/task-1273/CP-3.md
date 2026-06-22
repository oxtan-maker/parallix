# CP-3: Label, full suite, and final verification

## Summary

Confirmed the backlog task label, ran the complete test suite, and validated the
docs gate. All six success criteria are met.

- **Label**: `backlog/tasks/task-1273 - qwen-draft-bug.md:8-9` frontmatter is
  exactly `labels:\n  - ai_sdlc` (one label, `ai_sdlc`). The `assignee` field
  is `[qwen]` (as originally set; no Restricted Areas violation since the
  Restricted Areas rule prohibits the implementer from modifying the assignee
  field — this was set by the workflow harness).
- **Full suite**: `npm test` → 1594 pass, 0 fail, 22 skipped.

### Round-1 review follow-up (REQUEST_CHANGES → resolved)

Reviewer finding F4 asked for direct unit tests on the exported classifiers
`isTransientOpencodeFailure` and `isHardOpencodeFailure`, which were previously
only exercised indirectly via `shouldRetryOpencodeFailure`. Added 6 direct test
blocks in `test/opencode-retry.test.js` (transient signatures incl. stdout,
non-transient/empty/null; hard model-not-found/auth signatures, ENOENT/EACCES,
non-hard/empty/null). `test/opencode-retry.test.js` now has 23 passing blocks.

### Round-5 review follow-up (REQUEST_CHANGES → resolved)

- **F1 (High)**: Plain 429 throttling now classified as a **limit-hit** for qwen
  via `/\b429\b/i` added to qwen patterns at
  `lib/agents/limit-hit.js:25`; `detectLimitHit({ agent: 'qwen', status: 1,
  stderr: '429 Too Many Requests' })` returns a truthy result. `shouldRetryOpencodeFailure`
  returns `false` (limit-hit takes priority over transient). Removed the
  redundant `/\b429\b/i` and `/\b429\b[^\n]*?(?:too many requests|rate limit|throttl)/i`
  from transient patterns at `lib/agents/opencode.js:75-76` since all qwen 429s
  are now owned by limit-hit detection. Tests at
  `test/opencode-retry.test.js:70-126` confirm 429 classification and behavior.
- **F2 (High)**: Unrelated diff noise (`.gitignore`, `workflow.config.json`,
  `task-1319`, `task-1330`) restored/deleted from branch. `.gitignore` and
  `workflow.config.json` restored to main via `git checkout main --`.
  `task-1319` and `task-1330` deleted from working tree and staged for removal.
- **F3 (Medium)**: Added in-family regression tests at
  `test/opencode-retry.test.js:240-268` that verify plain 429 throttling stays
  in-family via `detectLimitHit` classification (not generic reroute) and
  persistent 429 surfaces correctly at the `agents.js` `launchFailed` boundary.
- **F4 (Medium)**: CP-3 Goal Check refreshed with real, current evidence
  (accurate file:line citations and current test count).
- **F5 (Low)**: Pushed back — `AGENTS.md` and `px` CLI are pre-existing
  infrastructure gaps in this checkout, not introduced by this branch.

- **Docs gate**: `./scripts/verify-local.sh` is not present in this repo, so the
  conditional gate ("if present") is satisfied as N/A.

## Root cause (recorded — criterion 1)

Intermittent qwen `exit 1` failures originate from the **opencode CLI exiting
non-zero on transient qwen/vLLM backend errors** (network blips, HTTP
502/503/504/529, overloaded, 429 throttling), which the narrow qwen limit-hit
patterns (`lib/agents/limit-hit.js:23-28`) did not match for plain 429 responses,
so they fell straight into the generic `launchFailed` reroute
(`lib/agents/agents.js:803-824`) with no in-family retry. The opencode launcher
(`lib/agents/opencode.js`) now classifies these as transient and retries once
in-family before `agents.js` sees the result. For 429 specifically, the fix
classifies it as a limit-hit (preventing generic reroute) rather than transient
retry. Full trace in `CP-1.md`. Fix: opencode-specific transient classifier +
single bounded in-family retry in the launcher (`CP-2.md`) + plain 429 limit-hit
classification (`CP-3.md` round-5 fix).

## Goal Check

| # | Success criterion | Evidence (file:line / test name) |
| --- | --- | --- |
| 1 | Root cause documented with code path | `CP-1.md`; origin at `lib/agents/agents.js:803-824` (launchFailed reroute) + narrow qwen patterns `lib/agents/limit-hit.js:23-28`; opencode CLI exit at `lib/core/spawn-tee.js:85,105,163` |
| 2 | Recoverable conditions no longer generic failures | `detectLimitHit` `lib/agents/limit-hit.js:177-230`; `shouldRetryOpencodeFailure` `lib/agents/opencode.js:117-132`; `isTransientOpencodeFailure` `lib/agents/opencode.js:107-111`; tests `shouldRetryOpencodeFailure retries a transient backend exit-1` (`test/opencode-retry.test.js:128`), `startOpencodeAgent retries once on a transient failure then succeeds` (`test/opencode-retry.test.js:167`), `startOpencodeAgent: plain 429 throttling stays in-family via limit-hit detection` (`test/opencode-retry.test.js:240`), `detectLimitHit classifies plain 429 as a limit-hit for qwen` (`test/opencode-retry.test.js:89`) |
| 3 | Telemetry export cannot change launch status | `lib/agents/opencode.js:169-188`; tests `a throwing export capture leaves result.status unchanged` (`test/opencode-retry.test.js:216`), `a rejecting export capture leaves result.status unchanged` (`test/opencode-retry.test.js:227`) |
| 4 | Bounded mitigation, no masking | `runInvocationWithRetry` bounded by `maxTransientRetries=1` `lib/agents/opencode.js:158-167`; tests `startOpencodeAgent retry is bounded` (`test/opencode-retry.test.js:184`), `does NOT retry a hard model-not-found failure` (`test/opencode-retry.test.js:199`), `does NOT retry a recognized limit-hit` (`test/opencode-retry.test.js:154`), `does NOT retry a killing signal` (`test/opencode-retry.test.js:161`) |
| 5 | Label set to `ai_sdlc` | `backlog/tasks/task-1273 - qwen-draft-bug.md:8-9` → `labels: [ai_sdlc]` (exactly one) |
| 6 | `npm test` passes | `npm test` → 1594 pass, 0 fail, 22 skipped |

## Gates

- [x] All 6 success criteria verified (see table above).
- [x] `npm test` passes with 0 failures (1594 pass / 0 fail / 22 skipped).
- [x] `./scripts/verify-local.sh docs` — N/A (script not present; gate is conditional on presence).
