---
event_type: reviewer_findings
timestamp: 2026-06-26T16:43:41.751Z
round: 1
phase: reviewing
actor: claude
slug: task-1350
---

# Review Findings — task-1350: Enforce good README.md standard

Reviewer: independent senior engineer (review-only mode)
Base branch (per MISSION.md): `skunkworks`. Reviewed `git diff skunkworks..HEAD` (the mission's real
delta) in addition to `main..HEAD`.

## Verdict summary

The documentation deliverables are complete, accurate, and well-evidenced. Gates pass cleanly.
However, the branch as composed modifies **five `.js` source/test files**, which the mission's own
**Restricted Areas explicitly forbid** ("Do not modify any `.js` source files — this is a
documentation-only mission"). These production-code changes are unauthorized by the mission spec,
have no checkpoint validating them as mission scope, and should be surfaced before integration.

Outcome: **request-changes** (actionable scope/restricted-area violation introduced on this branch).

---

## What the mission got right (verified)

- **Criterion 1 — doc standard exists, ≥8 rules:** `docs/doc-standards.md` (4953 chars, under the
  10,000 stop-rule) contains 10 rule sections covering headline, opening, quickstart, caveats,
  superlatives, "what it is not", structural ordering §7, tone, link hygiene, subdirectory READMEs.
  PASS.
- **Criterion 2 — AGENTS.md hook:** `AGENTS.md:14` adds `## README & documentation standards` after
  the graphify section, points to `docs/doc-standards.md`, and includes a 6-item pre-commit checklist
  (`AGENTS.md:29`). Total 2507 chars, under the 4000-char stop-rule. PASS.
- **Criterion 3 — README "Current status" accuracy:** README.md:175-184 carries all five claims
  (npm `@magnusekdahl/parallix` + local tarball, Forgejo optional review surface, CHANGELOG/PATCH
  versioning, codex/claude structured telemetry vs local-custom/mistral zeros, Graphify optional).
  Verified against `package.json:2`, `workflow.config.json` (`provider: forgejo`), `CHANGELOG.md`,
  and `lib/agents/*-telemetry.js`. README.md was **not edited** because it was already accurate
  (CP-3 row 8 honestly states "no corrections needed"). Audit pass is legitimate. PASS.
- **Criterion 4 — README links resolve:** all nine targets exist (verified by filesystem check). PASS.
- **Criterion 5 — examples/README.md:** capability statement at line 3, H1 normalized to
  "Parallix Examples". PASS.
- **Criterion 6 — lib/README.md:** H1 + one-line capability statement (line 3) + table. Marginal:
  the file has no real H2/H3 (criterion phrasing implies an H1→H2→H3 hierarchy), but for a 13-line
  navigation file this is defensible. Not blocking. PASS (with note).
- **Gates:** `./scripts/verify-local.sh docs` → "PASS: all required documentation present".
  `npm test` → 1666 pass / 0 fail, **exit 0**. Both mission gates satisfied at current HEAD.

---

## Finding 1 (BLOCKING) — Restricted-area violation: `.js` source files modified

MISSION.md Restricted Areas: "Do not modify any `.js` source files — this is a documentation-only
mission." The branch violates this in two commits:

1. **`lib/commands/mission-start.js` + `test/mission-start.test.js`** (commit `0686f4a7`,
   "execute(task-1350): capture agent output"). Renames the injected runner default
   `options.runFn || run` → `options.gitFn || git` (`lib/commands/mission-start.js:38`) and updates
   the three test doubles accordingly. The commit message admits this is a "Safety harness: capture
   implementation changes left uncommitted by the execute agent" — i.e. the documentation execute
   agent made a stray production-code edit. The change appears to be a *correctness fix* (the call
   site at `mission-start.js:194` passes a git-args array, which matches `git`'s signature, not
   `run`'s `command, args` signature), and tests pass — but it is unambiguously outside a
   documentation-only mission's scope and was never validated by a mission checkpoint.

2. **`lib/commands/rebase.js`** (+ `test/rebase.test.js`, `test/draft_preflight_modern.test.js`)
   (commit `d56233a7`, "ad-hoc fixes needed to be able to merge this mission that was started from a
   featurebranch"). Changes `rebase` to resolve and rebase onto the mission's recorded base branch
   (`resolveMissionBaseBranch`) instead of always the primary branch
   (`lib/commands/rebase.js:112-117`, `:578`). This is genuine workflow behavior change. It is
   honestly labeled as out-of-band plumbing required to merge a feature-branch mission, and it does
   add a focused test ("rebase targets the mission recorded base branch, not the primary branch").

Impact: a documentation-only mission's branch now carries production-code changes to the
rebase/mission-start commands. These changes have their own risk surface and are not covered by the
mission's Success Criteria or Checkpoints, so they were not independently reviewed as a feature.
Per the review contract this is an actionable issue introduced by this mission's branch.

Recommended resolution (operator's call — reviewer cannot edit): split the `rebase.js` /
`mission-start.js` plumbing into its own task with its own acceptance criteria and review, or
explicitly amend/acknowledge the mission to authorize the feature-branch plumbing as in-scope.
The changes are tested and appear sound, so this is about scope discipline and reviewability, not a
correctness defect.

---

## Finding 2 (MINOR) — CP-FINAL gate evidence is stale

`missions/task-1350/CP-FINAL.md:56` claims "`npm test` exited 1 with 2 pre-existing failures in
`test/draft_preflight_modern.test.js`." At current HEAD `npm test` exits **0** with 0 failures —
the later commit `d56233a7` patched `test/draft_preflight_modern.test.js`
(`detectLaunchBaseBranchFn: () => null` injections) and `rebase.js`, removing those failures. The
checkpoint evidence therefore does not match the integrated tree. Not a defect (current state is
better than claimed), but the goal-check evidence should reflect the merged HEAD.

---

## Finding 3 (NOTE) — Diff scope depends heavily on chosen base

`git diff main..HEAD` is far larger than the mission (it pulls in 6 feature-branch commits on
`skunkworks`: draft.js, integrate.js, forgejo.js, workflow.config.json model-config change, new
TASK-1351/1352/1277 backlog files). Those belong to skunkworks, not task-1350. Reviewing against the
mission's declared `Base-Branch: skunkworks` is the correct frame and is what Findings 1–2 are based
on. Flagging so integrators do not attribute the skunkworks infra to this mission.

---

## Goal-check / checkpoint confirmation

CP-FINAL.md contains a Goal Check section citing real evidence (file:line refs, test/telemetry file
names) for all six criteria. Evidence is credible except the stale gate line (Finding 2). The
checkpoint does not mention or justify the `.js` source changes (Finding 1), which is the core gap.

---
`[workflow-round:1, workflow-phase:reviewing]`