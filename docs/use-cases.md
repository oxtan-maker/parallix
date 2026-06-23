# Parallix — Primary Use-Case Inventory (evidence-backed)

**Author role:** Skeptical PM doing discovery, not advocacy.
**Question answered:** Which use cases does Parallix actually support today, and which are strong enough for public positioning?
**Method:** Every claim is sourced to repository code, tests, or configs — never to a README assertion — and any throughput claim is tied to the visualBoard measured retro figures *with their caveats*. See [CP-1.md](CP-1.md) for the raw evidence base.

> **How to read a confidence level.**
> **Confirmed** = the capability is executable code *and* exercised by a passing test cited by path.
> **Partial** = the mechanism exists in code but enforcement, coverage, or measured value is incomplete (caveat stated).
> **Aspirational** = documented intent only; not delivered today. All aspirational items live in their own section (§3).

---

## 1. Confirmed and Partial use cases

Each use case carries the four required parts: **(P) persona/buyer**, **(B) before→after pain**, **(E) non-README evidence**, **(C) confidence + one-line justification.**

### UC-1 — Run several AI coding agents on one repo at once without them clobbering each other

- **(P)** Solo maintainer or small-team lead driving more than one AI coding agent against a single repository.
- **(B)** *Before:* two agents in one working tree fight over the index, branch, and uncommitted files, so you serialize them (one agent idle while the other runs) or you hand-manage `git worktree` and branch naming yourself. *After:* each mission is given its own branch (`mission/<slug>`) and its own sibling checkout (`../<repo>-<slug>`) automatically, so N agents make progress independently and each lands by squash-merge.
- **(E)** Worktree + branch creation is code: `lib/commands/draft.js:133` (mission branch name), `:135` (`ensureMissionBranch`), `:138-139` (`ensureWorktree` at the sibling path); pattern declared in `workflow.config.json` (`adapters.missions.worktreePattern: "../<repo>-<slug>"`, `branchPrefix: "mission/"`). Tested: `test/draft.test.js` — `ensureWorktree creates worktree when target directory is absent`, `ensureMissionBranch creates branch from main when absent`. **Measured value:** the observed mission-output gain depends on the comparison surface. In strict user-value terms, the visualBoard parallel-model periods ranged from `0.44/day` to `0.58/day` over a `0.28/day` human baseline — roughly **+57% to +107%** (`../visualBoard/docs/missions/2026/ai-workflow-retrospective-since-october/EVALUATION_SUMMARY.md:46-52`, `../visualBoard/docs/missions/2026/task-1023/RETROSPECTIVE_P5.md:20-30`). A later productized workflow window recorded **58 completed missions in 15 days** — about **27/week** or `~3.86/day` — which is roughly **+1,280%** versus the same `0.28/day` baseline if you frame the comparison as total completed mission throughput in a setup where the buyer no longer has to build the AI-SDLC machinery first (`../visualBoard/docs/missions/2026/task-1247/research.md:55-75`). The later Q2 normalization keeps the user-value story in the middle of that spread, at `0.54/day` in P4 and `0.48/day` in P6 (`../visualBoard/docs/missions/2026/task-1099/RETROSPECTIVE_Q2_2026.md:18-29`). **Caveats that travel with the range:** the low-end user-value periods carried heavy AI-workflow overhead (34% in the early summary; 85% AI-SDLC mix in P5), C2/external review coverage was only 7% against a 100% rule (`EVALUATION_SUMMARY.md:66`), the comparison METR study found AI *slowed* experienced devs 19% and carries a model-currency caveat (`:70-72`), and the high-end `27/week` figure is a different mission-output metric from user-value/day.
- **(C)** **Confirmed** for the mechanic (worktree/branch isolation is tested code); the throughput *value* is **measured but caveated** — real and attributable to the parallel model, but highly dependent on whether you measure user-value delivery only or general completed-mission output in a productized workflow.

### UC-2 — Don't lose a run when one AI provider hits its usage cap

