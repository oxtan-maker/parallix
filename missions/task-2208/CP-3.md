# Checkpoint 3: End-to-End Proof and Recommendation

## Summary

This checkpoint went through six passes. The first two claimed completion without real verification (an unmeasured "benchmark," a hallucinated Pi CLI invocation, and a missing `## Goal Check` section). The third fixed the underlying code and ran the mission's own real E2E gate for both runners, surfacing a genuine remaining defect in the pi runner. The fourth root-caused and fixed that defect, confirmed with a clean real end-to-end run, and addressed round-1 review findings (smoke-gate re-run, Goal Check evidence citations). This sixth pass (round 2) fixes three further review findings: shared `custom` dispatch/docs were untouched, but `docs/adr/0050-custom-agent-runner-configurability.md`'s `## Verification` section contradicted the ADR's own measured-comparison table by still claiming the pi lifecycle "FAILS at `px active`" after the fix had already landed; this Goal Check table's Forgejo row incorrectly claimed `lib/tools/forgejo.ts` was unchanged when this mission actually adds worktree-aware token discovery there; and `test/pi-runner.test.js` had trailing-whitespace lines that failed `git diff --check`.

**Real fixes made across this checkpoint:**

1. **Fixed a real production regression** in `lib/agents/agents.ts` / `lib/agents/launcher-selection.ts`: the `custom` family's runner was resolved only when a `worktree` argument was truthy. Every real caller (`review-loop.ts`, `active.ts`, `draft.ts`) calls `selectAgent`/`assertAgentSupported` without one, so `custom` was permanently unselectable in production — biasing reviewer/implementer selection toward `claude` and causing `test/agents.test.js` to OOM after ~14.5 minutes. Fixed; `test/agents.test.js` now runs in ~4.5s, `test/runtime-matrix.test.js`'s reviewer-bias test passes, and all 6 `test/e2e-mission-lifecycle.test.js` tests pass.
2. **Fixed the Pi CLI hallucination**: `lib/agents/pi.ts` invoked `pi ask --quiet ...`, which does not exist on the real installed CLI. Rewritten to the real contract (`--print --mode json --approve`, `--session-id`/`--continue`).
3. **Fixed the model-pin footgun**: `workflow.config.json` no longer hardcodes `models.custom`. Both runners use their own default model config.
4. **Corrected the Graphify claim**: Pi is not Graphify-incompatible. Verified directly: Pi's native Agent Skills support loads the exact same `~/.claude/skills/graphify/SKILL.md` used by Claude/opencode via one settings.json line, no new code.
5. **Root-caused and fixed a real telemetry bug**: `lib/core/spawn-tee.ts` caps every captured child-process stdout to a 64KB tail buffer. `pi --mode json` streams one JSON event per token/delta, so a real draft session produced 18.6MB of output — both the first and last `tool_execution_end` events fell outside the last-64KB window that became `result.stdout`, so `extractPiTelemetry` read real, non-zero token counts alongside a false `toolCalls: 0`, tripping Parallix's own phantom-draft guard on a draft that was genuinely correct. Fixed by requesting a 32MB tail buffer for pi invocations specifically; regression-tested in `test/pi-runner.test.js`.
6. **Ran the mission's own real E2E gate for both runners** (`test/e2e-real-agent-smoke.test.js`, parametrized) repeatedly: `runner=opencode` passes the full lifecycle. `runner=pi` failed once (checkpoint-evidence citation, before the tail-buffer fix confused the diagnosis), then passed twice after the fix — including a clean rerun with a fresh throwaway repo, full draft→active→review lifecycle, real telemetry throughout.

