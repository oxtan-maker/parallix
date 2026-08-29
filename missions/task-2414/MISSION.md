# Mission: Require static analysis before self-development integration (task-2414)

## Goal
Make `./scripts/verify-local.sh integrate` run `./scripts/verify-local.sh static-analysis` before it starts this repository's configured integration or E2E gates, so test TypeScript errors cannot reach merge or publication work.

## Why Now
TASK-2413 reached late handoff with test TypeScript errors because the integration plan could omit static analysis for a changed-area classification. The existing test-project typecheck already detects those errors; integration must consistently invoke that authority before subsequent gates or merge work.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: The backlog acceptance criteria identify the existing command, resolver behavior, and focused regression surface.
- Main drivers: run static analysis before integration; preserve configured gate ordering and workflow E2E coverage; keep generic integration planning unchanged.

## Scope
- Start static analysis from `gate_integrate` before it dispatches configured integration gates.
- Preserve the existing ordering of all configured gates, including the workflow E2E gate.
- Add a focused hook regression in `test/verify-local-integrate.test.ts`.
- Reuse the existing `tsc --noEmit --project tsconfig.test.json` path through the static-analysis command.
- Do not change the generic integration planner; remove static analysis from the integration configuration because the hook owns it.

## Out of Scope
- Adding a second TypeScript checker, diagnostic allowlist, or warning-only behavior.
- Changing `tsconfig.test.json`, TypeScript diagnostics, non-integration verification plans, or merge/publication semantics unrelated to gate ordering.
- Broad refactoring of integration orchestration or unrelated tests.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `gate_integrate` invokes static analysis before configured integration gates.
- SC2: A failing static-analysis command stops the hook before it starts any configured integration gate.
- SC3: The existing static-analysis command remains the sole test TypeScript authority; no duplicate checker, allowlist, or warning conversion is introduced.
- SC4: Existing configured integration-gate ordering and the workflow E2E gate remain present.

## Risks and Assumptions
- Assumption: `./scripts/verify-local.sh static-analysis` already performs the authoritative `tsc --noEmit --project tsconfig.test.json` check and returns non-zero on a test typecheck failure.
- Risk: static analysis must run only for real integration, not a dry-run that only renders a plan.
- Risk: changing hook order can reorder or omit configured integration gates; preserve the workflow E2E gate.

## Checkpoints
- CP 1: Add a hook regression in `test/verify-local-integrate.test.ts` before changing production code.

Reproduction-Test: test/verify-local-integrate.test.ts

- CP 2: Start static analysis in `gate_integrate` before configured gates, retaining generic integration-plan selection and the established configured-gate order.
- CP 3: Run the focused hook regression and static analysis.
- CP 4: Run the integration verifier and record durable evidence that all success criteria are satisfied.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST lead its evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

It MUST include the exact heading `## Goal Check` followed by this 3-column table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1–SC4 | `test/verify-local-integrate.test.ts`, exact test name, or recognized verification command | PASS/FAIL |

Include one evidence row for every applicable success criterion, a concise work summary, and a non-generic `Next action:` line at the bottom. Raw `stat`/`ls` output or generic prose alone is not evidence: if included, pair it with an accepted command, path, exact test name, or ADR reference.

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh integrate

## Restricted Areas
- Do not modify TypeScript compiler configuration, weaken diagnostics, introduce a duplicate TypeScript check, or convert errors to warnings.
- Limit production changes to this repository's integration hook and removal of its duplicate static-analysis configuration; keep generic integration-plan resolution unchanged.
- Do not change mission workflow status, merge, publication, or remote-push behavior while implementing this gate requirement.

## Stop Rules
- Stop and report if the existing static-analysis command does not run `tsc --noEmit --project tsconfig.test.json`; do not replace it with a new checker without explicit direction.
- Stop and report if adding the preflight requires changing generic integration-plan selection, TypeScript diagnostics, compiler configuration, or merge/publication behavior.
- Stop and report if a hermetic regression cannot observe later gates being skipped without invoking real Forgejo, real agents, or expensive external commands.
