# Mission: Stop the workflow from demanding file:line evidence that rots (task-2360)

## Goal
Shift the Parallix evidence contract from recommending `file.ts:<line>` citations to recommending stale-proof forms (backticked commands, test names, ADR references, test file paths) everywhere the workflow instructs agents. The validator still accepts `file:line` — only the guidance, worked examples, and default templates change.

## Why Now
TASK-2332.08 shipped an auto-generated CP-1 template that cited `handoff.ts:277`; a test asserted that literal string. Unrelated edits broke the line, burning iterations. The incentive that produced it — prompts, gatekeeper pushback, repair-handoff worked examples, and the DOD default — still pushes `file:line` first. The validator does not even check the line number (only file existence), so the number is decorative and always eventually wrong.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-as
- Main drivers: prompt text edits, doc-standards addition, error-message rewording, one new static check in verify-local.sh

## Scope
- Prompt templates (`prompts/execute.md`, `prompts/review.md`, `prompts/draft.md`): replace `file:line` recommendation with stale-proof forms; remove `file:line` from worked examples
- Mission scaffold template (`templates/mission-scaffold.md`): update Checkpoint Documentation Requirements to lead with stale-proof forms; remove `file:line` from example table
- Handoff error messages (`src/application/handoff-command-use-case.ts`): list `file:line` last or parenthetical in unverifiable-row error; remove `file:line` from gatekeeper pushback body
- Review error messages (`src/adapters/review/review-commands.ts`): list `file:line` last or parenthetical in unverifiable-row error
- Gatekeeper pushback (`src/adapters/verification/gatekeeper.ts`): replace `file:line` in checkpoint-creation instruction with stale-proof forms
- Repair-handoff prompt (`src/adapters/cli/commands/repair-handoff.ts`): list `file:line` last among accepted forms; remove `file:line` from worked example
- Active command error (`src/adapters/cli/commands/active.ts`): replace `file:line` in checkpoint-creation instruction with stale-proof forms
- Domain JSDoc (`src/domain/checkpoint.ts`): update comment to list stale-proof forms first
- `docs/doc-standards.md`: add explicit rule that new authored docs, ADRs, prompt templates, and generated evidence must not introduce `file.ts:<line>` citations
- `./scripts/verify-local.sh` (docs gate): add a check that fails when `file.ts:<line>` pattern appears in live authored documentation, ADRs, or prompt templates

## Out of Scope
- Historical checkpoint documents under `missions/` — frozen records, untouched
- The evidence validator's acceptance logic — `file:line` rows still pass; only recommendation changes
- The validator's line-number checking behavior (it already only checks file existence)
- Backlog task DOD sections in existing tasks — those are historical per-task artifacts
- Any change to what counts as *sufficient* evidence (a row must still cite something real)

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-facing, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `prompts/execute.md` contains zero occurrences of `file:line` as a recommended evidence form; stale-proof forms (backticked commands, test names, ADR references, test file paths) are named instead
- SC2: `prompts/review.md` contains zero occurrences of `file:line` as a recommended evidence form; stale-proof forms are named instead
- SC3: `prompts/draft.md` Checkpoint Documentation Requirements block lists stale-proof forms as the primary evidence types; `file:line` absent or parenthetical
- SC4: `templates/mission-scaffold.md` example Goal Check table contains zero `file:line` worked examples; all example evidence cells use stale-proof forms (test name, test path, ADR, or backticked command)
- SC5: `src/application/handoff-command-use-case.ts` unverifiable-row error message lists `file:line` last or parenthetical among accepted forms
- SC6: `src/adapters/review/review-commands.ts` unverifiable-row error message lists `file:line` last or parenthetical among accepted forms
- SC7: `src/adapters/verification/gatekeeper.ts` checkpoint-creation instruction names stale-proof forms; no `file:line` as the worked example
- SC8: `src/adapters/cli/commands/repair-handoff.ts` repair prompt lists `file:line` last among accepted forms; worked example contains zero line numbers
- SC9: `src/adapters/cli/commands/active.ts` checkpoint-creation instruction names stale-proof forms; no `file:line` as the worked example
- SC10: `src/domain/checkpoint.ts` JSDoc comment lists stale-proof forms before `file:line`
- SC11: `docs/doc-standards.md` states the rule that new authored docs, ADRs, prompt templates, and generated evidence must not introduce `file.ts:<line>` citations, with the reason (line numbers rot)
- SC12: `./scripts/verify-local.sh docs` fails when a `file.ts:<line>` pattern is found in live authored documentation (`docs/*.md`), ADRs (`docs/adr/*.md`), or prompt templates (`prompts/*.md`)
- SC13: The evidence validator (`evidenceCellHasVerifiableReference`) still accepts `file:line` rows — acceptance logic unchanged
- SC14: Existing checkpoint documents under `missions/` are untouched — no files modified
- SC15: `./scripts/verify-local.sh all` passes on the final tree

## Risks and Assumptions
- Risk: The new `file.ts:<line>` static check in verify-local.sh may produce false positives for legitimate cross-references (e.g. ADRs citing a line in a spec). Mitigation: scope the check to authored docs, ADRs, and prompts only — not checkpoint documents or backlog tasks
- Risk: Agents already trained on `file:line` may continue using it. Mitigation: the repair-handoff prompt and gatekeeper pushback are the primary touchpoints — updating those drives behavior
- Assumption: The `file:line` regex pattern `[\w./-]+\.[\w-]+:\d+` is sufficient to detect the anti-pattern in prose
- Assumption: No test asserts on the exact text of the error messages being changed (or tests are flexible enough to absorb rewording)

## Checkpoints
- CP 1: Update prompt templates (`prompts/execute.md`, `prompts/review.md`, `prompts/draft.md`) and mission scaffold (`templates/mission-scaffold.md`) — remove `file:line` as primary recommendation; replace with stale-proof forms; update worked examples
- CP 2: Update error messages and guidance in source files (`handoff-command-use-case.ts`, `review-commands.ts`, `gatekeeper.ts`, `repair-handoff.ts`, `active.ts`, `checkpoint.ts`) — list `file:line` last or parenthetical; remove `file:line` from worked examples
- CP 3: Add `docs/doc-standards.md` rule and `./scripts/verify-local.sh docs` static check for `file.ts:<line>` drift in live authored docs, ADRs, and prompts; verify all gates pass

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  3. **Exact test names** — e.g., `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` (must match a test name in the repo)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file; the line number is decorative and eventually stale — prefer the forms above)
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- **Weak-agent failure mode:** raw `stat`/`ls` output or generic prose alone is not sufficient evidence — always pair shell output with a recognized command, test name, test file path, ADR reference, or file:line reference
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Prompt templates updated | `prompts/execute.md`, `prompts/review.md`, `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `` `./scripts/verify-local.sh docs` `` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `missions/` directory — existing checkpoint documents are frozen records; do not modify
- Evidence validator logic in `evidenceCellHasVerifiableReference` — acceptance behavior must not change
- `src/domain/checkpoint.ts` interface shape — only JSDoc comment changes

## Stop Rules
- Do not modify the evidence validator's acceptance logic — `file:line` rows must still pass
- Do not modify existing checkpoint documents under `missions/`
- Do not change what counts as *sufficient* evidence (a row must still cite something real)
- If a test asserts on exact error message text and breaks, fix the test to match new wording — do not revert the message change
- If verify-local.sh docs check produces more than 3 false positives in scope files, narrow the regex or add a `.graphifyignore`-style exclusion list before expanding scope