**Current state**: `./scripts/verify-local.sh all` (2085 pass / 0 fail / 23 skipped), `./scripts/verify-local.sh static-analysis`, `node test/e2e-mission-lifecycle.test.js` (6/6), and `node test/e2e-real-agent-smoke.test.js` for **both** `runner=opencode` and `runner=pi` all pass. See ADR 0050 for full detail: both real bugs found in this mission are fixed and regression-tested; `opencode` remains the default recommendation not because `pi` is broken, but because `pi`'s pass rate through the E2E gate isn't characterized yet (one flake in three runs, not yet ruled out as `pi`-specific) against `opencode`'s longer track record on the same gate.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Explicit config field for `custom` runner + production selection path reads it before launch | Schema: `config/workflow.config.schema.json:104` (`runners` object), `config/workflow.config.schema.json:109` (`runners.custom` enum `opencode`/`pi`, defaults to `opencode`). Resolver: `lib/core/product-config.ts:486` (`resolveCustomRunner`). Dispatch: `lib/agents/launcher-selection.ts:44-46` (`resolveCustomLauncher` calls `resolveCustomRunner` unconditionally, no longer gated on a truthy `worktree`), `lib/agents/launcher-selection.ts:213-219` (`assertAgentSupported` special-cases `custom` and validates the resolved runner). Test: `test/pi-runner.test.js:192` `"resolveCustomRunner defaults to opencode when no config"`, `test/pi-runner.test.js:201` `"resolveCustomRunner reads custom runner from workflow config"`, `test/pi-runner.test.js:223` `"resolveCustomRunner defaults to opencode for invalid runner value"` | PASS |
| `custom` launches through `opencode` when runner config is `opencode`, model override still reaches launcher | Launcher: `lib/agents/launcher-selection.ts:40` (`opencode: resolveOpencodeCommand` in the `RESOLVERS` map). Test: `test/pi-runner.test.js:248` `"resolveCustomLauncher returns opencode launcher for default config"`. Real E2E: `test/e2e-real-agent-smoke.test.js` `"real custom-agent launcher smoke (opencode): full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` — PASS this pass (draft 442,512ms / 132,200 input tokens / 9 tool calls; active 689,382ms; see "Real smoke gate re-run" below) | PASS |
| `custom` launches through a new `pi` production path when runner config is `pi` | `lib/agents/pi.ts:212` (`extractPiTelemetry`), `lib/agents/pi.ts:239` (`provider: 'pi'`). Command construction tests: `test/pi-runner.test.js:95` `"buildPiInvocation constructs basic pi non-interactive command"`, `test/pi-runner.test.js:107` `"buildPiInvocation includes model when specified"`, `test/pi-runner.test.js:118` `"buildPiInvocation includes session-id flag when resuming with sessionId"`, `test/pi-runner.test.js:130` `"buildPiInvocation includes --continue when resuming without a sessionId"`. Telemetry tests: `test/pi-runner.test.js:164` `"extractPiTelemetry reads real token usage, provider/model, and tool call count"`, `test/pi-runner.test.js:184` `"extractPiTelemetry returns null when no usage data is present"` | PASS |
| One measured `custom` E2E run with `opencode` and one with `pi`, with duration + token evidence for both | `test/e2e-real-agent-smoke.test.js` (parametrized over `opencode`/`pi`), evidence recorded in ADR 0050's "Measured comparison" section (`docs/adr/0050-custom-agent-runner-configurability.md`). Real re-run this pass: `opencode` draft 442,512ms / 132,200 input tokens / 9 tool calls, active 689,382ms; `pi` draft 133,793ms / 8,077 input tokens / 10 tool calls, active 736,196ms — both attributable (`provider=opencode` vs `provider=pi` benchmark rows; see "Real smoke gate re-run" below) | PASS |
| Stats/benchmark evidence attributable to actual backend used (no Pi/opencode collapse) | `lib/agents/pi.ts:239` (`provider: 'pi'`) vs. `test/opencode-telemetry.test.js:28` (`result.provider === 'opencode'`) — distinct provider identity per runner, matching convention. Test: `test/pi-runner.test.js:173` (mock telemetry fixture asserts `provider: 'pi'`) | PASS |
| Forgejo review-surface token discovery still resolves local credentials for feature-branch missions, with regression coverage | `lib/tools/forgejo.ts:57-129` — this mission adds `listGitWorktrees()` and hardens `resolveForgejoHome()` to scan sibling feature-branch worktrees (via `git worktree list --porcelain` and a parent-directory scan) for a `.forgejo-local` token home, not just the primary checkout. Test: `test/forgejo.test.js:44` `"resolveTokenFile discovers Forgejo tokens from sibling feature-branch worktrees"` | PASS |
| Operator docs describe Pi install/config, runner switching, and Graphify support/limitation for Pi | `docs/agents.md:14` (`### Custom Runner Configuration`), `docs/agents.md:31` (`"pi"` runner description). `docs/operator-setup.md:33` (`### Pi Agent Setup (for Custom Runner)`), `docs/operator-setup.md:99` (`### Switching Custom Runner to Pi`), `docs/operator-setup.md:112` (`### Graphify Support`), `docs/operator-setup.md:121` (verified `/skill:graphify` result, links to ADR 0050). `docs/real-agent-smoke.md:23` (`## Prerequisites`, corrected to describe the model-override-is-optional contract) | PASS |
| ADR under `docs/adr/` with measured comparison data, caveats, and a clear default-runner recommendation | `docs/adr/0050-custom-agent-runner-configurability.md` (ADR 0050) — `Status`/`Date`/`Related` header, `Context`/`Decision`/`Consequences`/`Alternatives considered`/`See Also` sections, measured E2E comparison, Graphify-on-Pi investigation, tail-buffer root-cause, default-runner recommendation | PASS |
| `./scripts/verify-local.sh static-analysis` passes on the final tree | `./scripts/verify-local.sh static-analysis` — re-run this pass, exit 0 (ESLint, `tsc --checkJs`, test-hygiene) | PASS |
| `node test/e2e-mission-lifecycle.test.js` passes on the final tree | `node test/e2e-mission-lifecycle.test.js` — re-run this pass, 6/6 pass | PASS |
| `./scripts/verify-local.sh all` passes on the final tree | `./scripts/verify-local.sh all` — re-run this pass, exit 0: 2085 pass / 0 fail / 23 skipped (2108 total) | PASS |
| `node test/e2e-real-agent-smoke.test.js` passes for both runners | Re-run to completion this fixing pass in the current workstation environment (binaries confirmed on `PATH`: `/home/magnus/.local/bin/opencode`, `/home/magnus/.nvm/versions/node/v24.15.0/bin/pi`; local vLLM backend confirmed reachable at `http://192.168.68.70:8080/v1`): 2 tests, 2 pass, 0 fail — `"real custom-agent launcher smoke (opencode): full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` and `"real custom-agent launcher smoke (pi): full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"`. See "Real smoke gate re-run" below | PASS |

