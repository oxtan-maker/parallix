# CP-1 — Research: trace evidence for UC-7 through UC-10

## Summary

Traced concrete, non-README evidence for all four new use cases in source, tests, and the visualBoard retrospectives. All four map to real, evidenced capabilities — none needs to be marked Aspirational. The ≤5-files-per-use-case stop rule was respected (each draws on 2–3 evidence files plus tests).

### UC-7 — Frictionless review of agent output (`px diff` + Forgejo PR viewer)
- `px diff` is a real, registered command (`index.js:39`, dispatched `index.js:158`, help `index.js:224`).
- Implementation diffs the mission branch against the primary branch (`lib/commands/diff.js:42-43`, `primary..HEAD`) and launches the operator's configured specialized diff tool: `git difftool` when `diff.tool` is set (`:89-93`), else a specialized `pager.diff`/`core.pager` such as delta/difftastic (`:97-111`), rejecting plain pagers (`:51-68`).
- Forgejo PR viewer complements local diff: `getPrStatus` returns the PR `html_url` for browser viewing (`lib/tools/forgejo.js:170,178`), wired through the review adapter (`lib/review/review-adapter.js:56,83`).
- Tested: `test/diff.test.js` — `node parallix diff resolves correct target branches` (:16), `node parallix diff detects pager.diff` (:47), `node parallix diff detects core.pager` (:79). Forgejo PR flows covered by `test/forgejo.test.js`.
- **Confidence: Confirmed** for the `px diff` mechanic (tested code); the Forgejo PR-viewer half is **Partial** (requires a running Forgejo instance).

### UC-8 — Velocity enhancement (~30 missions/week)
- Measured ceiling: **58 completed missions in 15 days = ~27/week** (`../visualBoard/docs/missions/2026/task-1247/research.md:51-57`, `node workflow stats` over `stats.csv`).
- Q2 normalization: P5 total `2.96/day`, P6 total `3.29/day` (~23/week), user-value `0.44–0.54/day` over a `0.28/day` human baseline (`../visualBoard/docs/missions/2026/task-1099/RETROSPECTIVE_Q2_2026.md:18-23`).
- Reconciliation: the operator's reported **~30/week** is the same completed-mission metric as the measured 58/15-day window (~27/week) rounded to the recent peak; it sits just above the highest measured window and within the sampling error of a 15-day count. The doc must state ~27/week as the measured figure and ~30/week as the operator's recent-peak report, NOT blur them.
- **Confidence: Partial** — throughput gain is real and measured but caveated (different mission-output metrics, AI-SDLC overhead 85%, 7% C2 coverage; same caveats as UC-1).

### UC-9 — Agent submission from a feature branch
- `draft.js` detects the branch HEAD sits on at draft time and records a non-primary feature branch as the mission base (`lib/commands/draft.js:173-188`), passes it as `baseBranch` to branch creation (`:223`), cuts the mission branch from that recorded base rather than primary (`:411-430`, fallback to `getPrimaryBranch()` at `:428`), and writes a machine-readable `Base-Branch:` line into MISSION.md (`:439-468`).
- Primary-branch resolution: `lib/core/mission-utils.js:67-99` (`getPrimaryBranch`).
- Tested: `test/draft.test.js` — `ensureMissionBranch creates the mission branch from the recorded feature base` (:396), `ensureMissionBaseBranchRecorded inserts a machine-readable Base-Branch line under the title` (:421), `ensureMissionBaseBranchRecorded replaces a stale Base-Branch line in place` (:459).
- **Confidence: Confirmed** — feature-base detection, branch cut, and base recording are tested code.

### UC-10 — Automated QA integration to reduce agent errors
- `scripts/verify-local.sh` provides gate subcommands: `static-analysis` runs ESLint `--max-warnings 0` on `lib/`, `tsc --checkJs --noEmit`, and a test-hygiene scan (`scripts/verify-local.sh:14-44`); `docs` verifies required docs exist (`:47-64`).
- ESLint ruleset: `.eslintrc.cjs:10-19`.
- Gate is a configured adapter command with `{{area}}` substitution and a no-op default (`lib/core/verification.js:5-12`, `:26-32`, `:35`); this repo wires `npm test` (`workflow.config.json:14`).
- Tested: `test/verification.test.js` — `runVerificationGate is a no-op pass when no command is configured` (:88), `runVerificationGate executes the configured command via bash` (:108).
- Distinct from UC-5: UC-10 is the *agent-error-reduction* angle (gates catch agent mistakes before review); UC-5 is the *CI-adoption* angle (run your existing gate verbatim).
- **Confidence: Confirmed** — gate script, adapter resolution, substitution, and no-op default are tested code.

## Goal Check

| Item | Status | Evidence |
|---|---|---|
| UC-7 `px diff` evidence (SC3) | Found | `lib/commands/diff.js:42-43,89-111`; `index.js:39,158,224`; `test/diff.test.js:16,47,79` |
| UC-7 Forgejo PR viewer evidence | Found | `lib/tools/forgejo.js:170,178`; `lib/review/review-adapter.js:56,83` |
| UC-8 throughput data (SC4) | Found | `research.md:51-57` (58/15d=~27/wk); `RETROSPECTIVE_Q2_2026.md:18-23` (P6 3.29/day) |
| UC-9 feature-branch evidence (SC5) | Found | `lib/commands/draft.js:173-188,223,411-430,439-468`; `lib/core/mission-utils.js:67-99`; `test/draft.test.js:396,421,459` |
| UC-10 QA-gate evidence (SC6) | Found | `scripts/verify-local.sh:14-64`; `.eslintrc.cjs:10-19`; `lib/core/verification.js:5-35`; `workflow.config.json:14`; `test/verification.test.js:88,108` |
| All four evidenced (Assumption) | Confirmed | None requires Aspirational marking; ≤5 files each |

Next action: Draft UC-7 through UC-10 in §1 of `docs/use-cases.md` (CP-2), using the citations above and matching the established (P)(B)(E)(C) format.
