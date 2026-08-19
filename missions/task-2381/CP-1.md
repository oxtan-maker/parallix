# CP-1 — bug lock (red)

## Summary

Authored `test/task-2381-repro.test.ts`, importing the exported `violationsFor` from
`scripts/package-content-audit.ts` (same import seam already used by
`test/task-2228-distribution-verification.test.ts`). Two tests:

1. `"violationsFor flags build/sea payload files as forbidden package files"` — feeds the
   full valid package file list plus `build/sea/px` and `build/sea/manifest.sha256`, and
   asserts both SEA paths produce `forbidden package file: build/sea/...`. It also asserts
   no *other* violation appears, which locks the CP-2 negation against becoming over-broad
   (mission stop rule on `missing required package file:`).
2. `"package.json files allowlist negates the SEA payload directory"` — reads `package.json`
   and asserts `files` contains an entry matching `/^!build\/sea/` while still containing
   `build/`, `LICENSE`, `README.md`, `NOTICES`.

No production file was edited in this checkpoint. Both tests fail on this tree (red):
`violationsFor` returns `[]` for the SEA paths, and `files` is
`["NOTICES","build/","LICENSE","README.md"]`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — reproduction test exists and is red at the parent commit | `test/task-2381-repro.test.ts`, `"violationsFor flags build/sea payload files as forbidden package files"`; `npx tsx --test test/task-2381-repro.test.ts` → `expected build/sea/px to be forbidden, got: []` | RED (as designed) |
| SC2 — `'build/sea/'` in `FORBIDDEN_PREFIXES` | `FORBIDDEN_PREFIXES` in `scripts/package-content-audit.ts` — not yet added; locked red by `"violationsFor flags build/sea payload files as forbidden package files"` | DEFERRED to CP 2 |
| SC3 — `files` negation present | `"package.json files allowlist negates the SEA payload directory"` in `test/task-2381-repro.test.ts` → `got: ["NOTICES","build/","LICENSE","README.md"]` | RED (as designed) |
| SC4 — `npm pack` lists no `build/sea/` entry | `npm pack --dry-run --json` | DEFERRED to CP 2 |
| SC5 — audit clean with populated `build/sea/` | `npm run test:package-content` | DEFERRED to CP 2 |
| SC6 — SEA/bundle scripts untouched | `git status --short` shows only `package-lock.json` (pre-existing) and the new `test/task-2381-repro.test.ts`; `scripts/package-native-release.ts`, `scripts/build-sea.ts`, `scripts/build-canonical-bundle.ts` unmodified | PASS |
| SC7 — existing distribution test unaffected | `test/task-2228-distribution-verification.test.ts` — no edit made in this checkpoint | PASS |
| SC8 — verification gate | `./scripts/verify-local.sh all` | DEFERRED to CP 3 |
| DoD #2 — lint clean on changed file | `npx eslint test/task-2381-repro.test.ts` → exit 0, no output | PASS |
| DoD #3 — no focused/skipped tests | `test/task-2381-repro.test.ts` uses plain `test(...)`; no `.only`/`.skip` | PASS |

Contract reference: ADR 0044 §8 (package-content audit), cited at the top of
`scripts/package-content-audit.ts`.

Next action: CP 2 — add `'build/sea/'` to `FORBIDDEN_PREFIXES` in `scripts/package-content-audit.ts` with the ownership comment, add the `!build/sea` negation to `package.json` `files`, then capture `npm pack --dry-run --json` and `npm run test:package-content` against a stub `build/sea/px` + `build/sea/manifest.sha256`.
