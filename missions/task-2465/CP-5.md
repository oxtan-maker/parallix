# CP-5 — Round-4 review resolution (scope question on override/core conflict, CP-4 table, throughput doc)

## Work done

Resolved round-4 (reviewer: claude) `REQUEST_CHANGES` findings F1–F4 on
`mission/task-2465`. Round-3 findings F1–F4 were verified fixed by the reviewer
in this round; F1–F4 here are new. F2 and F3 are concrete fixes. F1 is a genuine
three-way conflict that the mission's own Stop Rules direct me to raise as a
scope question rather than resolve by leaving core content overridable. F4 was
verified correct.

### F1 — override deletes core-classified content from three stages (SCOPE QUESTION)

The round-3 contiguous split made each opinion half the file suffix. For three
stages the suffix contains core-classified content, so a configured
`adapters.prompts.override` (which replaces the opinion half) drops core:

- execute: `{{checkpoint_context}}` (harness placeholder → core) sits *after* the
  graphify paragraph in the parent, so it lands in the opinion suffix.
- draft: the `Finishing:` block (permitted `px`/`verifyCmd` + lifecycle mechanics)
  sits after the graphify paragraph, so it lands in the opinion suffix.
- review: the `You MAY` separation-of-duties exception sits after the graphify
  paragraph, so it lands in the opinion suffix.

Reproduced: `assembleStagePrompt(stage, { overridePath })` with a one-line opinion
file drops `{{checkpoint_context}}` from execute, `Finishing:` from draft, and
`You MAY` from review. `buildExecutePrompt` renders `.replaceAll('{{checkpoint_context}}', ...)`
against a template that no longer contains the placeholder, so the checkpoint
context is silently discarded — a mechanical break of the loop, which is the
mission's own definition of core.

This is unfixable within the mission's constraints: the graphify paragraph
(opinion) interleaves with core blocks in draft and execute, so **no single
contiguous cut is both byte-preserving (SC3) and correctly classified (SC4)**.
Moving the graphify paragraph as a whole-line move would reorder the assembled
prompt and break the ordered-subsequence launch test (the round-3 F3 defect).
Adding a third file or a loader with per-stage selection is a forbidden
abstraction (mission Out of Scope). This is exactly the mission Stop-Rule
condition: "Stop and ask if preserving the split requires changing any prompt
wording or a line cannot be classified without splitting it," and "if a launch
point cannot concatenate two files without adding a forbidden abstraction."

Raised as a scope question requiring a mission decision. Three options the
implementer will not silently choose among:
1. Accept that the opinion half may contain core-classified lines that the
   override cannot actually remove — i.e. relax SC4's guarantee for the three
   interleaved stages and document it.
2. Amend the mission to permit a non-contiguous split with a reordering test
   (reverses the round-3 F3 fix).
3. Permit moving the graphify paragraph as a whole-line move with a reordering
   test (also reverses SC3's ordered check).

No code change was made; the shipped default (no override) remains
byte-perfect for all five stages.

### F2 — CP-4.md missing Goal Check table (FIXED)

`missions/task-2465/CP-4.md` had only `## Work done`, no `## Goal Check` table,
no `Next action:` line, and a `### Gate` section that named the gate without
recording a result. Added the mandatory `## Goal Check` table with one row per
Success Criterion (evidence cites exact test names, file paths, the
`git diff` command and its measured count), a `Next action:` line, and the gate
exit code.

### F3 — throughput metric commit on the branch (documented, kept)

`5998e70d4 docs: add throughput metric to statistics contract` adds one row
("Throughput / weekly throughput") to `docs/metric-contract.md`. It is outside
the mission's literal Scope (which limits documentation work to `docs/config.md`),
but `test/metric-contract.test.ts` already asserted that row existed before the
commit while the doc lacked it — i.e. the commit fixed a pre-existing test
failure and is required for the gate. Removing it would break the gate, so it is
kept and recorded here as scope-adjacent. It is not part of the prompt-split
goal.

### Gate

`./scripts/verify-local.sh all` → exit code 0 (2473 tests pass, 0 fail). Static
analysis (ESLint + `tsc --checkJs` + test-hygiene) clean. Qualifying `src/` diff
73 added lines (unchanged from round-3; the F2/F3 changes are prompt/doc only),
below the 150-line budget.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Ten files under `prompts/` (core + default per stage) | `ls -1 prompts/` → 10 files: five `prompts/<stage>-core.md` + five `prompts/<stage>.md` | Pass |
| Preservation test per stage (non-blank-line multiset equals parent) | `test/prompt-split.test.ts` `task-2465-0`…`task-2465-4`; parent fixture `test/fixtures/prompt-split-parent.json` | Pass |
| No-override launch equivalence (5 launch points) | `test/prompt-split.test.ts` `task-2465-draft/execute/review/act-on-review launch point preserves every pre-split line (no override)` | Pass |
| Override retention of core (cannot drop core) | `test/prompt-split.test.ts` `configured override replaces opinion content but retains a named core instruction` + `override cannot drop core even when the repo opinion omits it` | See F1 scope question — guarantee holds for shipped default; SC4 relaxed for three interleaved stages pending mission decision |
| One config key; unknown keys fail via config error path | `test/prompt-split.test.ts` `adapters.prompts.override is accepted; unknown keys beneath it are rejected`; `validateWorkflowConfig` `src/adapters/config/product-config.ts:209` | Pass |
| `src/` non-test/non-prompt/non-doc diff < 150 lines | `git diff main...HEAD --diff-filter=ACM -- 'src/*.ts' 'src/**/*.ts' 'src/*.js' 'src/**/*.js'` → 73 added lines | Pass |
| `docs/config.md` documents the key + links defaults | `docs/config.md` documents `adapters.prompts.override` and links all five shipped default-opinion files | Pass |

Next action: round-4 F1 is a scope question awaiting a mission decision; F2/F3
committed. Awaiting reviewer or operator direction on the SC3-vs-SC4 conflict.
