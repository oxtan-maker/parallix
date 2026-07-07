# CP-5: Run verification gates

## Work Done

Ran the required verification gates on the final tree and captured evidence for the final goal-check handoff, including direct instrumented execution of the corrected real-agent smoke test (22 runs total across the debugging campaign, 5 runs against the final harness).

### Root causes found and fixed during takeover (2026-07-07)

1. **Stale `PWD` broke the launcher child (the earlier `wal_checkpoint`/hang mystery)**: `opencode` trusts the inherited `PWD` over the real cwd for project resolution. The test child inherited `PWD` pointing at the primary parallix repo, so the launcher attached to the wrong project — colliding with concurrent opencode sessions (SQLite WAL contention) and hanging at exit until SIGTERM. Bisected empirically over the full environment: with stale `PWD` the probe hangs 100%; with `PWD` deleted it exits in ~2.7s. Fix: the harness deletes `PWD` from the child env (test/e2e-real-agent-smoke.test.js:423-429).
2. **binDir-only `PATH` broke the agent's own tooling**: opencode's glob tool could not extract its bundled ripgrep (`spawn tar` → ENOENT), feeding the model artificial tool errors that destabilized drafts (verified from the opencode session DB). Fix: binDir stays first (real-opencode guarantee) with the normal system PATH appended (test/e2e-real-agent-smoke.test.js:410-421).
3. **Assertion bugs**: hello-world check was case-sensitive and missed "Hello, World!" (comma). Fixed with a case/punctuation-insensitive regex (test/e2e-real-agent-smoke.test.js:502).
4. **Incomplete hand-rolled backlog**: no `backlog/config.yml`, no standard directory skeleton, and the backlog CLI dirtied the committed tree mid-draft by normalizing the missing `default_port` key (draft's repo-state preflight then failed). The hand-rolled backlog is now equivalent to `backlog init` + `backlog task create` output and verified compatible with the real `backlog` CLI (test/e2e-real-agent-smoke.test.js:193-231).
5. **Hallucinated declared gates**: drafted missions declare gates the workflow executes literally, and small models write prose there. The throwaway repo now ships a no-op `scripts/verify-local.sh`, and the harness performs the operator-refinement step (pin `## Gates` to the runnable gate, commit) after all raw-draft assertions pass (test/e2e-real-agent-smoke.test.js:583-599).
6. **Reviewer escape to expensive agents**: reviewer auto-derivation could select claude/codex. The isolated `PARALLIX_HOME/agents.local.json` now blocks every family except `custom`, forcing the single-family fallback — `custom` reviews its own PR — asserted strictly (test/e2e-real-agent-smoke.test.js:232-247,629-634).
7. **Active-phase timeout fairness**: one `px active` covers up to three sequential model sessions (execute, repair relaunch, review loop); it now gets 2× the single-session budget after a run was killed mid-recovery (test/e2e-real-agent-smoke.test.js:34-40).

### Direct smoke-gate execution (final harness, 2026-07-07)

| Run | Result | Time | Failure mode |
|-----|--------|------|--------------|
| 18 | PASS | 242s | — (full lifecycle green, first ever) |
| 19 | PASS | 161s | — |
| 20 | FAIL | 648s | Execute agent produced a final checkpoint with an empty Goal Check table; the (correct) repair relaunch was killed by the then-600s active budget — budget since doubled |
| 21 | PASS | 301s | — |
| 22 | FAIL | 376s | Execute agent left `hello.sh` uncommitted; handoff auto-commit safety correctly refuses non-mission paths |

Green runs complete the entire `draft -> refine -> active (execute + review loop) -> APPROVED` lifecycle in **161–301s**. Both failures are Qwen3.6-35B process-compliance misses that Parallix's fail-closed gates correctly rejected — not harness or product defects. **Residual gate flakiness ≈ 40% on this model** (see Stop-rule note below).

### Gate: `./scripts/verify-local.sh all`

**Result**: PASS — 2043 tests, 2021 passed, 0 failed, 22 skipped, ~12.6s. Note this harness (test/run-default-tests.js:10) intentionally excludes `e2e-real-agent-smoke.test.js`; the smoke gate itself was exercised directly as tabled above.

### Gate: `./scripts/verify-local.sh static-analysis`

Not required: no `lib/` files modified by this mission (mission-touched files: `test/e2e-real-agent-smoke.test.js`, `docs/real-agent-smoke.md`, `missions/task-2201/*`).

### Additional checks

- `node --check test/e2e-real-agent-smoke.test.js` — PASS
- `npx --yes eslint test/e2e-real-agent-smoke.test.js` — PASS
- `bash scripts/test-hygiene.sh` — PASS
- `backlog task list --plain` against a replica of the hand-rolled throwaway backlog — PASS (lists TASK-9001; no config normalization diff)

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Reproduction test exists and encodes lifecycle behavior | `test/e2e-real-agent-smoke.test.js:390` single full-lifecycle test; fails on parent commit (parent stops after draft) | PASS |
| Corrected path drives full lifecycle, not just draft | draft (:458), refine (:590-599), active + autostarted review loop (:605) | PASS |
| Assertions prove each phase transition | draft (:462-472), MISSION.md parseable (:475-499), active (:606-615), review APPROVED + phase approved (:636-648), CP-1.md (:657-661) | PASS |
| Hello-world shell task used and verified | setup task "Create a .sh hello world program" (:288), MISSION.md assertion (:502-506) | PASS |
| CLI-under-test provenance | CLI_ENTRY existence + px.js check (:435-443) | PASS |
| Launcher health probe | real `opencode run` probe with repo-configured model before lifecycle (:181-200,448-456) | PASS |
| Telemetry isolation inputs (config route) | temp-scoped `PARALLIX_HOME` covers stats.csv + agents.local.json (:401-421) | PASS |
| Telemetry isolation outputs | stats.csv exists in isolated home with expected content (:541-550) | PASS |
| No writes escape to default state roots | delta-based leak check against pre-run snapshots for stats.csv and agents.local.json in both default homes (:556-578) | PASS |
| Reviewer forcing asserted | blocklist forces single-family fallback; `reviewer === "custom"` asserted strictly (:232-247,629-634) | PASS |
| Custom-model config sourced from repo config | `CUSTOM_MODEL` read from this repo's workflow.config.json (:26-33), written into throwaway repo (:294) | PASS |
| Three failure buckets preserved | LAUNCHER_FAILURE_PATTERNS / MODEL_UNAVAILABLE_PATTERNS / classifyFailure (:120-166) | PASS |
| Docs shape preserved and updated | `docs/real-agent-smoke.md`: prerequisites, invocation, runtime (measured), lifecycle incl. refinement step, failure buckets, reviewer forcing | PASS |
| Blocking gate registration preserved | `config/integration-pipelines.json:18-22` `custom-agent-smoke` unchanged | PASS |
| `./scripts/verify-local.sh all` on final tree | 2021 pass / 0 fail | PASS |
| static-analysis | not required (no lib/ changes) | PASS (N/A) |
| Smoke test works end-to-end, time reported | 3 green full-lifecycle runs at 161s/242s/301s | PASS |
| Smoke test not flaky | 3/5 green on final harness; residual ~40% flake is model process-compliance, not harness/product | **FAIL — stop rule** |

## Stop-rule note (mission scope line: "If the agent is flaky against the harness stop")

All identified harness defects are fixed and every remaining red run is the repo-configured local model (Qwen3.6-35B-A3B-AWQ-4bit) failing Parallix's own process contract in ways Parallix correctly rejects (empty goal-check evidence; uncommitted implementation files). The corrected test is a faithful blocking gate: deterministic for the TASK-1351/TASK-1273 regression classes it exists to catch (those fail every run, immediately), but subject to ~40% upstream model flake in the post-draft phases. Options surfaced to the operator: accept red-retry operation, split the blocking scope to the deterministic draft surface with full lifecycle on-demand, or pin a stronger custom model. Decision intentionally left to the operator; not traded silently per the mission's stop rules.

## DOD Verification

| DOD Criterion | Evidence | Status |
|---------------|----------|--------|
| Verification gate ran and passed on final tree with captured proof | `./scripts/verify-local.sh all` PASS (2021/0); smoke gate exercised directly with run table above (3 green full-lifecycle runs) | PASS (with stop-rule note) |
| Lint and static analysis clean on changed files | eslint + node --check + test-hygiene all PASS | PASS |
| No focused or unannotated skipped tests | no .only / bare .skip introduced | PASS |
| Final checkpoint cites real evidence | this document (file:line refs against the final tree) | PASS |
| Docs updated | `docs/real-agent-smoke.md` rewritten to match corrected flow, runtimes, isolation, reviewer forcing | PASS |
| Bug mission includes red-to-green reproduction | test fails on parent commit (lifecycle absent) and passes on the corrected tree (runs 18/19/21) | PASS |

## Next action

Hand off for review round 6 with the corrected harness, measured runtimes, and the explicit stop-rule decision on residual model flakiness left to the operator.
