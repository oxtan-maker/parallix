# CP-3: Verification and evidence

## Summary

Ran the single mission-declared gate on the committed tree and re-checked every
mission success criterion against `docs/config.md` as committed in CP-2.

`./scripts/verify-local.sh all` exits `0`. Its documentation stage prints
`PASS: authored documentation contains no volatile implementation evidence and
relative links resolve`, and the unit stage reports `tests 2450`, `pass 2450`,
`fail 0`, `skipped 0` on the round 1 response tree. No source, schema, test, or script file was touched by
this mission; the whole change is `docs/config.md`.

The mission's stop rule "stop if no concrete drift is found" did not apply:
CP-1 found three closed gaps still advertised as open, two false statements in
the document's opening paragraphs, three broken backlog links, and two
effective fields (`adapters.tasks.storage.archiveTasksDir`,
`adapters.review.tmpDir`) that the reference did not document.

One claim was deliberately weakened rather than asserted: the schema closes the
gate object with `additionalProperties: false`, but the runtime gate validator
checks only the `adapters.gates` key names, not the key names inside each gate
object. That is a documentation-accuracy decision, not a defect to fix here —
the restricted-areas rule forbids source edits, and the schema remains the
contract users should follow.

### Round 1 review response

Round 1 (`codex`) returned REQUEST_CHANGES with two findings; both are fixed.

- **F1 — gate-object extra keys are not "dropped".** The first wording said
  extras were dropped rather than reported. That understated what a user sees:
  validation accepts the key and `loadEffectiveConfig` deep-merges it, so
  `px config` prints it in the effective configuration; only `normalizeGates`
  ignores it at execution time. `docs/config.md` now states that split —
  accepted by validation, visible in `px config`, ignored by gate execution —
  and still points at the schema, which declares the object closed.
- **F2 — unrelated `package-lock.json` change.** A `pi-ai` bin-path edit
  (`dist/cli.js` to `./dist/cli.js`) had been swept into a harness commit on
  this branch. It is outside the documentation-only surface, so the file was
  restored to its `main` content. The branch diff is once again
  `docs/config.md` plus the mission scaffold and the harness-owned backlog
  frontmatter transition.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Mission gate passes on the committed tree | `./scripts/verify-local.sh all` exits 0 after the round 1 fixes; unit stage reports `tests 2450 / pass 2450 / fail 0 / skipped 0` | PASS |
| Documentation stage passes, including the link check | `./scripts/verify-local.sh docs` stage prints `PASS: authored documentation contains no volatile implementation evidence and relative links resolve` | PASS |
| Closed gaps no longer presented as open gaps | `rg -n 'Known configuration gaps' docs/config.md` and `rg -n 'TASK-2455' docs/config.md` both return no match | PASS |
| Field-level validation is described as effective, matching the runtime | `validateWorkflowConfig` / `validateAdapterSections` in `src/adapters/config/product-config.ts`; covered by `test/product-config.test.ts` | PASS |
| Non-zero exit on invalid config is described, matching the runtime | `src/adapters/cli/commands/config.ts` calls `exitFn(1)` on both the parse-error and structural-invalid branches; covered by `test/config-command.test.ts` | PASS |
| Gate section constraints match the runtime validator | `validateRepositoryGates` in `src/adapters/config/repository-gates.ts` rejects unknown `adapters.gates` keys and non-boolean `requirePreIntegration`; it does not check gate-object key names, and `normalizeGates` in the same file keeps only `key`/`command`/`order`, so the doc describes extras as accepted, printed by `px config`, and ignored at execution (round 1 F1) | PASS |
| Newly documented fields have a real runtime effect | `resolveTaskStorage` (`archiveTasksDir`) and `resolveReviewArtifactDir` (`review.tmpDir`) in `src/adapters/config/product-config.ts` | PASS |
| No `file.ts:<line>` citation and no `src/`/`test/` path in the live doc | `rg -n '[[:alnum:]_./-]+\.[[:alpha:]_-][[:alnum:]_-]+:[0-9]+' docs/config.md` and `rg -n 'src/\|test/' docs/config.md` both exit 1; the gate's docs stage enforces the same rule across `docs/*.md` | PASS |
| All relative Markdown links resolve | `rg -on '\]\(([^)]+)\)' docs/config.md` returns no match, so the file has no relative link left to dangle | PASS |
| Restricted areas untouched and no unrelated file in the diff | `git diff --name-only main...HEAD -- src/ test/ config/ scripts/ package-lock.json` returns nothing after the round 1 F2 lockfile revert; the only non-mission file in the branch diff is `docs/config.md` | PASS |
| Backlog task file preserved, not deleted or moved | `git diff --name-only main...HEAD -- backlog/` lists only `backlog/tasks/task-2460 - update-config-documentation.md`, and `git diff main...HEAD -- 'backlog/tasks/task-2460 - update-config-documentation.md'` shows only the harness lifecycle frontmatter transition (`status`, `assignee`, `labels`); this mission made no edit to it | PASS |
| Documented gate behavior matches the recorded gate decision | `docs/adr/0041-integration-pipeline-gates.md` (ADR 0041), whose pre-integration gate model the `Lifecycle gates` section describes | PASS |

Next action: hand off task-2460 for review — the mission's three checkpoints
are committed, `./scripts/verify-local.sh all` is green on the committed tree,
and no follow-up backlog item is proposed because every gap the reference
described is closed in the runtime.
