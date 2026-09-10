---
id: TASK-2465
title: Split each prompt into a Parallix core and an overridable default
status: done
assignee: [claude]
created_date: '2026-09-07 08:21'
labels:
  - ai_sdlc
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every file in prompts/ mixes two things with different owners.

  Parallix operations — the instructions without which the workflow breaks: artifact paths and filenames the loop reads back, exact verdict/disposition tokens the parser accepts, {{placeholders}} the harness substitutes, which px/git/Forgejo commands an agent may run, separation-of-duties and safety rules. Parallix owns these. Not overridable.

  Cycle opinion — everything else: how to review, what to look for, evidence standards, thoroughness, tone. Parallix ships a default because a default is needed, but it's taste. A user must be able to replace it.

  Do this: split each of the five prompts (draft, execute, review, act-on-review, portfolio) into a core file and a default opinion file. Assemble both at every launch point. A repo may optionally replace the opinion half; the core is always assembled in and can't be removed. Nothing configured = today's prompts, byte for byte. Document it in docs/config.md.

  Classification rule: a line is core if and only if removing it mechanically breaks the loop — artifact paths, parser-visible formats (Outcome: approve, ## F1:, | Criterion | Evidence | Status |, ## Goal Check, CHANGES_MADE|PUSHBACK_ALL|PARKED|BLOCKED), command constraints, safety/separation-of-duties, lifecycle mechanics. Everything else is opinion. A line carrying both stays
  in core, unchanged. Never split a line.

  Guardrails — violating one is a failed mission, not a debatable finding:

  1. Text move, not rewrite. Every line in both new files must be byte-identical to a line in the original at the parent commit. Only permitted changes: a line moves; blank lines at file boundaries; one heading naming the new file. No rewording, clarifying, or improving — however wrong the text looks. Wrong instruction? File a task, leave it alone.
  2. Prove it mechanically. One test per prompt asserting the non-blank line multiset of core + default equals the original's at the parent commit, modulo the added headings. It must fail if a moved line is edited. "Content preserved" without this test is not evidence.
  3. Exactly one new config key. No prompts.draft/review/execute/actOnReview/portfolio. No map, array, per-agent, per-model, per-user, per-mission selection. If per-stage seems necessary — stop and ask. Don't build it, don't edit MISSION.md to authorise it.
  4. No new abstraction. No templating language, registry, resolver hierarchy, layering with precedence rules, plugin interface, factory, one-implementation interface, new dependency. Shape is: load two files instead of one, concatenate, optionally swap the second for a repo-local file.
  5. Diff budget. Non-test, non-prompt, non-doc changes under src/ stay under 150 lines. Over that means an abstraction is being built — stop, re-read G4. State the actual number in the Goal Check.
  6. Never widen scope by editing the locked mission. Contract conflicts with this? Push back naming the conflict, or stop and ask. Editing Scope / Success Criteria / Out of Scope / Restricted Areas to authorise forbidden work is a failure no matter how good the work is.
  7. Operator direction outranks the drafted contract. An operator note asking for something the contract doesn't cover is the requirements changing, not contamination. Quote it in the round resolution, state whether it fits the contract. Don't silently act on it, don't silently ignore it. Reviewers: work traceable to a quoted operator instruction is not an out-of-scope finding —
     verify it against the operator's words; if it exceeds the contract, raise it as a scope question, not a revert demand.
  8. Reviewers: bounded findings. Only defects in the split — text that changed instead of moving, a core line in the overridable half, an override that can drop core content, a launch point assembling one half, a broken default path. Out of bounds: design opinions on how the override "should" work, requests for more config surface, requests for more abstraction. Simpler than
     expected is the requirement, not a finding.

  Out of scope: prompt selection beyond the single override (per-stage, agent, model, user, mission, repo); changing any instruction's wording or policy; runtime prompt editing, a management UI, a templating language; making any core instruction configurable.

  Success criteria:
  - Ten files in prompts/ — core + default for each of the five stages.
  - Line-preservation test passes per prompt and fails when a moved line is edited.
  - With no override, each of the five launch points produces today's instruction content — one test per launch point.
  - With an override, the assembled prompt contains the override and every core instruction; a test asserts a named core instruction survives an override trying to drop it.
  - Exactly one new config key; a test asserts unknown keys under it are rejected via the existing config error path.
  - src/ non-test diff under 150 lines, number stated in the final Goal Check.
  - docs/config.md documents the key, says the override is optional and unconfigured repos keep current behaviour, links the shipped defaults.
  
  Stop rules: stop and ask if the split can't be done without changing wording; if one config key can't serve all five stages; if any launch point can't assemble two files without a new abstraction. Never edit the locked MISSION.md to authorise what its Out of Scope or Restricted Areas forbid.
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
