---
id: TASK-2464
title: Split each prompt into a Parallix core and an overridable default
status: refined
assignee: []
created_date: '2026-09-07 10:00'
labels:
  - ai_sdlc
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every file in `prompts/` currently mixes two kinds of instruction that have different owners.

**Parallix operations** are the instructions without which the workflow cannot function. They name
artifact files and paths the loop reads back, the exact verdict and disposition tokens the parser
accepts, the `{{placeholders}}` the harness substitutes, the `px` commands an agent may or may not
run, and the separation-of-duties and safety rules that keep a reviewer from becoming an implementer.
Parallix owns these. A user changing them breaks the machine, so they must not be overridable.

**Cycle opinion** is everything else: how to review, what to look for, what standard of evidence to
demand, how thorough to be, what tone to take. Parallix ships a default because a default is needed,
but this is a matter of taste and house style. A user must be able to replace it.

This task splits each existing prompt along that seam, into a Parallix-owned core prompt and a
shipped default opinion prompt, and lets a repository optionally replace the opinion half.

The default must remain a shipped default. No user should have to maintain this content per
repository to get working behaviour; overriding is opt-in, and a repository that configures nothing
gets exactly today's prompts.

### Required outcome

1. For each of the five files in `prompts/` (`draft.md`, `execute.md`, `review.md`,
   `act-on-review.md`, `portfolio.md`), two files exist: a Parallix core and a shipped default
   opinion prompt.
2. The two halves are assembled at every launch point to produce the agent prompt. With nothing
   configured, the assembled prompt carries the same instruction content the single file carries
   today.
3. A repository may optionally supply its own replacement for the opinion half. When it does, the
   Parallix core is still assembled into the prompt and is not replaceable.
4. `docs/config.md` documents the mechanism, states that overriding is optional, and points at the
   shipped defaults.

### The classification rule

An instruction line belongs to the **core** if and only if removing it would mechanically break the
workflow loop. Concretely, core lines are those that:

- name an artifact path or filename the workflow reads back (`{{artifactDir}}/{{slug}}-review-verdict.txt`,
  `missions/{{slug}}/review-events/`, `CP-N.md`, `Reproduction-Test:`);
- fix a parser-visible format (`Outcome: approve`, exactly `approve` or `request-changes`,
  `## F1:` finding headings, the `| Criterion | Evidence | Status |` table, the `## Goal Check`
  heading, `CHANGES_MADE|PUSHBACK_ALL|PARKED|BLOCKED`);
- constrain which `px`, `git`, or Forgejo operations the agent may run;
- state a safety or separation-of-duties rule (the BLOCKED rule in `act-on-review.md`, the entire
  MUST NOT block in `review.md`);
- describe lifecycle mechanics the harness depends on (do not transition the task, do not edit
  `assignee`, do not hand off with uncommitted checkpoints).

Everything else is **opinion**: "Review as an independent senior engineer", the `Check:` list, the
quality bar for findings, the graphify-first paragraphs, evidence-quality preferences, thoroughness
guidance.

When a single line genuinely carries both, it stays in the core, unchanged. Do not split a line.

<!-- SECTION:GUARDRAILS:BEGIN -->
## Guardrails — read before writing any code

The previous attempt at this work (TASK-2462, abandoned) burned five review rounds and shipped
nothing, because agents invented machinery nobody asked for and then reverted the one change that was
actually requested. These constraints are the deliverable's shape, not advice. Violating one is a
failed mission, not a debatable finding.

### G1. This is a text move, not a rewrite

Every line in a core prompt and every line in a default opinion prompt must appear **byte-identical**
in the corresponding original file at this task's parent commit. Permitted changes to the prompt text
are exactly three:

- a line moves from the original file into one of the two new files;
- leading/trailing blank lines are added or removed at file boundaries;
- a section heading is added at the top of a new file to name it.

Not permitted: rewording, clarifying, improving, merging, expanding or shortening any instruction,
however obviously wrong it looks. If an instruction is wrong, file a Backlog task and leave the text
alone.

### G2. The split must be mechanically proven, not asserted

