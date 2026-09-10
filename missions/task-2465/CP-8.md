# CP-8 — Round-6 authority restoration

## Work done

Restored `MISSION.md` Scope and Out of Scope to the drafted text from
`f307697d5`, removing the three execution-time additions. Moved the unchanged
trailing `Graphify-first:` paragraphs from the act-on-review and portfolio core
files to their default-opinion files. Their no-override assembly remains
byte-identical to the parent prompts.

Draft, execute, and review still have no contiguous non-core suffix compatible
with a two-file append and exact-byte assembly. That remaining design conflict
is parked for an operator scope decision; this checkpoint does not treat the
removed Scope additions as authority.

## Gate

`npx tsx --test test/prompt-split.test.ts` passes: 18 tests, 0 failures.
`./scripts/verify-local.sh all` passes.

## Goal Check

| Criterion | Evidence | Status |
| --- | --- | --- |
| Ten files under `prompts/` (core + default per stage) | `prompts/` provides each `prompts/<stage>-core.md` and `prompts/<stage>.md` pair | Pass |
| Preservation test per stage (non-blank multiset equals parent) | `test/prompt-split.test.ts` `task-2465-0` through `task-2465-4` | Pass |
| No-override launch equivalence (5 launch points) | `test/prompt-split.test.ts` launch tests and exact `task-2465-assembly-0` through `task-2465-assembly-4` | Pass |
| Override retention of core (cannot drop core) | `test/prompt-split.test.ts` override retention tests | Pass |
| One config key; unknown keys fail via config error path | `test/prompt-split.test.ts` `adapters.prompts.override is accepted; unknown keys beneath it are rejected` | Pass |
| `src/` non-test/non-prompt/non-doc diff < 150 lines | `git diff --numstat 23c5fb759 f23708b33 --diff-filter=ACM -- 'src/*.ts' 'src/**/*.ts' 'src/*.js' 'src/**/*.js'` → 97 added lines | Pass |
| `docs/config.md` documents the key + links defaults | `docs/config.md` Prompts section | Pass |

Next action: commit the authority restoration and submit the three-stage
scope question through the review artifacts.
