# CP-9 — Current locked-scope resolution

## Work done

The current locked mission Scope now permits an empty shipped default-opinion
file when a stage has no replaceable opinion. Its launch-equivalence criterion
also permits the review default-opinion line to appear after the core. The
current review split moves that unchanged review-opinion line to
`prompts/review.md`; the other four stage assemblies preserve parent bytes.

This resolves the previously parked three-stage question under the current
locked contract: draft and execute have empty default-opinion files, review has
the shipped review-opinion line, and act-on-review and portfolio retain their
shipped Graphify-first opinion paragraphs.

## Gate

`npx tsx --test test/prompt-split.test.ts` passes: 18 tests, 0 failures.
`./scripts/verify-local.sh all` passes.

## Goal Check

| Criterion | Evidence | Status |
| --- | --- | --- |
| Ten files under `prompts/` (core + default per stage) | `prompts/` contains the five `prompts/<stage>-core.md` and five `prompts/<stage>.md` files | Pass |
| Preservation test per stage (non-blank multiset equals parent) | `test/prompt-split.test.ts` `task-2465-0` through `task-2465-4` | Pass |
| No-override launch equivalence (5 launch points) | `test/prompt-split.test.ts` `task-2465-{draft,execute,review,act-on-review}` launch tests and five assembly tests | Pass |
| Override retention of core (cannot drop core) | `test/prompt-split.test.ts` override retention tests | Pass |
| One config key; unknown keys fail via config error path | `test/prompt-split.test.ts` `adapters.prompts.override is accepted; unknown keys beneath it are rejected` | Pass |
| `src/` non-test/non-prompt/non-doc diff < 150 lines | `git diff --numstat 23c5fb759 f23708b33 --diff-filter=ACM -- 'src/*.ts' 'src/**/*.ts' 'src/*.js' 'src/**/*.js'` → 97 added lines | Pass |
| `docs/config.md` documents the key + links defaults | `docs/config.md` Prompts section | Pass |

Next action: commit this checkpoint and submit the current locked-contract
resolution for formal review.
