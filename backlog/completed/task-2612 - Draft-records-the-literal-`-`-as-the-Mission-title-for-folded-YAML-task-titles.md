---
id: TASK-2612
title: >-
  Draft records the literal `>-` as the Mission title for folded YAML task
  titles
status: done
assignee: [codex]
created_date: '2026-09-29 07:18'
labels:
  - bug
  - workflow
dependencies: []
references:
  - src/adapters/cli/commands/draft-stats.ts
  - src/adapters/backlog/task-file-io.ts
  - src/application/integrate/landing.ts
priority: medium
ordinal: 140008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Symptom

Two landed commits on `main` have the subject `>-`: `e74afe6a5` (TASK-2598) and `fb8bbd07f` (TASK-2594). `px status task-2598 --json` and `px status task-2594 --json` both report `"title": ">-"`. Every surface that reads the recorded Mission title shows the placeholder: the board, the `px draft` summary line, `px status`, and the landed squash subject (TASK-2595).

## Root cause

Backlog.md writes long task titles as a folded YAML block scalar:

```yaml
title: >-
  Let sandboxed Claude agents persist rotated OAuth tokens in every
  lifecycle step
```

`readTaskTitle` in `src/adapters/cli/commands/draft-stats.ts` reads the title with the single-line regex `/^title:\s*(.+)$/mi`, so it captures only the `>-` header. The draft intake step passes that value to `missionServices.intake.execute({ title })`, and the placeholder becomes the durable Mission title. `landing.ts` then uses the recorded title as the squash subject.

The repository already has a block-scalar-aware reader: `parseTaskFrontmatterValue` in `src/adapters/backlog/task-file-io.ts`. Its comment names this exact failure ("the shape a single-line reader (`^key:\s*(.+)$`) used to drop, leaving only the `>-`/`|` marker behind"). The legacy importer also treats `>-` and `|-` as placeholder titles (`legacy-mission-import.ts`). `readTaskTitle` was added later (TASK-2560) and does not use that reader.

Open tasks that will hit this when drafted: TASK-2521.08, TASK-2589, TASK-2607 and TASK-2611 all use `title: >-`.

## Fix

- Replace the regex in `readTaskTitle` with the shared frontmatter reader, so there is one title parser and not a second one.
- Refuse to record a block-scalar header (`>`, `>-`, `|`, `|-`, …) as a Mission title anywhere a title enters the Mission store. Fall back to the slug instead.
- Repair the two recorded Missions (task-2598, task-2594) through a supported operator path, not by editing SQLite directly. Leave the history of the landed commits alone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Drafting from a task whose frontmatter has `title: >-` with an indented continuation records the folded title text as the Mission title
- [ ] #2 The draft summary line, px status and the landed squash subject show the real title for such a task
- [ ] #3 No production code path records a bare YAML block-scalar header as a Mission title
- [ ] #4 There is only one frontmatter title parser; readTaskTitle has no private regex
- [ ] #5 Red-to-green repro test drafts a folded-title task and asserts the recorded title
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
