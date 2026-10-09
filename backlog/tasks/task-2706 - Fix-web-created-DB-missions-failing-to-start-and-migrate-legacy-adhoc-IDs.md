---
id: TASK-2706
title: Fix web-created DB missions failing to start and migrate legacy adhoc IDs
status: backlog
assignee: []
created_date: '2026-10-09 18:41'
labels:
  - bug
dependencies: []
priority: high
ordinal: 208008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Web-created DB-owned missions still cannot enter drafting. TASK-2701 is marked done, but changing existing parallix-adhoc-XXXX IDs to px-XXXX alone leaves the launch broken.

Observed on 2026-10-09: read-only inspection of the operator database found four unfinished missions in repository parallix, all backlog: parallix-adhoc-0004 (Ensure there is a way to update a mission), 0005 (Build a publication-ready engineering case study from the Parallix recovery experiments), 0006 (Research mission), 0007 (improve active stage overhead speed). No records were renamed.

Current production creation uses allocateAdhocIdentity and produces px-XXXX. Board draft:create loads the mission then calls the production draft workflow with that ID. resolveDraftTarget('px-0004') returns existingAdhocIdentity=true and syntheticTask=null. validateDraftTask then rejects a missing Backlog task because syntheticTask is null. Separately isMissionSlugCandidate('parallix-adhoc-0004') returns false.

Focused executable reproduction ran the actual createDraftWorkflowAdapter.preflight(['px-0004'], {}) with repository/bootstrap/branch boundaries replaced by inert doubles and resolveTaskFileFn returning {ok:false,matches:[],reason:'no task file'}. Result: exited=true, syntheticTask=null, allocations=0, error='No Backlog task file for px-0004'. No agent, worktree, live DB write, or repository bootstrap was run. This proves the preflight failure, not a completed browser E2E.

Fix the DB-owned existing-mission draft path using persisted mission planning fields, preserve its existing ID and counter, and verify all later lifecycle steps tolerate absence of a Backlog mirror. Provide an atomic, collision-safe migration for existing parallix-adhoc identities and their references after the workflow works. Preserve mission content, dependencies, history, idempotency, repository ownership and counter uniqueness; inspect all durable references rather than updating only missions.id. Extend the owning board/draft contract suites with a retained red-to-green reproduction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A web-created px-XXXX backlog mission without a Backlog task file can be drafted and started under the same identity, preserving its title, description, brief, labels, criteria and dependencies.
- [ ] #2 A retained focused regression fails on parent behavior and passes with the fix; manually verify web create then draft/start using isolated state and capture evidence.
- [ ] #3 Verify DB-owned missions pass handoff, review and integration without requiring a Backlog mirror.
- [ ] #4 After workflow verification, migrate existing parallix-adhoc-XXXX missions to unique px-XXXX identities atomically with all durable references preserved, collision checks and rollback protection.
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
