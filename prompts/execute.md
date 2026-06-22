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
- the final checkpoint document MUST contain a Goal Check table citing real evidence (file:line, test names)
- **Heading requirement:** The final checkpoint's goal-check section header MUST be exactly `## Goal Check` or `## Goal Check Table` (no other wording). Heading variants such as `## Final Goal Check`, `## Goal Check Summary`, or any other variation will fail the handoff gate because the validator regex is `^## Goal Check(?: Table)?\s*$`.
- verify all mission-declared Gates pass before handoff
- preserve `{{taskPath}}`: update mission-relevant content as needed but do not delete, rename, or move the file
- do not edit the backlog `assignee` field; the workflow records ownership itself
- do not hand off to review if `{{missionPath}}` or checkpoint documents are uncommitted

Graphify-first: before executing, check if `graphify-out/graph.json` exists. If it does, use `graphify query "<question>"` for codebase questions, `graphify path "<A>" "<B>"` for relationships, and `graphify explain "<concept>"` for focused concepts. Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review. Run `graphify update .` after modifying code. If `graphify-out/wiki/index.md` exists, use it for broad navigation.

{{checkpoint_context}}
