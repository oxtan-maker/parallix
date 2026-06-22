---
event_type: reviewer_findings
timestamp: 2026-06-22T04:35:13.798Z
round: 1
phase: reviewing
actor: claude
slug: task-1330
---

# Review Findings — task-1330 (Make Graphify Work Automatically Across Parallix Agents/Prompts)

Mode: review · Attempt 1 · Focus: all · PR #12 · Branch `mission/task-1330`

## Verification summary

- `px review task-1330 --verify`: reviewer gate **PASS** — `npm test` → 1571 pass / 0 fail / 22 skipped (1593 tests). Env verdict USABLE. PR #12 open.
- All seven mission Success Criteria (SC1–SC7) verified PASS with real evidence (see table below).
- Final checkpoint `missions/task-1330/CP-4.md` contains a Goal Check table citing real `file:line` evidence and gate results.

## Success Criteria check (independently verified)

| SC | Claim | Evidence | Result |
|----|-------|----------|--------|
| SC1 | `headlessCodexConfig()` emits `[features]` + `multi_agent = true` | `lib/agents/codex.js:160-168` — `[features]` / `multi_agent = true` present; verify gate `grep -q "multi_agent = true"` PASS | PASS |
| SC2 | Contract decision doc names a choice + cites upstream | `MISSION.md:62-74` names "official always-on"; cites `skill-codex.md:233` (verified: line 233 = "Requires `multi_agent = true` under `[features]`…"), `always_on/claude-md.md`, `agents-md.md` | PASS |
| SC3 | `CLAUDE.md.template` `## graphify` w/ `graphify query`+`graphify update` | `templates/CLAUDE.md.template:18-27` — content matches upstream `always_on/claude-md.md` verbatim | PASS |
| SC4 | `AGENTS.md.template` `## graphify` w/ `graphify query` | `templates/AGENTS.md.template:23-34` | PASS |
| SC5 | All five prompts reference graphify | draft.md:16, execute.md:22, review.md:17, act-on-review.md:22, portfolio.md:30 — grep count = 5 | PASS |
| SC6 | `MISTRAL.md.template` unchanged | `git diff main..HEAD -- templates/MISTRAL.md.template` empty | PASS |
| SC7 | Backlog task file exists, labels retained | file present; labels `ai_sdlc`, `bug`, `prompt` intact | PASS |

The locked SCs all pass. The findings below are quality/efficacy concerns the grep-based gates do not catch.

## Findings

### F1 (medium) — Agent adapter templates are inert; the automatic path is carried by prompts only
The three edited adapter templates — `templates/CLAUDE.md.template`, `templates/AGENTS.md.template`, `templates/CODEX.md.template` — are **referenced by no parallix code**. Repo-wide search (`grep -rn '\.md\.template' --include=*.js`, plus searches for `'CLAUDE.md'` / `'AGENTS.md'`) finds zero consumers; the only JS-referenced template is `mission-scaffold.md` (`lib/commands/draft.js:16`). No repo-local `CLAUDE.md` or `AGENTS.md` is generated (neither exists at repo root).

Consequence: editing these templates does **not** by itself surface Graphify guidance to launched agents — the templates are documentation-only artifacts unless an external/operator step renders them. The genuine automatic path is delivered by the **prompt** edits, which ARE loaded by the launcher (`lib/commands/active.js:16` execute.md, `lib/commands/draft.js:15` draft.md, `lib/review/review-prompts.js:15-16` review.md/act-on-review.md). So the mission's "without operator memory" goal is met via prompts, not templates.

CP-4's "verification" is grep-only and implies the template edits achieve always-on surfacing; it does not prove the templates reach any agent. This is exactly the box-checking-vs-effect gap a detailed review should flag. Recommend either: (a) generate repo-local `CLAUDE.md`/`AGENTS.md` from the templates (mission scope explicitly allows "and/or generate repo-local"), or (b) document in CP-4/contract that template edits are documentation-only and the prompts are the effective surfacing mechanism.

### F2 (low) — No regression test guards `multi_agent = true`
Mission Scope: "ensuring future changes cannot silently remove it (documented in code comment **or test**)"; acceptance evidence #1 explicitly asks for "regression coverage proving future changes cannot silently remove it." The code comment exists (`lib/agents/codex.js:157-159`), satisfying the literal "or comment" path — but the existing test that exercises this function (`test/codex.test.js:95` "headlessCodexConfig produces valid TOML") was **not** extended to assert `[features]` / `multi_agent = true`. A one-line `assert.ok(config.includes('multi_agent = true'))` would be the cheap regression guard the acceptance item asks for. SC1 passes as-is; this is a gap against acceptance #1.

### F3 (info) — Contract is labeled "official always-on" but does not use the official install path
The contract (`MISSION.md:64-74`) names "official always-on" yet does not run `graphify claude/codex/opencode install`, write `.codex/hooks.json`, or wire `.opencode/` — it embeds equivalent content into templates. The doc itself acknowledges this (point 3). It is closer to a template-embedding/hybrid approach than literal "official always-on", though it is internally justified and SC2 is satisfied. No `.opencode/` plugin wiring exists (mission scope item for Qwen/OpenCode was "AGENTS.md.template and/or .opencode wiring" — the template branch was taken). Naming nuance only.

### F4 (info) — `git diff main..HEAD` includes non-task changes (branch staleness)
The diff shows `workflow.config.json` (`worktreePattern` → `.worktrees/<repo>-<slug>`) and `.gitignore` (`+.worktrees/`) changes that are **not** task-1330 work. They originate from the branch's merge-base `c933df70f` predating main's revert `76533a60a` ("workflow: revert mission worktrees to sibling dirs"). Confirmed: `76533a60a` is an ancestor of `main` but not `HEAD`; no task commit touched these files (`git log main..HEAD -- workflow.config.json .gitignore` is empty). A normal 3-way merge will keep main's `../<repo>-<slug>` value (branch never modified the file), so this will **not** clobber the main-side fix — but it is misleading in the two-dot diff. Recommend rebasing the branch on current `main` so the PR diff reflects only task work.

## Notes
- Out-of-scope respected: `templates/MISTRAL.md.template` untouched; no Graphify upstream files modified; no `graphify build/query` run against the repo.
- Backlog `assignee` changed `[] → [qwen]` and status `backlog → review`; these are workflow-harness transitions (commits `9439a016b`, `4944beb14`), not implementer edits — consistent with the restricted-area rule.

---
`[workflow-round:1, workflow-phase:reviewing]`