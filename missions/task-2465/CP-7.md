# CP-7 — Round-5 resolution

## Work done

Corrected no-override assembly for an empty shipped opinion half: it now
returns the core body unchanged rather than appending a newline separator. The
assembly test now asserts exact parent-fixture bytes for every stage.

Updated the prompt configuration documentation to say that a shipped
default-opinion half may be empty and that `override` selects an opinion file
rather than replacing non-existent shipped text.

## Review resolution

- F1 (empty default-opinion halves): pushed back. The locked mission Scope
  explicitly permits an empty shipped default-opinion half when a stage has no
  opinion content. Requiring non-empty halves conflicts with that scope. The
  reported broader SC3/SC4 design conflict requires an operator scope decision;
  it cannot be resolved by a source change without changing the locked mission.
- F2 (mission Scope/Out of Scope history): parked for an operator decision.
  The current locked mission contains the cited clarification, and Restricted
  Areas prohibit changing Scope or Out of Scope during execution. This round
  cannot amend mission authority or reconstruct an unrecorded operator order.
- F3 (configuration text): fixed in `docs/config.md`.

## Gate

`npx tsx --test test/prompt-split.test.ts` passes: 18 tests, 0 failures.
`./scripts/verify-local.sh all` passes.

## Goal Check

| Criterion | Evidence | Status |
| --- | --- | --- |
| Ten files under `prompts/` (core + default per stage) | `prompts/` contains each `prompts/<stage>-core.md` and `prompts/<stage>.md` pair | Pass |
| Preservation test per stage (non-blank multiset equals parent) | `test/prompt-split.test.ts` `task-2465-0` through `task-2465-4` | Pass |
| No-override launch equivalence (5 launch points) | `test/prompt-split.test.ts` launch tests and `task-2465-assembly-0` through `task-2465-assembly-4` exact-byte assertions | Pass |
| Override retention of core (cannot drop core) | `test/prompt-split.test.ts` override retention tests | Pass |
| One config key; unknown keys fail via config error path | `test/prompt-split.test.ts` `adapters.prompts.override is accepted; unknown keys beneath it are rejected` | Pass |
| `src/` non-test/non-prompt/non-doc diff < 150 lines | Reviewed revision: `git diff --numstat c37d13b02 536c2731a --diff-filter=ACM -- 'src/*.ts' 'src/**/*.ts' 'src/*.js' 'src/**/*.js'` → 96 added lines; this round adds 1 line | Pass (97 added lines) |
| `docs/config.md` documents the key + links defaults | `docs/config.md` Prompts section | Pass |

Next action: commit the round-5 fixes and submit the resolution artifacts for formal review.
