---
id: TASK-2468
title: adhoc missions as first-class intake with db-owned ids
status: done
assignee: [custom]
created_date: '2026-09-07 16:54'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parallix must support three intakes in the same repository, with the same lifecycle:

1. Backlog.md tasks only (today's path).
2. Adhoc missions only — a repository with no Backlog.md project at all.
3. Both at once.

Today only (1) works end to end. `px draft "fix hello world greeting"` builds a complete adhoc mission — branch, worktree, MISSION.md, synthetic task file — and then `px active adhoc-fix-hello-world-greeting` refuses with `slug must begin with task-` (`src/application/execute-mission-service.ts`). The zero-friction first-value path in the README dead-ends after drafting, and this blocks the demo recording in task-2467.

Removing that one guard is not the task. The task is to make an adhoc mission a real mission that does not borrow Backlog.md's identity or its authority.

### Adhoc mission identity

Name adhoc missions `parallix-adhoc-<NNNN>` (propose a better name in the mission contract if there is one) with a counter owned by `parallix.db`, allocated atomically and scoped per repository, so adhoc numbering can never collide with, or be confused for, Backlog.md task numbering. No content hash in the identity: `syntheticTaskId` currently mints `ADHOC-FIX-HELLO-WORLD-GREETING-49BEDE6E` for slug `adhoc-fix-hello-world-greeting`, which does not match the resolver's own rule (`normalizedId = slug.toUpperCase()`, `src/adapters/backlog/task-file-io.ts`), so an adhoc mission resolves only while its filename prefix happens to match.

Slug, branch (`mission/<slug>`), worktree suffix, and mission id must stay one derivable identity, as in the original design (see below). Existing `adhoc-*` missions need a migration or a documented cutover.

### Backlog.md as a mirror, not an authority

ADR 0053 already decides this: `missions.status` and `missions.assignee` are operator-local authority (`src/adapters/sqlite/authority-map.ts`, `MISSIONS_AUTHORITY`), and an accepted external task is only a reference (`mission_external_task_refs`, migration `0005-mission-external-task-ref.sql`). The implementation has not followed: lifecycle status and implementer are written into, and read back from, the Backlog task file (`src/adapters/backlog/task-transitions.ts`), and ~20 source files call `resolveTaskFile`.

Keep writing to Backlog.md wherever a task file exists — a Backlog.md user should keep seeing lifecycle state in that UI, and that mirror is good practice, not debt. What must change is that the mirror is never load-bearing: a missing, unreadable, or absent Backlog.md project degrades gracefully instead of failing the command.

- `px active`, `px review`, `px integrate`, `px status`, handoff, rebase, and stats read their answers from the DB, and write the Backlog task file as a best-effort mirror when one exists. No task file means no mirror write, not an error and not a "synthetic/unknown task metadata" warning (`src/adapters/cli/commands/integrate.ts`).
- Agent assignment/implementer and lifecycle status are authoritative in the DB. The task file mirrors them; it is never read back as the source of truth (`src/adapters/backlog/task-transitions.ts` does both today).
- Where a Backlog task exists, record it as an external task ref and keep the mirror one-directional.
- The one exception: drafting a Backlog.md task (`px draft task-<N>`) legitimately requires that task file, and must still fail clearly when it is missing or ambiguous.

### Prompts

`prompts/draft.md` and `prompts/execute.md` interpolate `{{taskPath}}` and instruct the agent to read the user's intent from the Backlog task file, edit its labels, and leave its `assignee` alone. For an adhoc mission there is no such file.

Do NOT fork the prompt into a Backlog copy and an adhoc copy. Two near-identical prompt files is how prompt drift starts: the next agent edits one, the other rots, and nobody notices which intake got the fix. Keep one draft prompt whose body is intake-independent, and confine the difference to the intake-specific text that gets substituted in.

The mechanism already exists and needs no new abstraction: `resolveClassificationInstructions` in `src/adapters/cli/commands/draft-prompts.ts` already swaps the classification paragraph based on whether the task file is synthetic, via the `{{classificationInstructions}}` placeholder. Extend that pattern:

- One common draft prompt. The intake difference is a substituted block — where the intent comes from, and where classification/labels are written — not a second file.
- Adhoc intent comes from the free-text draft input recorded by Parallix, not from a task file.
- Classification/labels (including the `bug` rule that gates the reproduction-test-first requirement) must be readable and writable in both intakes; today the rule text names Backlog task labels.
- `prompts/execute.md`, `prompts/review.md`, and `prompts/act-on-review.md` must carry no stray Backlog task reference in the adhoc case. Sweep every prompt and prompt builder, not only the two that interpolate `{{taskPath}}` today.
- A test asserts the two intakes produce the same prompt except for the substituted intake block, so a future edit to one intake cannot silently skip the other.

Coordinate with task-2465 (core/opinion split of every prompt): the intake difference belongs inside one of those halves as a substitution, not as a third file per stage. Whichever mission lands second reconciles.

## Guards (the point of this task)

The minimal-friction path rotted once without anyone noticing. Keeping it working is the deliverable, not the one-line guard fix.

- Replace the `task-` check in `execute-mission-service.ts` with the existing shared validator (`isMissionSlug` in `src/adapters/filesystem/mission-paths.ts`), extended to the new adhoc identity. One validator, edited in place — no second slug classifier beside it.
- Extend the stubbed-agent lifecycle e2e (`test/e2e-mission-lifecycle.test.ts`, which already runs draft -> active -> review -> integrate against stub `codex`/`opencode` binaries on a fixture PATH) to cover all three intakes: Backlog-only, adhoc-only in a repo with no `backlog/` directory, and mixed. No real model, so it runs in the default suite and is the regression net for the README first-value path.
- The stub parses its slug with `/^Slug:\s*(task-[a-z0-9-]+)/im` and cannot see an adhoc slug at all; widen it with the identity change.
- Assert in the same run that `px status`, `px review`, and `px integrate` accept an adhoc mission, so a prefix assumption added anywhere else fails the suite instead of the user.
- Assert both directions of the mirror: with a Backlog task present, lifecycle transitions still land in the task file (a Backlog.md user keeps seeing them); with the `backlog/` directory deleted mid-mission, `px active`, `px review`, and `px integrate` still complete.
- Cover the id-resolution fallback: rename or move the task file of a Backlog-sourced mission and confirm the mission still resolves.
- Update `test/execute-mission-characterization.test.ts`, which asserts the current refusal.
- Assertions cite files and symbols or test names, never `file.ts:<line>` from another file.

## What broke it (history, so the fix targets the cause)

- `2026-06-24` task-1341 shipped free-text drafting (`adhoc-` slugs, synthetic Backlog task). `px active` had no slug-prefix check then, so an adhoc mission could be activated: the minimal-friction path worked.
- `2026-07-20` task-2276 added the stubbed-agent lifecycle e2e, but only for `task-` slugs — fixtures `task-2001`/`task-2002`, and the stub agent parses `task-` slugs only. The free-text path was never covered.
- `2026-07-21` task-2289 introduced `LegacyActiveAdapter.validateSlug` with `if (!slug.startsWith('task-'))` while moving activation behind a port. That commit broke it; nothing failed, because no test exercised an adhoc activation.
- `2026-08-03` task-2332.04 carried the same line into `src/application/execute-mission-service.ts` and added a characterization test asserting the refusal, cementing the regression as intended behavior.

The guard was never a decision about adhoc missions: it was an assumption copied into a new layer during a refactor, then locked in by a characterization test.

Related: task-1358 asked for exactly this stubbed lifecycle net on `2026-06-26` and was archived `2026-07-02` still in `backlog` status, three weeks before the break.

## Original design (pre-Parallix, `visualBoard/parallix`)

The first implementation had no slug-prefix policy, and identity worked like this:

- The mission slug is whatever follows the mission branch prefix: `extractSlugFromBranch` in `lib/core/mission-utils.js` returns `branch.slice(prefix.length).toLowerCase()`. Branch, directory name, and the worktree registry were the sources of slug identity; only `inferSlug`'s explicit-argument fast path short-circuited on `task-`.
- The task id is derived from the slug: `resolveTaskFile` in `lib/tools/backlog.js` sets `normalizedId = slug.toUpperCase()` and matches frontmatter `id:`, with filename-prefix match first and a base-id fallback for suffixed slugs (`task-1004-modern` -> `TASK-1004`).

That derivation rule still exists today (`src/adapters/backlog/task-file-io.ts`). Keep the property — one derivable identity per mission — while moving the id's origin for adhoc missions from a Backlog.md filename to the DB counter.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
