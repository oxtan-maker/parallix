# CP-1 — Evidence collection complete

## Summary

Inspected the required repository surfaces (README.md, package.json, AGENTS.md, CHANGELOG.md, index.js, px.js, config/, lib/, test/, prompts/, templates/, examples/, missions/, workflow.config.json) and the visualBoard AI-SDLC retrospectives. Captured raw, citable evidence for the candidate use cases and confirmed which capabilities are exercised by tests. No deliverable prose was written yet — this checkpoint records the evidence base CP-2 will build on.

### Capability evidence captured (code + tests)

- **Multi-agent selection with weighted random draw, env override, and a per-agent blocklist.** `lib/agents/agents.js:359` (`eligibleAgentsForStep`), `:372` (`weightedRandom`), `:382` (`selectAgent`, honors `WORKFLOW_AGENT` only when eligible+unblocked), `:340`/`:347` (`isAgentBlocked` permanent/timed/`blocked:false`). Per-step eligibility is data, not code: `config/agents.json:4-21`. Tested: `test/agents.test.js` (`isAgentBlocked handles permanent blocks`, `... handles timed blocks`, `... ignores invalid date-plus-hour timestamps`).
- **Usage-limit auto-failover across agent families.** `lib/agents/limit-hit.js:8-36` (per-family limit regexes), `:67` (`RETRY_AFTER_PATTERN`). Tested: `test/agents-limit-hit.test.js` (`startAgent persists a block via updateAgentBlock when limit-hit detector fires`, `startAgent throws when every eligible agent hits the limit`, `startAgent does not loop forever when WORKFLOW_AGENT is pinned and that agent hits limit`).
- **Worktree/branch isolation per mission (the differentiator's mechanic).** `lib/commands/draft.js:133` (branch name), `:135` (`ensureMissionBranch`), `:138-139` (`ensureWorktree` at `../<repo>-<slug>`). Pattern declared in `workflow.config.json` (`worktreePattern: "../<repo>-<slug>"`, `branchPrefix: "mission/"`).
- **Checkpoint resumability: gate → commit → push, with a `Next action:` line.** `lib/commands/checkpoint.js:41-47` (runs verification gate), `:56-58` (`checkpoint(<slug>): <cp>` commit + `Next action:` body), `:67` (push). Handoff auto-remediates a missing checkpoint by generating a CP-1 with a valid Goal Check: `lib/commands/handoff.js:92-102`.
- **Configurable verification gate with a no-op default (portable across repos).** `lib/core/verification.js:5-11` (no-op notice when unconfigured), `:25-31` (`{{area}}` substitution), `:34` (`runVerificationGate`). This repo configures it as `npm test`/area `all` (`workflow.config.json` `adapters.verification`).
- **Cross-agent (C2) review separation + self-approval guard.** `lib/review/review-commands.js:902` ("self-approval POST skipped. A different agent or a human must post the formal provider approval"). Review loop orchestration and per-stage telemetry: `lib/review/review-loop.js:42` (`recordStageStatsSafe`), `:281` (`maxAttempts`). Family-separation seed: `test/agents-limit-hit.test.js` (`startAgent honours opts.exclude as a seed for the tried set (family-separation guard)`).
- **Cross-repository agent telemetry / stats.** `lib/commands/stats.js:14` (legacy 5-col schema `date,mission,classification,implementer,pr_fix_rounds`), `:21-30` (extended 21-col schema), `README.md:192` classifies `stats.csv` as parallix-owned cross-repo telemetry.
- **Local-tarball packaging (no registry dependency).** `package.json:13-30` (`bin.px`, `files` allowlist), `README.md:235-288` (npm pack + global install path; explicitly NOT registry/Homebrew/Docker). `CHANGELOG.md:7-30` (three release states; PATCH-per-integrate discipline).
- **Integration-time pipeline gates per changed area.** `README.md:121-145` documents `config/integration-pipelines.json` schema/ordering; tests present: `test/integrate-workflow-gate.test.js`, `test/integration-pipelines.test.js`.

### Measured differentiator evidence (visualBoard retros)

- `../visualBoard/docs/missions/2026/ai-workflow-retrospective-since-october/EVALUATION_SUMMARY.md:46-52`: Human baseline **0.28** user-value units/day; informal AI **0.12 (−57%)**; single-thread formal AI **0.12 (−57%)**; **parallel worktree model 0.58/day (+107%, 2.07x)**. Caveats in same file: `:52` (34% of formal missions were AI-workflow overhead), `:66` (C2 review coverage 7% vs 100% rule), `:70-72` (METR −19%, model-currency caveat), `:9` (human-baseline confounds — directional only).
- `../visualBoard/docs/missions/2026/task-1023/RETROSPECTIVE_P5.md:20-30`: P5 eroded the gain — user-value/day fell to **0.44 (1.6x)** while total throughput hit 2.96/day because **85% (68/80) of P5 missions were AI-SDLC overhead** (`:28`, `:79`). This is the honesty constraint for any throughput claim.

### History coverage (meets success criteria 71–72)

- Parallix: 14 `MISSION.md` files under `missions/` (task-1273, 1275, 1297, 1303, 1304, 1311, 1315, 1316, 1317, 1318, 1322, 1330, 1331, 1332); 25 backlog task files; git log references ~996 mission/task commits. **≥10 ✓**
- visualBoard: 18 `*RETRO*` files; 335 mission dirs under `docs/missions/2026`; the two named retros (EVALUATION_SUMMARY.md, RETROSPECTIVE_P5.md) plus RETROSPECTIVE.md/BENCHMARK.md inspected. **≥3 ✓**

## Goal Check

| CP-1 goal | Evidence (file:line / artifact) | Status |
|---|---|---|
| Required repo surfaces inspected | README.md, package.json:1-38, index.js:1-251, px.js:1-237, config/agents.json:1-25, lib/* (44 files), test/* (105 files), workflow.config.json | ✓ |
| Parallix git history ≥10 missions/retros | 14 MISSION.md under `missions/`; 25 backlog tasks; ~996 mission commits | ✓ |
| visualBoard history ≥3 missions/retros | EVALUATION_SUMMARY.md, RETROSPECTIVE_P5.md, RETROSPECTIVE.md, BENCHMARK.md; 18 RETRO files total | ✓ |
| Measured throughput data captured with caveats | EVALUATION_SUMMARY.md:46-52,66,70-72; RETROSPECTIVE_P5.md:20-30 | ✓ |
| ≥3 capabilities confirmed by tests located | test/agents.test.js, test/agents-limit-hit.test.js, test/checkpoint.test.js, test/integration-pipelines.test.js | ✓ |
| Raw findings documented with citations | this file, sections above | ✓ |

Next action: Write `missions/task-1332/use-cases.md` (CP-2) — draft ≥5 four-part, evidence-backed use cases from the captured citations, flag aspirational items in a separate section, and produce the top-3 ranking each naming the one competing tool/workflow the user would otherwise reach for.
