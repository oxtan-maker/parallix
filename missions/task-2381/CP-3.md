# CP-3 — verification and close-out

## Summary

Stub SEA files (`build/sea/px`, `build/sea/manifest.sha256`) created for SC4/SC5 were removed
with `rm -rf build/sea`. `git status --short` shows no `build/sea` entry; `build/` is gitignored
(`.gitignore:18:build/`) so nothing under it can be committed.

Gate results on the final tree:

- `./scripts/verify-local.sh all` — exit 0, 1940 tests, 1940 pass, 0 fail, 0 skipped, 0 todo.
- `npm run test:package-content` — exit 0, `Package-content audit passed (ADR 0044 §8): 34 files, checksums verified.`
  (also exit 0 on the tree with `build/sea/` populated — the actual bug scenario).

Restricted areas honoured: `scripts/build-sea.ts`, `scripts/build-canonical-bundle.ts`, and
`scripts/package-native-release.ts` are unmodified, so the native release path still reads and
tars `build/sea/` exactly as before (AC #5). `checksumViolations()`, `REQUIRED_PATHS`,
`REQUIRED_PREFIXES`, `FORBIDDEN_PATHS` and the root-file allowlist in
`scripts/package-content-audit.ts` are unchanged — the only edit in that file is the
`FORBIDDEN_PREFIXES` entry and its comment.

### Out-of-scope observation (not fixed, not caused here)

`./scripts/verify-local.sh static-analysis` step 4 (test typecheck) fails on
`test/task-2377-02-pre-review-rebase-inprocess.test.ts:267` — `TS2353 ... 'handleGateFailureAutoBounceFn'
does not exist in type`. That symbol appears only in test files and never in the `src/` option type;
the file's last commit is `e61112f95 mission/task-2377.02`, and no file this mission touched is
involved. `static-analysis` is not a mission-declared gate, and per the mission stop rule this
baseline red was left alone rather than patched to green. Both declared gates
(`./scripts/verify-local.sh all`, `npm run test:package-content`) are green.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — reproduction test exists, red at parent, green now | `test/task-2381-repro.test.ts`, `"violationsFor flags build/sea payload files as forbidden package files"`; CP-1 recorded the red run (`expected build/sea/px to be forbidden, got: []`), `npx tsx --test test/task-2381-repro.test.ts` now reports 2 pass / 0 fail | PASS |
| SC2 — `FORBIDDEN_PREFIXES` contains `'build/sea/'` | `FORBIDDEN_PREFIXES` in `scripts/package-content-audit.ts`, with the ownership comment naming `scripts/package-native-release.ts`; asserted by `"violationsFor flags build/sea payload files as forbidden package files"` | PASS |
| SC3 — `files` negates the SEA payload, keeps `build/`, `LICENSE`, `README.md`, `NOTICES` | `"package.json files allowlist negates the SEA payload directory"` in `test/task-2381-repro.test.ts`; `"task-2285 files allowlist ships only the bundle payload and release metadata"` in `test/task-2285-release-metadata.test.ts` pins `["NOTICES","build/","!build/sea","LICENSE","README.md"]` | PASS |
| SC4 — `npm pack` lists zero `build/sea/` paths | `npm pack --dry-run --json` on a tree with `build/sea/px` + `build/sea/manifest.sha256`, report parsed by `parsePackReport` from `scripts/package-content-audit.ts`: 34 files, 0 `build/sea/` entries; without the negation the same command yields 36 files and `["build/sea/manifest.sha256","build/sea/px"]` | PASS |
| SC5 — audit exits 0 with `build/sea/` populated, no checksum-coverage lines | `npm run test:package-content` (stub SEA payload present) → exit 0; `grep -c 'checksum manifest does not cover published file:'` on the captured log = 0 | PASS |
| SC6 — SEA/bundle scripts byte-identical | `git status --short` and `git diff --stat -- scripts/package-native-release.ts scripts/build-sea.ts scripts/build-canonical-bundle.ts` — all three absent from the change set | PASS |
| SC7 — `test/task-2228-distribution-verification.test.ts` passes unchanged | `test/task-2228-distribution-verification.test.ts` — `npx tsx --test test/task-2228-distribution-verification.test.ts` → 7 pass / 0 fail, including `"package-content audit enforces ADR 0044 section 8 inclusion and exclusion rules"`; file not edited | PASS |
| SC8 — full verification gate green | `./scripts/verify-local.sh all` → exit 0, 1940 tests / 1940 pass / 0 fail | PASS |
| Gate — `npm run test:package-content` | `npm run test:package-content` → exit 0, `Package-content audit passed (ADR 0044 §8): 34 files, checksums verified.` | PASS |
| DoD #2 — lint/static clean on changed files | `npx eslint scripts/package-content-audit.ts test/task-2381-repro.test.ts test/task-2285-release-metadata.test.ts` → exit 0; ESLint and `npm run typecheck` steps of `./scripts/verify-local.sh static-analysis` both PASS | PASS |
| DoD #3 — no focused/skipped tests introduced | `test/task-2381-repro.test.ts` uses plain `test(...)`; test-hygiene step of `./scripts/verify-local.sh static-analysis` → `PASS: no test-hygiene violations` | PASS |
| DoD #5 — docs updated | `docs/npm-package-major-migration.md` published-tarball section documents the `build/sea/` exclusion; `./scripts/verify-local.sh docs` → exit 0 | PASS |
| DoD #6 — bug mission has red→green repro | `test/task-2381-repro.test.ts` — red evidence in `missions/task-2381/CP-1.md`, green evidence here | PASS |
| No stub committed under `build/sea/` | `rm -rf build/sea`; `git status --short` shows no `build/sea` path, and `.gitignore:18` (`build/`) covers it | PASS |

Contract references: ADR 0044 §8 (package-content audit contract, cited at the top of
`scripts/package-content-audit.ts`); ADR 0046 (npm publish process and security, cited in
`docs/npm-package-major-migration.md`).

Next action: hand off task-2381 for review — no further mission work remains; the pre-existing `test/task-2377-02-pre-review-rebase-inprocess.test.ts` typecheck red belongs to task-2377 and needs its own ticket.