- **(P)** Anyone driving agents on metered/rate-limited LLM subscriptions (Claude, Codex/GPT, Mistral, local Qwen).
- **(B)** *Before:* the agent prints "usage limit reached", the run dies, and you babysit it — manually restarting later or hand-switching to a different model. *After:* the limit message is pattern-detected, that agent family is written to a timed blocklist, and the run retries with the next eligible, unblocked family; only when all are exhausted does it fail loudly.
- **(E)** Per-family limit regexes: `lib/agents/limit-hit.js:8-36`; selection honoring eligibility + blocklist + env override: `lib/agents/agents.js:382` (`selectAgent`), `:340-348` (`isAgentBlocked` for permanent/timed/`blocked:false`). Tested: `test/agents-limit-hit.test.js` — `startAgent persists a block via updateAgentBlock when limit-hit detector fires`, `startAgent throws when every eligible agent hits the limit`, `startAgent does not loop forever when WORKFLOW_AGENT is pinned and that agent hits limit`.
- **(C)** **Confirmed** — detection, timed-block persistence, and next-agent retry are each covered by named passing tests.

### UC-3 — Resume a long agent task exactly where it stopped, deterministically

- **(P)** Operator running multi-step missions that outlast a single session or context window, possibly across machines.
- **(B)** *Before:* a crashed or context-exhausted agent leaves you reconstructing what was already done by re-reading diffs. *After:* every checkpoint runs the gate, commits a checkpoint document, and pushes it with a literal `Next action:` line, so a later session (or a different agent) resumes from a written instruction rather than a guess.
- **(E)** `lib/commands/checkpoint.js:41-47` (gate runs first), `:56-58` (`checkpoint(<slug>): <cp>` commit + `Next action:` body), `:67` (push). Handoff refuses to proceed without a checkpoint and auto-generates a minimal `CP-1.md` with a valid Goal Check when none exists: `lib/commands/handoff.js:92-102`. Tested: `test/handoff.test.js` (checkpoint discovery + auto-remediation).
- **(C)** **Confirmed** — the commit/push + `Next action:` contract is code and the handoff path is tested.

### UC-4 — Require a second review pass before merge (different AI preferred, same-family fallback when no other is runnable)

- **(P)** Lead who distrusts single-agent self-approval — exactly the unverified-AI risk METR quantifies.
- **(B)** *Before:* the agent that wrote the change also declares it done; nobody independent looks. *After:* review is a separate workflow step whose reviewer selection actively excludes the implementer (preferring a different agent family, falling back to the same family only when no other is runnable), and a self-approval is explicitly skipped at the provider and flagged as requiring a different agent or a human.
- **(E)** Self-approval guard: `lib/review/review-commands.js:902` ("self-approval POST skipped. A different agent or a human must post the formal provider approval"). Reviewer selection *excludes the implementer* to prefer a different family — `lib/review/review-loop.js:427` (`selectAgent('review', { exclude: new Set([implementer]) })`) — but the same step has an **explicit same-family fallback**: when no different-family agent is runnable/unblocked it sets `reviewer = implementer` with source `single-family-fallback` (`lib/review/review-loop.js:484-485`). So review is a *separate step that prefers, but does not guarantee, a different agent*. (Note: `config/agents.json:9-20` lists the **same** four families for `active` and `review` — there is no separate reviewer pool; separation comes only from the runtime implementer-exclusion above.) Review loop with bounded attempts: `lib/review/review-loop.js:281` (`maxAttempts`).
- **(C)** **Partial.** The *mechanism* (separate step + code-level self-approval block + implementer-exclusion at reviewer selection) exists in `test/review.test.js`, but two honesty constraints hold it below Confirmed: (a) the guarantee is incomplete *by design* — reviewer selection falls back to the *same* family when no other is runnable (`review-loop.js:484-485`), and measured C2 review coverage was only **7%** against the 100% rule (`EVALUATION_SUMMARY.md:66`); (b) that test suite is **timing-flaky** — it is async-poll/timeout-sensitive and non-deterministic across runs (observed both all-pass and 11–15 failures depending on machine load), so it is not a dependable green signal. Position this as "forces a second, preferentially-different review pass," **not** "guarantees a different reviewer or coverage."

### UC-5 — Adopt the mission workflow without rewriting your existing CI

- **(P)** Team with an established `make`/`npm`/script-based verification setup that wants the mission lifecycle without replacing its gate.
- **(B)** *Before:* workflow tools assume their own gate runner, so adopting them means re-plumbing verification. *After:* the gate is a configured shell command with `{{area}}` substitution and a **no-op default** — declare your existing command in `workflow.config.json` and it runs verbatim; declare nothing and verification is a documented no-op pass rather than an invented gate.
- **(E)** `lib/core/verification.js:5-11` (no-op notice when unconfigured), `:25-31` (`{{area}}` substitution), `:34` (`runVerificationGate`). This repo configures `npm test` / area `all` (`workflow.config.json` `adapters.verification`). Tested: `test/verification.test.js`.
- **(C)** **Confirmed** — adapter resolution, substitution, and the no-op default are tested code.

