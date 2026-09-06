# Checkpoint 3 — Caller verification and mission gate

## Summary
Verified the three callers of `validateWorkflowConfig` retain their contract:
- `loadEffectiveConfig` (`src/adapters/config/product-config.ts`) still returns
  built-in defaults for schema-invalid overrides and deep-merges a valid partial
  override over the defaults.
- `px config` (`src/adapters/cli/commands/config.ts`) still emits the
  structural-validation diagnostic to stderr, exits `1`, and prints fallback
  built-in defaults on stdout for invalid files; it prints the effective
  configuration for valid files.
- `evaluateRepositoryReadiness` (`src/adapters/config/product-config.ts`) still
  reports `configured` for valid overrides and `invalid` for schema-invalid ones.

Confirmed the schema (`config/workflow.config.schema.json`) is unchanged and
remains the authoritative contract; unknown keys stay allowed where
`additionalProperties` is `true`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Unsupported review provider regression test rejects via `px config` | `test/config-command.test.ts`, test `config rejects an unsupported review provider enum value as fallback defaults and exits non-zero` | PASS |
| `validateWorkflowConfig` rejects every schema constraint | `test/product-config.test.ts`, tests `...review provider enum`, `...tasks.storage`, `...runners.custom`, `...subagents.maxParallel`, `...models`, `...maxConcurrentCustom` | PASS |
| Partial override satisfying the schema remains valid and merges over defaults | `test/product-config.test.ts`, test `loadEffectiveConfig merges a partial override over the defaults` | PASS |
| Malformed/schema-invalid JSON uses fallback-default path; valid uses effective path | `test/config-command.test.ts`, tests `config reports malformed JSON as fallback defaults and exits non-zero` / `config reports structurally invalid overrides as fallback defaults and exits non-zero` | PASS |
| `px config` invalid-file behavior preserved (diagnostic + exit 1 + fallback) | `test/config-command.test.ts`, test `config reports structurally invalid overrides as fallback defaults and exits non-zero` | PASS |
| Schema contract unchanged | `config/workflow.config.schema.json` (unmodified) | PASS |
| Typecheck clean | `npx tsc --noEmit` exits 0 | PASS |
| Mission gate `./scripts/verify-local.sh all` exits 0 | `./scripts/verify-local.sh all` | PASS |

## Evidence: targeted suites
```
$ npx tsx --experimental-test-module-mocks --test test/config-command.test.ts
✔ config reports malformed JSON as fallback defaults and exits non-zero
✔ config reports structurally invalid overrides as fallback defaults and exits non-zero
✔ config rejects an unsupported review provider enum value as fallback defaults and exits non-zero
✔ config leaves a non-git standalone directory unchanged
ℹ pass 4
ℹ fail 0

$ npx tsx --experimental-test-module-mocks --test test/product-config.test.ts
ℹ pass 50
ℹ fail 0

$ npx tsc --noEmit
(no output, exit 0)
```

## Gate status — `./scripts/verify-local.sh all` (PASS)
`./scripts/verify-local.sh all` runs `node scripts/verify-docs.mjs` then `npm
test`. Both steps pass; the mission gate exits 0.

```
$ ./scripts/verify-local.sh all
...
+ tests 2389
+ pass 2389
+ fail 0
```

The round-1 review (finding F3) characterized three named suites as "red on
clean `main`". I verified each on a clean `main` checkout (`git worktree add
/tmp/main-wt main`), and all pass there too — they are not pre-existing failures:

```
$ cd /tmp/main-wt && node --experimental-test-module-mocks --import tsx --test test/web-board-interaction.test.ts
+ tests 7
+ pass 7

$ node --experimental-test-module-mocks --import tsx --test test/board-readers.test.ts
+ tests 14
+ pass 14

$ node --experimental-test-module-mocks --import tsx --test test/review-static-evidence.test.ts
+ tests 14
+ pass 14
```

`test/web-board-interaction.test.ts` is a file this mission edited (round-1
finding F4: a comment-only revert to merge-base); it passes 7/7 on both `main`
and the mission tree. The board-projection and review-static-evidence suites are
unrelated to the workflow-config validation path and pass on `main`. No
pre-existing failures block the success criterion; the gate is green.

Next action: close the mission — the gate is green and all round-1 findings are
resolved (F1 storage-object validation matches the schema, F2 operator guidance
restored, F3 gate green with main-baseline evidence, F4 test comment reverted).
