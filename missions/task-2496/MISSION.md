# Mission: suppress premature classification warning at draft start (task-2496)

## Goal
Stop the `px draft` workflow from printing a `[FAIL] Missing or invalid classification …` warning at the scaffold step when the Backlog task has no classification label yet. At draft start the classification is intentionally unset (the draft prompt instructs the agent to set it), so the missing-classification check in the scaffold step must be non-blocking and must not emit a `FAIL` status line. The hard classification gate stays in the later `postProcess` step via `normalizeDraftClassification`, which continues to `safeExit` on a genuinely missing/invalid classification.

## Why Now
The backlog report shows the exact failure. Running `npm run dev -- draft <slug>` (or `px draft <slug>`) on a task whose labels are empty prints:

```
[FAIL] Missing or invalid classification for task-2494; expected exactly one of ai_sdlc, user_value, or unknown in the labels of …/task-2494 - ….md. Fix: add exactly one of those labels and do not use a separate frontmatter field for mission type.
```

This fires during the scaffold step — before the agent has run and before any classification exists — yet it is worded as a hard failure ("Fix: add …"). The message is misleading: the draft prompt already tells the agent to set the label, and the real gate runs later. Operators see a scary FAIL that neither blocks nor correctly describes the state.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: misleading `[FAIL]` output at draft start; the scaffold classification check prints a failure status for an expected, intentionally-unset classification while still returning `ok: true`.

## Scope
- Fix the draft workflow's scaffold step so a missing classification does not print a `[FAIL]` line.
- Locate the emitting path: `validateDraftClassification` in `src/adapters/cli/commands/draft-prompts.ts` (prints `fmt.status('FAIL', classificationError)` and returns `{ ok: true, classification: null }`), invoked from the `scaffold` step in `src/adapters/cli/commands/draft-stats.ts` (~line 442), which reads `classificationCheck.ok` and continues.
- Keep the hard classification gate intact in the `postProcess` step via `normalizeDraftClassification` (returns `ok: false` → `safeExit`).
- Add/adjust unit tests under `test/` that assert the scaffold step no longer prints the classification FAIL for an unset classification while `normalizeDraftClassification` still blocks.
- Update authored docs that describe the draft-start classification behavior if they currently assert the FAIL is emitted.

## Out of Scope
- Changing the post-process `normalizeDraftClassification` gate semantics (it must still fail closed on a genuinely missing/invalid classification; see ADR 0048).
- Altering `resolveMissionClassification` / `classificationFromLabels` label-matching logic in `src/adapters/backlog/task-metadata.ts`.
- Any change to adhoc-identity classification, stats, review, or integrate commands.
- Adding new CLI flags or options to control the warning.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. Running the draft workflow scaffold step against a task with no classification label does not emit a line matching `/\[FAIL\].*classification/i` to the injected `errorFn`.
2. The scaffold step still returns `ok: true` with `classification: null` when the label is unset (draft is not blocked at start).
3. `normalizeDraftClassification` still returns `{ ok: false, reason: 'missing-classification' }` for an unset classification and the `postProcess` step calls `safeExit` (fail-closed gate preserved).
4. `./scripts/verify-local.sh all` passes on the final tree.
5. No focused (`it.only`/`describe.only`) or unannotated skipped (`it.skip`/`describe.skip`) tests exist in changed test files.
6. Any authored doc that asserts the draft-start FAIL is emitted is updated to reflect suppression.

## Risks and Assumptions
- Assumes the FAIL line is emitted only from the scaffold `validateDraftClassification` call and not from another caller during draft start. Verify by tracing every caller before editing.
- Assumes suppressing the scaffold warning does not hide a genuinely broken task; the post-process gate remains the fail-closed backstop (ADR 0048).
- The `validateDraftClassification` helper is shared/returned on the `draft` export and is unit-tested directly (`test/draft.test.ts`); any change to its message must not break those direct-unit tests unless the intent is to change the helper's contract — prefer scoping the fix to the scaffold call site rather than mutating the shared helper.
- The exact reproduction in the backlog references task-2494; the code path is slug-agnostic, so the fix applies to any slug.

## Checkpoints
- CP 1: Trace the draft-start classification path and confirm the FAIL emission site (scaffold `validateDraftClassification`), ruling out other callers.
- CP 2: Suppress the premature FAIL at draft start without weakening the post-process gate; add a failing-then-passing test.
- CP 3: Run `./scripts/verify-local.sh all`, update docs, and produce the Goal Check table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/draft.test.ts` ``, `` `./scripts/verify-local.sh all` ``, or `` `px draft <slug>` ``
  2. **Test names** — must match a test name in the repo, e.g. a test asserting the scaffold step does not print the classification FAIL
  3. **Test file paths** — e.g., `test/draft.test.ts` or `test/draft-command.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Concretely: a bare `node -e "…"` snippet or `ls` listing is NOT sufficient on its own — it must be paired with a recognized command, test name, test path, or ADR reference proving the behavior.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/draft.test.ts`, `"draft classification helpers fall back to stats when an injected resolver is invalid"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `docs/adr/` (do not add or modify ADRs)
- `src/adapters/backlog/task-metadata.ts` classification label-matching (`classificationFromLabels`, `getTaskClassification`)
- `src/adapters/cli/commands/stats.ts` `resolveMissionClassification`
- Any file outside the draft workflow (`draft.ts`, `draft-prompts.ts`, `draft-stats.ts`, `draft-command-use-case.ts`, `draft-setup.ts`, `draft-conflicts.ts`) and the test files touched by this mission.

## Stop Rules
- Stop before implementing if the FAIL emission turns out to originate outside the scaffold `validateDraftClassification` call — re-trace first.
- Do not weaken or remove the `normalizeDraftClassification` fail-closed gate in `postProcess`.
- Do not add new dependencies, CLI flags, or frontmatter fields.
- Stop drafting if `graphify-out/graph.json` is missing; fall back to reading source directly and note the graph was not consulted.