### UC-6 — See which agent family actually pays off, across every repo one runtime drives

- **(P)** Operator/buyer deciding which paid agent subscriptions to keep or cut.
- **(B)** *Before:* no durable, cross-repo record of how each agent performs, so the keep/cut decision is a hunch. *After:* a single parallix-owned `stats.csv` accumulates per-agent telemetry (`classification, implementer, pr_fix_rounds`, plus an extended 21-column schema) across every repository one runtime drives, keyed so the same mission in different repos stays distinct.
- **(E)** `lib/commands/stats.js:14` (legacy 5-col schema), `:21-30` (extended schema). Tested: `test/stats.test.js` — `upsertStatsRow writes the workflow stats schema and updates existing missions idempotently`, `task-1314: upsertStatsRow keys on (repo, mission, stage) so same mission in different repos stays distinct`. The kind of agent-comparison this enables is demonstrated in `../visualBoard/docs/missions/2026/task-1023/RETROSPECTIVE_P5.md:198-243` (per-family PRs, reviews/PR, durations).
- **(C)** **Partial.** Schema and CSV upsert are tested, but the value is bounded: the richest per-agent comparison in the evidence came from Forgejo PR data, not `stats.csv`, and two of four families record honest zeros for token usage (`opencode`/local Qwen and `mistral`/vibe telemetry are zeroed by design, per `README.md:230-231` describing `opencode-telemetry.js`/`mistral-telemetry.js`). So cross-agent *cost/value* comparison is complete only for `codex` and `claude` today.

---

## 2. Ranking — top 3 for immediate public positioning

Ranked by *credibility as a public claim given cited evidence*, each naming the single competing tool/workflow a user would otherwise reach for, and each carrying a claim that is **only true of Parallix** given the evidence.

| Rank | Use case | What the user reaches for instead | The claim only Parallix can make (with evidence) |
|---|---|---|---|
| **1** | UC-1 Parallel multi-agent execution | A single Cursor / Claude Code / Aider session run serially, or hand-rolled `git worktree` juggling | It is the *specific* mechanic an internal retro measured as the only one to beat a human baseline, with observed mission-output gains ranging from roughly **+57%** on strict user-value delivery up to about **+1,280%** on later completed-mission throughput in a productized setup (`EVALUATION_SUMMARY.md:46-52`, `RETROSPECTIVE_P5.md:20-30`, `task-1247/research.md:55-75`). No generic AI tool ships that attached measurement. |
| **2** | UC-2 Usage-limit auto-failover across families | Manually restarting with a different model when you hit a cap | Family-specific limit detection → timed blocklist → retry-next-eligible is a tested control loop (`limit-hit.js:8-36`, `test/agents-limit-hit.test.js`), not a retry button. |
| **3** | UC-4 Second review gate (prefers a different agent family, with same-family fallback) | Single-agent self-review, or waiting on a human PR reviewer | A self-approval is *code-blocked* and rerouted to a different family or human (`review-commands.js:902`), and reviewer selection actively excludes the implementer family (`review-loop.js:427`). (Marked Partial — there is a documented same-family fallback at `review-loop.js:484-485`, so this is "forces a second *attempt*," not "guarantees a different agent or coverage.") |

**Genericness check (value-bar §3):** strike "Parallix" and substitute any other AI coding tool — rank 1 fails to read identically because the +57% to +107% user-value figures, and the later +1,280% completed-mission figure, are specific repository data; rank 2 fails because per-family limit regexes + timed blocklist is a named tested behavior, not a generic "retry"; rank 3 fails because a code-level self-approval block is specific behavior, not a slogan.

**Feature-list strike check (value-bar §1):** removing every Parallix-internal noun still leaves a user situation in each top-3: (1) "run several AI agents on one repo at once without them overwriting each other"; (2) "when one provider hits its cap mid-task, continue on another automatically"; (3) "a second review pass by a preferentially different AI is forced before the author's own approval counts (though same-family fallback applies when no other agent is available)."

---

## 3. Aspirational / not-yet-supported (do NOT position as live)

