# CP-2: docs/config.md reconciled with current runtime

## Summary

Applied the CP-1 inventory to `docs/config.md`. Only that file changed.

- **Intro rewritten.** Removed "the real CLI currently exits zero for those
  failures" and "Field-level schema enforcement is not complete yet"; both are
  false now. Replaced with what the runtime does: syntax, shape, and per-field
  type/enum/closed-key validation; specific issues reported; built-in defaults
  printed; non-zero exit; whole-file fallback so a single rejected field
  discards every override in the file. Named the two documented fields that
  genuinely carry no type check (`product.name`, `adapters.review.tmpDir`) so
  the enforcement claim is not an overclaim.
- **"Known configuration gaps" section deleted.** All three entries
  (TASK-2455.02 provider, TASK-2455.03 field validation, TASK-2455.04 exit
  status) are closed, and all three links pointed at `backlog/tasks/` paths
  whose files now live under `backlog/completed/`, so the section was also the
  only source of broken links in the file. No gap with a currently-existing
  end-to-end runtime effect was found, so nothing was restated in its place.
- **`adapters.tasks.storage`** — object form documented as all-string members
  recognising `tasksDir`, `completedDir`, and `archiveTasksDir`, with the
  derivation rule for omitted members.
- **`adapters.review.tmpDir`** — newly documented: optional string, resolved
  relative to the repository root when not absolute, defaulting to the OS
  temporary directory. Added to the review example.
- **`adapters.agents`** — noted that `runners` and `subagents` are closed
  objects whose only permitted keys are `custom` and `maxParallel`.
- **`adapters.gates`** — noted the section is closed to
  `requirePreIntegration`/`preHandoff`/`preReview`/`preIntegration`, that
  `requirePreIntegration` must be a boolean and each phase an array, and that
  `key`/`command` must be non-empty. Deliberately did **not** claim gate-object
  extra keys are rejected: the schema closes the object but the runtime
  validator does not check gate-object key names. (Round 1 F1 corrected the
  follow-on claim: extras are not dropped either — validation accepts them and
  `loadEffectiveConfig` merges them, so `px config` prints them; only gate
  execution ignores them.)
- **Unchanged because already accurate:** `product`, `adapters.missions`,
  `adapters.verification`, `adapters.integrate`, `adapters.review.provider`
  and its enum, the `agents` field types, the gate environment contract, and
  "Workflow safeguards".

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Closed gaps no longer presented as open | `rg -n 'Known configuration gaps\|exits zero\|not complete yet' docs/config.md` returns nothing | PASS |
| Remaining gap list contains only live gaps | The section is removed; the only non-enforced fields named in the doc (`product.name`, `adapters.review.tmpDir`) are stated inline as untyped, matching `validateWorkflowConfig` in `src/adapters/config/product-config.ts`, which type-checks neither | PASS |
| TASK-2455.03 / TASK-2455.04 references removed or corrected | `rg -n 'TASK-2455' docs/config.md` returns nothing; the enforcement and non-zero-exit behavior they delivered is described instead | PASS |
| Each documented adapter field has a matching effective constraint | `validateAdapterSections`, `validateAgentModels`, `validateRunnerSelection`, `validateSubagents` in `src/adapters/config/product-config.ts`; `validateRepositoryGates` in `src/adapters/config/repository-gates.ts`; `resolveTaskStorage` and `resolveReviewArtifactDir` for the two newly documented fields | PASS |
| No `file.ts:<line>` citation and no `src/`/`test/` path in the doc | `rg -n '[[:alnum:]_./-]+\.[[:alpha:]_-][[:alnum:]_-]+:[0-9]+' docs/config.md` and `rg -n 'src/\|test/' docs/config.md` both exit 1 (no match) | PASS |
| All relative Markdown links resolve | `rg -on '\]\(([^)]+)\)' docs/config.md` returns no match — the file now contains no Markdown links, so none can dangle | PASS |
| Only `docs/config.md` changed | `git diff --name-only HEAD~1 -- docs/ src/ config/ test/ scripts/` lists `docs/config.md` and nothing else | PASS |
| Behavioural coverage for the documented validation exists | `test/product-config.test.ts`, `test/config-command.test.ts` | PASS |

Next action: run the mission gate `./scripts/verify-local.sh all` on the
committed tree and record its result in CP-3.
