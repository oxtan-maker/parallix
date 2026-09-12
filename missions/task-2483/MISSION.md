# Mission: Tell reviewers which controls already ran (task-2483)

## Goal
Inject a compact, machine-derived "already-executed controls" block into the review prompt so a reviewer agent knows which verification gates, declared `## Gates` commands, configured lifecycle gates (`adapters.gates`), and static checkpoint-evidence checks the workflow has already run — and is instructed not to re-run the ones that passed.

## Why Now
`prompts/review-core.md` currently carries one vague line ("The workflow runs the declared verification gate before this review") with no data: no command, no status, no timestamp. Reviewers therefore re-run test suites and re-derive gate state from prose, burning tokens and wall-clock on work the harness already did deterministically. The facts already exist and are cheap to read: `recordGateResult` writes `.workflow/gate-result.json` (`src/adapters/verification/verification.ts`), `loadRepositoryGates` exposes the per-phase test-pyramid configuration (`src/adapters/config/repository-gates.ts`), handoff validates and executes the mission's `## Gates` list (`HandoffCommandUseCase.validateDeclaredGates`), and handoff already rejects checkpoints whose Goal Check rows lack a verifiable reference (`src/adapters/review/review-static-evidence.ts`). Surfacing those recorded facts is a prompt-plumbing change, not new enforcement.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one new builder function plus placeholder wiring in `src/adapters/review/review-prompts.ts`, an instruction rewrite in `prompts/review-core.md`, a lockstep update of the `review` entry in `test/fixtures/prompt-split-parent.json`, new unit tests, and a docs note.

## Scope
- Add a controls-summary builder (default name `buildCompletedControlsBlock`) in `src/adapters/review/review-prompts.ts`. Do not create a new module unless an architecture boundary guard rejects the placement.
- The block is derived only from recorded machine facts, never from agent prose (ADR 0048): the resolved verification command with the `status`, `exitCode`, and `recordedAt` values read from the mission's `.workflow/gate-result.json`; the configured `adapters.gates` `preHandoff` and `preReview` commands with their phase keys; the `## Gates` command lines parsed from the mission's `MISSION.md`; a one-line statement that handoff already validated checkpoint Goal Check structure and evidence references; and, only when `MISSION.md` contains a `Reproduction-Test:` line, a one-line statement that the red→green reproduction gate ran.
- Substitute the block into a new `{{completedControls}}` placeholder in `buildCompactReviewPrompt` (and therefore `buildReviewPrompt`, which delegates to it).
- Rewrite the vague verification line in `prompts/review-core.md` into the `{{completedControls}}` placeholder plus an explicit rule: do not re-run a listed command whose recorded status is `passed`; cite the block instead. Re-running is permitted only when the block reports no recorded result, a `failed` status, or a command that is not listed.
- Update the `review` entry of `test/fixtures/prompt-split-parent.json` in the same commit so `test/prompt-split.test.ts` stays green, leaving the `draft`, `execute`, `act-on-review`, and `portfolio` entries byte-identical.
- Add unit tests covering: block content for a recorded passing gate, block content for a recorded failing gate, the degraded no-record single line, the `Reproduction-Test:` conditional line, the character/line budget, and the absence of an unsubstituted `{{completedControls}}` in the assembled prompt.
- Document the new placeholder where prompt placeholders and prompt overrides are described (`docs/config.md` prompts section).

## Out of Scope
- Changing gate execution, handoff enforcement, gatekeeper behaviour, or the `.workflow/gate-result.json` record schema.
- Changing `prompts/act-on-review-core.md`, `prompts/execute-core.md`, `prompts/draft-core.md`, `prompts/portfolio-core.md`, or the overridable opinion halves.
- Adding a new configuration key, CLI flag, or dependency.
- Changing `px status` output or the review-history block it renders.
- Skipping, weakening, or auto-approving any existing review obligation; the block removes duplicated *execution*, not reviewer judgement.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- **SC1:** `prompts/review-core.md` contains the literal string `{{completedControls}}` exactly once, and no longer contains the standalone sentence `The workflow runs the declared verification gate before this review.`
- **SC2:** For a mission whose `.workflow/gate-result.json` records `{"status":"passed"}`, the prompt returned by `buildCompactReviewPrompt` contains that record's `command`, `status`, `exitCode`, and `recordedAt` values, and contains no `{{completedControls}}` substring.
- **SC3:** When `adapters.gates.preHandoff` and `adapters.gates.preReview` are configured, the rendered block lists each configured gate `command` together with its phase key (`preHandoff` / `preReview`).
- **SC4:** Every command line parsed from the mission `MISSION.md` `## Gates` checklist appears in the rendered block.
- **SC5:** With no `.workflow/gate-result.json`, no configured `adapters.gates`, and no `## Gates` lines, the block renders as exactly one non-blank line stating that no gate result is recorded and that re-running is permitted.
- **SC6:** The rendered block is at most 12 non-blank lines and at most 900 characters in every case exercised by the new tests, including the fully-populated case.
- **SC7:** The block contains the `Reproduction-Test:` red→green line when and only when the mission `MISSION.md` contains a `Reproduction-Test:` line.
- **SC8:** `prompts/review-core.md` states that a listed command with recorded status `passed` must not be re-run and must be cited from the block, and that re-running is permitted when the block reports no record, a `failed` status, or an unlisted command.
- **SC9:** `test/prompt-split.test.ts` passes, with only the `review` value of `test/fixtures/prompt-split-parent.json` changed and the `draft`, `execute`, `act-on-review`, and `portfolio` values byte-identical to their pre-mission content.
- **SC10:** `test/review-prompts.test.ts` still passes unchanged in intent — specifically `"buildCompactReviewPrompt reads from template and substitutes all variables"` and `"buildCompactReviewPrompt substitutes {{reviewBaseline}} with the provided SHA and leaks no placeholder"` pass on the final tree.
- **SC11:** `docs/config.md` describes the `{{completedControls}}` placeholder and names its data sources (`.workflow/gate-result.json`, `adapters.gates`, mission `## Gates`).
- **SC12:** `./scripts/verify-local.sh all` exits 0 on the final tree.

