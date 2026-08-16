# Mission: Dedup goal-check evidence helpers between handoff and review (task-2369.13)

## Goal
Eliminate 5 duplicate goal-check evidence functions from `handoff-command-use-case.ts` by importing them from the canonical `review-static-evidence.ts` module introduced in task-2369.08.

## Why Now
Task-2369.08 extracted evidence helpers to `src/adapters/review/review-static-evidence.ts` for the review adapter. The same logic still lives in `src/application/handoff-command-use-case.ts` (~185 lines of near-identical code). Diverging fixes across both copies will cause bugs. Dedup now before either copy accumulates more changes.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 5 duplicate functions, ~185 lines to remove from handoff-command-use-case.ts; single import swap plus optional parameter on canonical functions

## Scope
- Remove 5 functions from `src/application/handoff-command-use-case.ts`: `collectGoalCheckEvidenceRows()`, `collectRepoTestNames()`, `canonicalSourceContainsFile()`, `evidenceCellHasVerifiableReference()`, `findUnverifiableGoalCheckRow()`
- Update `src/adapters/review/review-static-evidence.ts` canonical functions to accept optional `fileSystem` port parameter (falls back to `node:fs`) so handoff callers using the port and review callers using `node:fs` both work
- Add import in `handoff-command-use-case.ts` from `review-static-evidence.ts`
- Update call sites in `handoff-command-use-case.ts` (lines ~874, ~880) to use imported functions
- Bound gate/hook output embedded in auto-bounce prompts (CP-3): elide to 32 KB head+tail so a single verbose gate failure cannot push a resumed agent session past its model context window (observed: 545 KB gate diagnostic → 191k-token session → pi clamped `max_tokens` to 1 → silent 600 s timeouts)

## Out of Scope
- Changing the review adapter's usage of these functions in `review-commands.ts`
- Adding new evidence-checking logic or criteria
- Modifying the `fileSystem` port interface itself
- Any changes to `review-commands.ts`

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `collectGoalCheckEvidenceRows`, `collectRepoTestNames`, `canonicalSourceContainsFile`, `evidenceCellHasVerifiableReference`, `findUnverifiableGoalCheckRow` each defined exactly once in `src/adapters/review/review-static-evidence.ts` (zero definitions in `handoff-command-use-case.ts`)
- SC2: `handoff-command-use-case.ts` line count reduced by at least 150 lines from pre-mission baseline
- SC3: `review-static-evidence.ts` canonical functions accept optional `fileSystem` parameter; when omitted, functions use `node:fs` (review adapter path); when provided, functions use the port (handoff use-case path)
- SC4: `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc --checkJs + test-hygiene)
- SC5: Handoff command evidence-checking behavior unchanged — existing handoff test assertions still pass
- SC6: Auto-bounce prompts (hook-failure and pre-review gate) embed at most 32,768 characters of gate/hook output as head+tail with an elision marker; failure classification still runs on the untruncated output

## Risks and Assumptions
- The `fileSystem` port used by handoff exposes the same sync methods (`readFileSync`, `readdirSync`, `existsSync`) that `node:fs` provides; if signatures differ, the optional-parameter approach needs a thin adapter
- `review-static-evidence.ts` is already the canonical module (task-2369.08 completed); if that mission is not merged, this mission blocks
- No other file imports the 5 functions from `handoff-command-use-case.ts` (grep `export` usage before removing)

## Checkpoints
- CP 1: Remove 5 duplicate functions from `handoff-command-use-case.ts`, add optional `fileSystem` parameter to canonical functions in `review-static-evidence.ts`, wire import and call sites, verify static-analysis passes
- CP 3: Add `elideBounceOutput` (head+tail, 32 KB cap) and apply it in `hook-failure-workflow.ts` and `review-gate-handling.ts` bounce prompts; add bounded-prompt regression tests

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``, `` `npm test` ``
  2. **Test names** — e.g., `"goal check evidence rows are collected"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/handoff-command-use-case.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| 5 functions defined once in review-static-evidence.ts | `src/adapters/review/review-static-evidence.ts`, `grep -c 'function collectGoalCheckEvidenceRows' src/` returns 1 | PASS |
| handoff-command-use-case.ts reduced by 150+ lines | `wc -l src/application/handoff-command-use-case.ts` (before/after delta) | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `src/adapters/review/review-commands.ts` — do not modify; review adapter usage stays as-is
- `src/application/file-system.port.ts` (or equivalent port definition) — do not change the port interface
- Test files not directly exercising the 5 deduped functions — leave unchanged unless a test breaks

## Stop Rules
- Do not add new evidence-checking logic; this mission only moves existing code
- Do not refactor the review adapter's call sites in `review-commands.ts`
- If the `fileSystem` port interface is incompatible with `node:fs` sync methods, add a thin adapter in `handoff-command-use-case.ts` rather than changing the port contract
- If more than 2 files outside the 2 named files need changes, stop and assess scope creep (CP-3 elision scope is explicitly approved: `src/application/output-elision.ts`, `src/application/hook-failure-workflow.ts`, `src/adapters/review/review-gate-handling.ts`, `test/task-2369.13-bounce-output-elision.test.ts`)