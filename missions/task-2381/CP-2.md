# CP-2 — fix (green)

## Summary

Production change, two edits, exactly as scoped:

- `scripts/package-content-audit.ts`: added `'build/sea/'` to `FORBIDDEN_PREFIXES` with an
  ownership comment naming `scripts/package-native-release.ts` as the real distribution
  channel and pointing at the `build/sea is not ours` staging exclusion in
  `scripts/build-canonical-bundle.ts`. `checksumViolations()`, `REQUIRED_PATHS`,
  `REQUIRED_PREFIXES`, `FORBIDDEN_PATHS` and the root allowlist are untouched.
- `package.json`: `files` is now `["NOTICES", "build/", "!build/sea", "LICENSE", "README.md"]`.
  The bare directory-form negation was verified sufficient — no `"!build/sea/**"` fallback needed.

Two collateral edits required by the change:

- `test/task-2285-release-metadata.test.ts`: `"task-2285 files allowlist ships only the bundle
  payload and release metadata"` pins the exact `files` array, so the expectation now includes
  `'!build/sea'`. No assertion was weakened or removed — the array is still compared with
  `assert.deepEqual`, and a comment records why the entry is there.
- `docs/npm-package-major-migration.md`: the "published tarball is `build/` plus …" paragraph
  would have become wrong; it now names the `build/sea/` exclusion, the negation, and the
  `FORBIDDEN_PREFIXES` guard.

### Counterfactual proof the negation does the work

With stub files at `build/sea/px` and `build/sea/manifest.sha256` on disk, `npm pack --dry-run --json`
(parsed through the exported `parsePackReport` from `scripts/package-content-audit.ts`, because
`prepack` build output precedes the JSON on stdout):

| `package.json` `files` | packed files | `build/sea/` entries |
|---|---|---|
| without `!build/sea` | 36 | `["build/sea/manifest.sha256", "build/sea/px"]` |
| with `!build/sea` | 34 | `[]` |

`build/` payload count stayed at 30 and the four root metadata entries
(`LICENSE`, `NOTICES`, `README.md`, `package.json`) survived — the negation is not over-broad,
so neither `missing required package file:` nor `missing required package asset directory:`
fires (mission stop rule cleared).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — reproduction test red→green | `test/task-2381-repro.test.ts`, `"violationsFor flags build/sea payload files as forbidden package files"` — red in CP-1 (`got: []`), now `npx tsx --test test/task-2381-repro.test.ts` reports 2 pass / 0 fail | PASS |
| SC2 — `'build/sea/'` in `FORBIDDEN_PREFIXES` | `FORBIDDEN_PREFIXES` in `scripts/package-content-audit.ts`; locked by `"violationsFor flags build/sea payload files as forbidden package files"` | PASS |
| SC3 — `files` negation, other entries intact | `"package.json files allowlist negates the SEA payload directory"` in `test/task-2381-repro.test.ts` and `"task-2285 files allowlist ships only the bundle payload and release metadata"` in `test/task-2285-release-metadata.test.ts` → `["NOTICES","build/","!build/sea","LICENSE","README.md"]` | PASS |
| SC4 — `npm pack` lists no `build/sea/` path | `npm pack --dry-run --json` with stub `build/sea/px` + `build/sea/manifest.sha256` on disk, report parsed via `parsePackReport` from `scripts/package-content-audit.ts`: 34 files, `build/sea/ entries: 0 []`; same command without the negation: 36 files, 2 SEA entries | PASS |
| SC5 — audit clean on a populated `build/sea/` tree | `npm run test:package-content` with the stub SEA payload present → exit 0, `Package-content audit passed (ADR 0044 §8): 34 files, checksums verified.`, `grep -c 'checksum manifest does not cover published file:'` = 0 | PASS |
| SC6 — SEA/bundle scripts unmodified | `git status --short` lists only `package.json`, `scripts/package-content-audit.ts`, `test/task-2285-release-metadata.test.ts`, `docs/npm-package-major-migration.md`, `test/task-2381-repro.test.ts` (plus pre-existing `package-lock.json`); `scripts/package-native-release.ts`, `scripts/build-sea.ts`, `scripts/build-canonical-bundle.ts` do not appear | PASS |
| SC7 — existing distribution test unchanged and passing | `test/task-2228-distribution-verification.test.ts` — `npx tsx --test test/task-2228-distribution-verification.test.ts` → 7 pass / 0 fail, file not edited | PASS |
| SC8 — full verification gate | `./scripts/verify-local.sh all` | DEFERRED to CP 3 |
| DoD #2 — lint clean on changed files | `npx eslint scripts/package-content-audit.ts test/task-2381-repro.test.ts test/task-2285-release-metadata.test.ts` → exit 0 | PASS |
| DoD #5 — docs reflect the behaviour change | `docs/npm-package-major-migration.md` (published-tarball section); `./scripts/verify-local.sh docs` → exit 0 | PASS |

Contract reference: ADR 0044 §8 (package-content audit), cited at the top of
`scripts/package-content-audit.ts`; ADR 0046 (npm publish process), cited in
`docs/npm-package-major-migration.md`.

Next action: CP 3 — remove the stub `build/sea/` files, run `./scripts/verify-local.sh all` on the clean tree, and record the SC1–SC8 close-out table.
