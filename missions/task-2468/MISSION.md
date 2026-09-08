# Mission: Adhoc missions as first-class intake with DB-owned IDs (task-2468)

## Goal
Make free-text adhoc missions first-class lifecycle participants: DB-owned, repository-scoped identity; DB-authoritative lifecycle state; optional Backlog.md mirroring; and one intake-independent prompt set.

## Why Now
The README's free-text first-value path drafts successfully but `px active` rejects the resulting `adhoc-*` slug. This blocks task-2467's demo and leaves lifecycle state load-bearing on a Backlog.md file that an adhoc-only repository does not have.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: database migration and identity allocation; lifecycle reads and mirror writes; prompt rendering parity; three-intake lifecycle regression coverage.

## Scope
- Replace adhoc slug acceptance with the shared mission-slug validator, extended for the chosen `parallix-adhoc-<NNNN>` DB-owned identity.
- Allocate the adhoc counter atomically in `parallix.db`, scoped to a repository, and make slug, mission ID, branch, and worktree suffix derivable from it.
- Migrate existing `adhoc-*` missions or document and implement a supported cutover that leaves their lifecycle resolvable.
- Make mission status and implementer/assignment DB-authoritative; treat Backlog.md task files as best-effort, one-way mirrors linked through external task references.
- Preserve required task-file resolution when drafting an explicit Backlog.md `task-<N>` mission.
- Keep one draft prompt and substitute only intake-specific intent and classification instructions; remove adhoc-inapplicable Backlog task references from execute, review, and act-on-review prompts/builders.
- Add stubbed lifecycle coverage for backlog-only, adhoc-only without `backlog/`, and mixed repositories, including loss or relocation of a mirrored task file mid-mission.

## Out of Scope
- Changing Backlog.md's user interface or removing lifecycle mirrors for Backlog-backed missions.
- Creating separate per-intake prompt files.
- Changing the lifecycle semantics of Backlog-backed missions beyond making their DB authority explicit.
- Real-model agent tests, remote service changes, or task-2465's broader core/opinion prompt split beyond reconciliation required by the shared substitution point.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A free-text draft receives a repository-scoped DB-allocated `parallix-adhoc-<NNNN>` identity, and `px active`, `px status`, `px review`, and `px integrate` accept that identity without a Backlog task file.
- `test/e2e-mission-lifecycle.test.ts` exercises complete stubbed lifecycles for exactly these intake cases: Backlog-only, adhoc-only with no `backlog/` directory, and mixed; its stub slug parser recognizes the new adhoc identity.
- In the lifecycle regression coverage, Backlog-backed transitions continue to mirror status and assignment to the task file, while deletion or relocation of that file after drafting does not prevent active, review, or integrate from completing.
- Mission lifecycle status and implementer/assignment are read from DB authority rather than task-file contents; Backlog-backed missions record an external task reference and mirror changes one-way.
- Explicit `px draft task-<N>` still rejects a missing or ambiguous requested task file with a clear error.
- All lifecycle prompt stages use one common draft prompt plus an intake-specific substitution block; regression coverage proves the two rendered intake prompts differ only in that block and adhoc renderings contain no task-file instruction.
- The existing adhoc-activation characterization is updated from refusal to supported behavior, and the red reproduction test below passes after the fix.

## Risks and Assumptions
- Risk: DB schema changes can orphan existing adhoc missions. Assumption: a migration or explicit cutover can map every discovered legacy `adhoc-*` mission to a stable DB identity before lifecycle commands rely on it.
- Risk: optional mirror writes can hide filesystem failures. Assumption: commands report actionable mirror diagnostics while completing when DB state is valid.
- Risk: task-2465 may alter prompt composition concurrently. Assumption: the second mission reconciles at the shared substitution boundary without creating prompt forks.

## Checkpoints
- CP 1: Add `test/task-2468-adhoc-lifecycle-repro.test.ts` before implementation. It must draft a free-text adhoc mission and assert that the parent commit's `px active <adhoc-slug>` succeeds; on the parent commit the current `task-` prefix guard makes this assertion fail (red), and it passes after the supported adhoc identity and lifecycle work land (green).

Reproduction-Test: test/task-2468-adhoc-lifecycle-repro.test.ts

- CP 2: Implement and migrate DB-owned adhoc identity, shared slug validation, DB-authoritative lifecycle reads, and optional external-task mirroring; preserve explicit Backlog task drafting failures.
- CP 3: Consolidate intake-independent prompt rendering and add prompt-parity coverage plus the three-intake stubbed lifecycle regression net, including missing/moved mirror behavior.
- CP 4: Run the required gate, record durable Goal Check evidence, and reconcile prompt composition with task-2465 if it landed first.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Exact test names, ADR references (including `ADR 0053` where authority is claimed), test file paths such as `test/e2e-mission-lifecycle.test.ts` and `test/task-2468-adhoc-lifecycle-repro.test.ts`, and recognized repository commands/paths such as `npm test -- --unit-test-headroom`, `git status --short`, `px active <slug>`, or `./scripts/verify-local.sh all` as its durable evidence forms. File:line references are accepted parenthetically when necessary but discouraged because line numbers rot.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with one evidence row for every Success Criterion.
- A concise work summary and a concrete `Next action:` line at the bottom.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted command, path, exact test name, or ADR reference above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not create a second slug classifier, per-intake prompt copies, or a content-hash adhoc identity.
- Do not make a Backlog task file, its status, or its assignee load-bearing for active, status, review, integrate, handoff, rebase, or stats.
- Do not remove task-file mirroring where an external Backlog task exists.
- Do not use real Forgejo or real model agents in unit or lifecycle coverage.

## Stop Rules
- Stop and escalate if a safe migration/cutover cannot preserve lifecycle resolution for an existing `adhoc-*` mission.
- Stop and coordinate with task-2465 if its prompt split conflicts with a single shared intake substitution point.
- Stop before any change that requires Backlog.md to complete an adhoc lifecycle command, or that makes DB authority and file mirroring bidirectional again.
