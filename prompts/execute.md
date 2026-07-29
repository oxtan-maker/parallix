Mode: execute after lock.
Mission: {{missionPath}}
Mission dir: {{missionDir}}
Slug: {{slug}}
Backlog task: {{taskPath}}

Harness preflight already confirmed:
- branch/worktree shape
- mission doc presence
- Backlog task presence

Execution requirements:
- execute checkpoint-by-checkpoint per the contract in `{{missionPath}}`
- after each completed checkpoint, write `CP-N.md` in `{{missionDir}}` containing: a summary of work done, a Goal Check table with file:line and test-name evidence, and a non-generic `Next action:` line
- Keep Goal Check evidence durable: prefer stable file references and commands that can be rerun against the committed tree. Do not claim that `git diff HEAD` proves a committed change—its expected output is empty after committing. If historical diff evidence is needed, state the exact non-HEAD baseline or describe the observed change without implying that an empty post-commit diff will reproduce it.
- the final checkpoint document MUST contain a Goal Check table citing real evidence (file:line, test names)
- **Heading requirement:** Use the exact section header `## Goal Check`.
- **Goal Check table format:** Use a 3-column pipe-delimited markdown table: `| Criterion | Evidence | Status |` followed by a separator row `|---|---|---|`, then one evidence row per criterion.
- **Accepted evidence forms** (each row's Evidence column must cite at least one verifiable reference from this list):
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name found in repo test files)
  3. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  4. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review {{slug}} --verify` ``, or `` `./scripts/verify-local.sh all` ``
- **Not sufficient by themselves:** raw `stat`/`ls` output or generic prose claims. You may include them as supporting context, but the same Evidence cell must also cite at least one accepted reference from the list above.
- verify all mission-declared Gates pass before handoff
- Immediately after **each successful mission-declared Gate**, compact your working context before starting the next gate, checkpoint work, or handoff work. Reload only the locked mission goal and scope plus committed checkpoint or successful-gate evidence that is present. Do not compact for a failed gate: retain its failure diagnostic while repairing it.
- preserve `{{taskPath}}`: update mission-relevant content as needed but do not delete, rename, or move the file
- do not change the Backlog task's status, assignee, labels, or lifecycle metadata, and do not run `px active`, `px review`, or `px integrate`; Parallix performs lifecycle transitions itself
- do not hand off to review if `{{missionPath}}` or checkpoint documents are uncommitted

Graphify-first: before executing, check if `graphify-out/graph.json` exists. If it does, use `graphify query "<question>"` for codebase questions, `graphify path "<A>" "<B>"` for relationships, and `graphify explain "<concept>"` for focused concepts. Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review. Run `graphify update .` after modifying code. If `graphify-out/wiki/index.md` exists, use it for broad navigation.

{{checkpoint_context}}
