---
id: TASK-2709
title: Fix automatic rebase losing implementer launcher configuration
status: done
assignee: [claude]
created_date: '2026-10-10 05:55'
labels:
  - bug
dependencies: []
priority: high
ordinal: 211008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Automatic pre-review rebase must deliver conflict-resolution work to the recorded implementer using the runtime configuration resolved by composition.

Incident: task-2705 on 2026-10-10. The latest mission Codex session was 01a121fd-ca73-7170-8035-2ea53f0f6815, retained under .workflow/codex-home/.codex/sessions/2026/10/09/. Its resumed act-on-review run execute-codex-a1-mv1yqppz finished successfully at 05:46:42.938Z with commit be584befb4. At 05:46:43 the pre-review rebase onto d681b75f69 stopped while replaying edc412938c, with four shared conflicts. Operational history records the review command exiting 1; no conflict-resolution run or rebase prompt exists in the provider transcript. The user had to request manual recovery. Rebase was manually completed in the task-2705 worktree.

Measured failure: workflowLauncherStatus('codex', cwd) returns supported=false, health=missing; the same call with resolveConfiguration(process.env) returns supported=true, health=ok. This read-only reproduction uses the installed Codex launcher without running an agent. DEFAULT_CONFIGURATION has forwardedEnvironment={} and searchPath=''.

Code trace: src/adapters/review/review-loop.ts builds rebaseWorkflowOptions with missionServicesFn but omits bindings.configuration. src/adapters/review/rebase.ts forwards these options to createRebaseWorkflowPort. That factory wraps startAgent with options.configuration; the launcher falls back to DEFAULT_CONFIGURATION. The conflict resolver pins the implementer, so launcher availability failure terminates recovery before Codex receives buildRebasePrompt. Ordinary review-response launches explicitly carry bindings.configuration and succeeded. Preserve composition ownership and typed application ports; carry the resolved value through existing adapter seams rather than reading process.env below composition. Audit standalone and integration rebase callers for the same omission.

Related evidence gap: the run manifest and execute session marker report no provider session ID despite stderr containing session id: 01a121fd-ca73-7170-8035-2ea53f0f6815; native transcript is under codex-home/.codex/sessions whereas run-session.ts searches codex-home/sessions. Do not let this obscure launch failures; assess whether separate follow-up is appropriate.

Scope: repair automatic conflict-resolution configuration propagation and retain focused regression coverage in the existing pre-review/rebase and launcher contracts. Do not change lifecycle policy or weaken pinned implementer eligibility.
Operator requirement (2026-10-10, task-2707): shared-file conflicts must not be treated as an instruction to stop agents or Parallix. Agents normally resolve these conflicts. Automatic rebase must hand conflicts to the recorded implementer and continue through every successive normal conflict stop until the mission is rebased onto main. Audit stop policies and prompts as well as launcher configuration; do not require manual intervention solely because a conflicted file is shared. Genuine unrecoverable failures must remain explicit and recoverable rather than claiming success.

Additional reproduction: task-2707 was left in an interactive rebase with a modify/delete conflict in package-lock.json while migrating development installs to pnpm. Keeping the intended deletion and continuing completed the remaining seven commits; a subsequent rebase onto the latest local main also completed. Retain coverage for shared lockfile modify/delete conflicts and multiple successive conflicts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pre-review rebase forwards the exact composition-resolved configuration to the conflict-resolution implementer launcher, preserving environment, executable discovery, state home and CLI identity.
- [ ] #2 A focused regression is red on the current omission and green with the fix; cover the composed pre-review path and pinned implementer launch rather than only a stubbed startAgent.
- [ ] #3 Audit standalone and integration rebase paths for equivalent configuration loss; preserve ports, adapter boundaries and composition authority.
- [ ] #4 In a disposable repository, manually demonstrate shared conflicts automatically reaching the recorded implementer, completing rebase and final verification before renewed independent review; do not mutate operator missions or statistics.
- [ ] #5 Launch failures report the actual unavailable executable or configuration cause and leave recoverable rebase state; never report a successful rebase while conflicts remain.
- [ ] #6 Shared-file conflicts in standalone, pre-review and integration rebases automatically reach the recorded implementer; neither prompts nor orchestration stop solely because a conflicted path is shared.
- [ ] #7 Recovery continues through successive normal Git conflict stops, including shared lockfile modify/delete conflicts, preserving upstream changes and mission intent; completion is reported only after Git confirms no rebase or unresolved entries remain and main is an ancestor.
- [ ] #8 Retain focused red-to-green regressions for premature shared-conflict stops and manually demonstrate multi-stop recovery in an isolated disposable repository.
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