- **Public distribution (registry/Homebrew/Docker/signed binaries/CI-release automation).** Explicitly out of the near-term model — supported path is a local `npm pack` + global install only (`README.md:281-285`, cited here as the thing being *tested*, corroborated by `package.json:10-11` `publishConfig.access: "restricted"`). **Aspirational.**
- **"Sustained 2× throughput at scale."** The observed range is context-dependent, not flat. Strict user-value throughput moved between `0.44/day` (+57%) and `0.58/day` (+107%), while a later productized window reached about `27/week` (`~3.86/day`, roughly +1,280% vs `0.28/day`) on completed-mission throughput (`RETROSPECTIVE_P5.md:20-30`, `RETROSPECTIVE_Q2_2026.md:18-29`, `task-1247/research.md:55-75`). A "consistently 2× faster" claim is **Aspirational** and hides the fact that these are different mission-output measures.
- **Full structured telemetry for all four agent families.** `mistral`/`vibe` telemetry is blocked in-environment and records honest zeros, tracked as follow-up (`README.md:231`). Cross-agent cost comparison for all families is **Aspirational** until those sources exist.

---

## 4. Red-team (required adversarial self-review)

The two weakest use cases and the single strongest objection a skeptical senior PM would raise against each:

1. **UC-4 (Cross-agent review) is the weakest "confirmed-sounding" claim.**
   *Objection:* "Even framed as a 'second-agent review gate that prefers a different family,' you still rank it as a differentiator — but the eligibility config lists the *same* families for `active` and `review` (`config/agents.json:9-20`), reviewer selection has a documented same-family fallback (`review-loop.js:484-485`), and your own cited retro puts real C2 coverage at **7%** against a 100% rule (`EVALUATION_SUMMARY.md:66`). The separation is preferential and best-effort, so even the softened claim leans on a control that often doesn't bind."
   *How the evidence answers it:* It mostly concedes. The *self-approval block* (`review-commands.js:902`) and the *implementer-exclusion at reviewer selection* (`review-loop.js:427`) are real and present, so the mechanism is honestly "supported/forced at the point of approval." But it is not a guarantee: `config/agents.json:9-20` lists the **same** families for `active` and `review` (no dedicated reviewer pool), and there is an explicit **same-family fallback** (`review-loop.js:484-485`) when no other family is runnable. That is exactly why UC-4 is marked **Partial** and kept out of any "guarantee" framing. A PM should ship it as "forces a second review attempt by a *preferentially* different agent," not as a coverage or different-agent guarantee.

2. **UC-6 (Cross-repo agent telemetry) over-reaches on value.**
   *Objection:* "Your richest agent comparison (`RETROSPECTIVE_P5.md:198-243`) came from Forgejo PR data, not `stats.csv`, and two of four families log zero tokens by design. So 'know which agent pays off' is true only for codex and claude — the CSV alone can't make the buyer's decision you imply."
   *How the evidence answers it:* It partially answers. The schema and idempotent upsert are tested (`test/stats.test.js`), so the *plumbing* claim holds; but the *decision-grade comparison* claim is bounded to families with structured telemetry. UC-6 is marked **Partial** with that boundary stated, and it is deliberately excluded from the top-3.

---

## 5. Limitations & honesty constraints (carried into any downstream positioning)

- Throughput framing is permitted **only** with the cited observed ranges and their metric labels: `0.44-0.58/day` over a `0.28/day` baseline for user-value throughput, or `58 missions / 15 days` (`~27/week`, `~3.86/day`) for later completed-mission throughput. Do not blur those into one number. All such framing must travel with its caveats (34% overhead in the early summary, 7% C2 coverage, METR −19%/model-currency, P5 erosion under 85% AI-SDLC mix). A bare "2× faster" is a defect.
- The README is treated as the artifact under test, never as proof — every value claim above is anchored to code/tests/configs/measured retro data.
- visualBoard's human baseline carries acknowledged confounds (2022 codebase was simpler); rate comparisons are directional (`EVALUATION_SUMMARY.md:9`). The latest metrics-bearing retro is `../visualBoard/docs/missions/2026/task-1099/RETROSPECTIVE_Q2_2026.md`, which reports P4 `0.54/day`, P5 `0.44/day`, and P6 `0.48/day`.
- History coverage backing this analysis: parallix — 14 `MISSION.md` files + 25 backlog tasks (≥10 ✓); visualBoard — `EVALUATION_SUMMARY.md`, `RETROSPECTIVE.md`, `BENCHMARK.md`, `RETROSPECTIVE_P5.md` among 18 retro files (≥3 ✓).