## Risks and Assumptions
- **Fixture lockstep:** `test/prompt-split.test.ts` compares `prompts/review-core.md` + `prompts/review.md` against the frozen `test/fixtures/prompt-split-parent.json` baseline. Any edit to `review-core.md` fails `task-2465-2` until the fixture's `review` entry is updated in the same commit. Do not "fix" this by loosening the multiset comparison.
- **Placeholder leakage:** `assembleStagePrompt` does no templating; substitution happens in `buildCompactReviewPrompt` only. A repo-local prompt override that mentions `{{completedControls}}` must still be substituted, because substitution runs after assembly.
- **Fail-closed honesty (ADR 0048):** the block must state only what a recorded exit code proves. Never render "passed" from anything other than `exitCode === 0` in the record, and never infer a gate ran because it is configured.
- **Missing/unreadable artifact:** `.workflow/gate-result.json` is gitignored and may be absent (removed worktree, fresh clone, board-side render). Reading it must never throw; an unreadable file degrades to the SC5 single line.
- **Assumption:** the mission's `.workflow/gate-result.json` for a review lives in the same mission directory that `missionPath` resolves to, so the block can locate it from the arguments `buildCompactReviewPrompt` already receives.
- **Token-efficiency assumption:** the block replaces reviewer re-execution, so a cap of 900 characters is a net reduction; if the populated case exceeds the cap, truncate the lowest-value rows (configured gates for phases other than `preHandoff`/`preReview`) rather than raising the cap.

## Checkpoints
- CP 1: Implement `buildCompletedControlsBlock` in `src/adapters/review/review-prompts.ts` with unit tests in a new `test/task-2483-completed-controls.test.ts` covering SC2–SC7 (passing record, failing record, no record, configured `adapters.gates`, mission `## Gates` lines, `Reproduction-Test:` conditional, 12-line / 900-character budget).
- CP 2: Wire `{{completedControls}}` into `buildCompactReviewPrompt`, rewrite the verification instruction in `prompts/review-core.md` (SC1, SC8), update the `review` entry of `test/fixtures/prompt-split-parent.json` (SC9), document the placeholder in `docs/config.md` (SC11), and run `./scripts/verify-local.sh all` (SC12).

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2483-completed-controls.test.ts` ``, `` `node --test test/prompt-split.test.ts` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"buildCompactReviewPrompt substitutes {{reviewBaseline}} with the provided SHA and leaks no placeholder"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/review-prompts.test.ts`, `test/prompt-split.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose is not sufficient evidence on its own: a shell transcript may appear as supplemental context only when it is paired with one of the accepted references above. "I verified the block renders" with no command, test name, test file, or ADR reference fails the check.
- Cite each success criterion by its SC number in the Criterion column so the Goal Check table maps one-to-one onto SC1–SC12.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1: review-core.md carries the placeholder once | `prompts/review-core.md`, `test/task-2483-completed-controls.test.ts` | PASS |
| SC5: no-record case degrades to one line | `npm test -- test/task-2483-completed-controls.test.ts` | PASS |
| SC9: prompt-split fixture updated in lockstep | `test/prompt-split.test.ts`, `test/fixtures/prompt-split-parent.json` | PASS |
| SC12: verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/adapters/verification/verification.ts` — read `GATE_RESULT_RELATIVE_PATH` and the `GateResultRecord` shape; do not change `recordGateResult` or the record schema.
- `src/application/handoff-command-use-case.ts`, `src/adapters/cli/commands/handoff.ts`, `src/adapters/review/review-gate-handling.ts`, `src/adapters/verification/gatekeeper.ts`, `src/adapters/verification/redgreen.ts` — enforcement paths, read-only for this mission.
- `src/adapters/config/repository-gates.ts` — call `loadRepositoryGates`/`loadPhaseGates`; do not add gate phases or config keys.
- `test/fixtures/prompt-split-parent.json` — only the `review` value may change.
- `prompts/*-core.md` other than `prompts/review-core.md`, and every `prompts/<stage>.md` opinion half — untouched.

## Stop Rules
- Stop and report if keeping the populated block within 12 non-blank lines and 900 characters would require dropping a recorded gate status, a configured `adapters.gates` command, or a mission `## Gates` command.
- Stop and report if `{{completedControls}}` cannot be substituted for a repo-local prompt override without changing `assembleStagePrompt`'s load-two-files-and-concatenate shape.
- Stop and report if an architecture boundary guard rejects reading `.workflow/gate-result.json` or `adapters.gates` from `src/adapters/review/review-prompts.ts`, rather than relaxing the guard.
- Stop and report if satisfying SC9 appears to require editing any fixture entry other than `review`, or relaxing the multiset comparison in `test/prompt-split.test.ts`.
- Stop and report if `./scripts/verify-local.sh all` fails on the parent commit; a red baseline is a separate finding, not something to repair inside this mission.