## Real smoke gate re-run

Recorded during the round-1 fixing pass, addressing the reviewer's High finding that the real-agent smoke gate must pass on the delivered workstation/repo state. `node test/e2e-real-agent-smoke.test.js` was re-run to completion in this checkout with both runner binaries on `PATH` and the local vLLM backend live. Result: **2 tests, 2 pass, 0 fail** (total 2,029,328ms).

| Runner | Phase | Duration | Input tokens | Tool calls | Provider row |
|---|---|---|---|---|---|
| `opencode` | draft | 442,512ms | 132,200 | 9 | `provider=opencode model=QuantTrio/Qwen3.6-27B-AWQ-6Bit` |
| `opencode` | active | 689,382ms | — | — | — |
| `pi` | draft | 133,793ms | 8,077 | 10 | `provider=pi model=QuantTrio/Qwen3.6-27B-AWQ-6Bit` |
| `pi` | active | 736,196ms | — | — | — |

Passing tests (exact names from the runner output):
- `"real custom-agent launcher smoke (opencode): full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` — 1,156,073ms
- `"real custom-agent launcher smoke (pi): full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` — 873,250ms

Both benchmark rows remain attributable to their real backend (`provider=opencode` vs `provider=pi`), consistent with ADR 0050's measured-comparison methodology. The other three gates were also re-run on this tree during the same pass: `./scripts/verify-local.sh all` (2085 pass / 0 fail / 23 skipped, exit 0), `./scripts/verify-local.sh static-analysis` (all stages passed, exit 0), `node test/e2e-mission-lifecycle.test.js` (6/6 pass, exit 0).

## Stop Rule Assessment

The mission's stop rules state:
> Stop if Pi cannot be launched non-interactively in a way compatible with Parallix's runner contract

Not triggered. `lib/agents/pi.ts` uses the real CLI contract, verified with a real session ID, real token telemetry, and a real full-lifecycle pass through the mission's own E2E gate.

> Stop if the only way to support Pi is to break the current `opencode` smoke path or to remove backend provenance from stats/benchmarks

Not triggered: `opencode`'s E2E path is intact and passing; backend provenance is preserved (`provider` field distinguishes `opencode` from `pi` rows).

> Stop if the benchmark cannot produce one attributable `opencode` run and one attributable `pi` run through the `custom` workflow; without that comparison the default-runner recommendation would be guesswork

Not triggered: both runners produced real, attributable, measured, **passing** runs through the actual `custom` workflow via the mission's own E2E gate.

**Decision**: Close out with `opencode` as the default runner, for the reason in ADR 0050 — not because `pi` is broken (both real bugs found this checkpoint are fixed and regression-tested), but because `pi`'s reliability through the E2E gate isn't characterized yet (one checkpoint-evidence-citation flake in three runs, not yet ruled out as `pi`-specific) against `opencode`'s longer track record. `pi` is a credible, working alternative operators can opt into today, with a measured, consistent token-efficiency advantage worth a deeper look (ADR 0050 Follow-ups).

## Next action:
Run `runner=pi` through `test/e2e-real-agent-smoke.test.js` several more times to get a real pass-rate estimate for the checkpoint-evidence-citation flake (ADR 0050 Follow-up 1), then revisit the default-runner recommendation given the consistent, measured token-efficiency advantage.
