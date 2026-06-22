# CP-1: Reproduce / characterize the qwen (opencode) `exit 1` failures

## Summary

Traced the full launch path for the qwen/opencode agent and identified where the
intermittent `exit 1` originates and why it is misclassified.

### Trace: `startOpencodeAgent` → `spawnAndTee` → `launchFailed`

1. `startOpencodeAgent` (`lib/agents/opencode.js:131`) builds the invocation
    `opencode run --pure --dangerously-skip-permissions [...]`
    (`buildOpencodeInvocation`, `lib/agents/opencode.js:34`) and calls
    `_spawnAndTee` (`lib/agents/opencode.js:152`).
2. `spawnAndTee` (`lib/core/spawn-tee.js:54`) resolves on the child `close`
   event with `{ status, signal, stdout, stderr, error }`, where `status` is the
   raw child exit code (`lib/core/spawn-tee.js:161-168`). For an opencode CLI
   that prints an error and exits 1, this yields `status: 1`.
3. Back in the reroute loop, the awaited result
   (`lib/agents/agents.js:744`) flows through three checks:
   - `detectLimitHit` (`lib/agents/agents.js:751`), whose qwen patterns are
     **narrow** — only `rate/usage/quota limit reached|exceeded`,
     `429 … rate/quota/usage`, and `insufficient quota`
      (`lib/agents/limit-hit.js:23-27`).
   - the ENOENT/EACCES spawn-failure reroute (`lib/agents/agents.js:783`).
   - the generic `launchFailed` branch
     (`lib/agents/agents.js:801-823`): `status !== null && status !== 0` →
     logs `Agent qwen (opencode) failed to complete (exit 1 …); retrying with
     next eligible agent.` at `lib/agents/agents.js:811` and **reroutes to a
     different agent family with no in-family retry of qwen.**

### Where exit-1 comes from (the three candidate origins from Scope)

- **(a) opencode CLI transient backend errors — the avoidable, intermittent
  cause.** The qwen/vLLM backend surfaces network/API blips
  (`ECONNRESET`, `ETIMEDOUT`, `socket hang up`, `fetch failed`, HTTP
  `502/503/504/529`, "overloaded", "service unavailable") as a non-zero
  opencode exit. None of these match the narrow qwen limit-hit patterns
   (`lib/agents/limit-hit.js:23-27`), so they fall straight into `launchFailed`
  (`lib/agents/agents.js:801`) and waste the qwen attempt by rerouting. This is
  non-deterministic — exactly matching the reported "same task succeeds on a
  later attempt" symptom.
- **(b) launcher misclassification.** There is **no** in-family retry for a
  transient opencode exit; every non-zero exit that isn't a recognized limit-hit
  is treated as a hard, generic failure-and-reroute
  (`lib/agents/agents.js:804-823`).
- **(c) telemetry export leakage — already guarded, but only implicitly.**
  `captureOpencodeExport` is documented and coded to *never reject*
  (`lib/agents/opencode-export.js:18-19,39`), and the launcher wraps it in a
  synchronous `try/catch` plus a `.catch(() => result)`
  (`lib/agents/opencode.js:166-186`). So telemetry cannot change `result.status`
  today — locked in by regression tests in `test/opencode-retry.test.js`.

## Conclusion / root cause

The avoidable `exit 1` is **transient qwen/vLLM backend errors misclassified as
a generic launch failure with no in-family retry** (origin (a) + (b)). Genuine
hard failures (model-not-found, ENOENT/EACCES) and true limit-hits are correctly
surfaced/handled and must stay that way. The telemetry path (c) is already
isolated but untested.

## Goal Check

| Mission item | Evidence |
| --- | --- |
| Trace `startOpencodeAgent` → `spawnAndTee` → `launchFailed` | `lib/agents/opencode.js:131,152`; `lib/core/spawn-tee.js:54,161-168`; `lib/agents/agents.js:744,751,783,801-823` |
| Identify exit-1 origin (CLI / classifier / telemetry) | Origin (a) CLI transient + (b) no in-family retry; narrow qwen patterns at `lib/agents/limit-hit.js:23-27` |
| Confirm telemetry cannot change status | `lib/agents/opencode-export.js:18-19,39`; `lib/agents/opencode.js:166-186` (guarded; locked by regression test) |
| Baseline tests green before changes | `node --test test/opencode*.test.js` → 47 pass, 0 fail |

Next action: In CP-2, add an opencode-specific transient-failure classifier and a single bounded in-family retry inside `startOpencodeAgent` (excluding limit-hits via `detectLimitHit` and hard errors model-not-found/ENOENT/EACCES), plus regression tests for retry, no-mask-on-hard-failure, and telemetry-status isolation.