Ship one test that, for each of the five prompts, reads the original file content at the mission's
parent commit and asserts that the multiset of non-blank lines in `core + default` equals the multiset
of non-blank lines in the original, ignoring only the added file-naming headings. A Goal Check row
claiming "content preserved" without this test failing when a line is edited is not acceptable
evidence.

### G3. Exactly one new configuration key

The configuration surface grows by exactly one key. No per-stage keys. No `prompts.draft`,
`prompts.review`, `prompts.execute`, `prompts.actOnReview`, `prompts.portfolio`. No map, no array, no
per-agent, per-model, per-user or per-mission selection. If per-stage override turns out to be
genuinely necessary to satisfy this description, **stop and ask the operator** — do not build it, and
do not edit `MISSION.md` to authorise it.

### G4. No new abstraction

Forbidden: a prompt templating language, a prompt registry, a resolver class hierarchy, a layering
system with precedence rules, a plugin interface, a factory, an interface with one implementation, a
new dependency. Reuse whatever `src/adapters/config/` and the existing prompt-loading path already do.
The expected shape is: load two files instead of one, concatenate, optionally swap the second for a
repo-local file.

### G5. Diff budget

Non-test, non-prompt, non-doc changes under `src/` should land under 150 changed lines. Exceeding that
is a signal that an abstraction is being built; stop and re-read G4 before continuing. State the
actual number in the final Goal Check.

### G6. Do not touch the locked mission to widen scope

If the drafted `MISSION.md` conflicts with this description, or the work cannot be done inside the
contract, the only permitted responses are: push back with the conflict named, or stop and request
operator direction. Editing `MISSION.md` Scope, Success Criteria, Out of Scope or Restricted Areas to
authorise work the contract forbids is a mission failure regardless of how good the work is.

### G7. Operator direction outranks the drafted contract

If the operator submits a review or a note asking for something the locked contract does not cover,
that is the operator changing the requirements, not contamination. Record it explicitly in the round
resolution artifact, quote it, and state whether it can be done inside the contract. Do not silently
act on it, and do not silently ignore it. Reviewers: work traceable to a quoted operator instruction
is not an out-of-scope finding — verify it against the operator's words, and if it exceeds the
contract, say so as a scope question rather than demanding a revert.

### G8. Reviewers: bounded finding surface

Findings must be defects in the split itself: text that changed when it should have moved, a core line
placed in the overridable half, an override that can remove core content, a launch point that
assembles only one half, a broken default path. Design opinions about how the override "should" work,
requests for additional configuration surface, and requests for extra abstraction are out of bounds.
Do not request changes because the mechanism is simpler than expected — simple is the requirement.
<!-- SECTION:GUARDRAILS:END -->

## Out of scope

- Per-stage, per-agent, per-model, per-user, per-mission or per-repository prompt *selection* beyond
  the single documented override.
- Changing the wording or policy of any existing instruction.
- Runtime prompt editing, a prompt management UI, or a templating language.
- Making any Parallix core instruction configurable or removable.

## Success criteria

- Ten prompt files exist under `prompts/`: a Parallix core and a shipped default opinion prompt for
  each of `draft`, `execute`, `review`, `act-on-review`, `portfolio`.
- A test proves, per prompt, that the non-blank lines of core + default equal the non-blank lines of
  the original at the mission's parent commit, modulo the added file-naming headings; the test fails
  when a moved line is edited.
- With no override configured, each of the five launch points produces a prompt whose instruction
  content matches today's behaviour, proven by a test per launch point.
- With an override configured, the assembled prompt contains the override content and still contains
  every Parallix core instruction; a test asserts a named core instruction survives an override that
  attempts to drop it.
- Exactly one new configuration key is added; a test asserts unknown keys under it are rejected
  through the existing configuration error path.
- The `src/` non-test diff is under 150 changed lines, with the number stated in the final Goal Check.
- `docs/config.md` documents the key, states that the override is optional and that unconfigured
  repositories keep current behaviour, and links the shipped default prompts.

## Stop rules

- Stop and request operator direction if the split cannot be done without changing instruction
  wording.
- Stop and request operator direction if a single configuration key cannot serve all five stages.
- Stop and request operator direction if any launch point cannot assemble two files without a new
  abstraction.
- Never edit the locked `MISSION.md` to authorise work its Out of Scope or Restricted Areas forbid.
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
