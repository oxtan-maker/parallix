# CP-4: Clean-Checkout, Deterministic Artifact, and Rollback Evidence

## Summary

Executed the clean-checkout, deterministic-artifact, and post-verification-cleanliness verification plan. Recorded the single coherent rollback phase that restores all transitional CommonJS shims together.

### Review-round reconciliation

The post-CP-4 corrections restore mandatory Forgejo publish-proof capture and assertion, migrate the native release archive packager to `scripts/package-native-release.ts`, correct the reproducible-build command in the authority reference, and emit `src/adapters/` into `.test-runtime/adapters/`. The test-runtime emitter rewrites the adapter storage import to `.test-runtime/lib/`, so the `status` and application-services SQLite dynamic imports resolve inside the emitted test tree. These corrections are covered by the final verification run recorded below.

### Deterministic artifact evidence

`scripts/verify-reproducible-build.ts` compares SHA-256 digests of every file under `build/` across two clean `npm run build` invocations. The test suite exercises this via `test/task-2228-distribution-verification.test.ts`:
- `"reproducible build check compares complete clean-build file lists"` — validates `compareFileLists` against identical and differing builds
- `"reproducible build check reports added, removed, and byte-changed artifacts"` — validates `artifactDifferences` detects byte-level changes

### Package content audit

`test/task-2228-distribution-verification.test.ts` enforces the published package shape:
- `"package-content audit enforces ADR 0044 section 8 inclusion and exclusion rules"` — validates `files` allowlist matches ADR 0044
- `"package-content audit rejects the pre-TASK-2285 CommonJS dist package shape"` — confirms `dist/` is absent from published tarballs
- `"package-content audit requires the release-metadata artifacts"` — validates `NOTICES`, `build/sbom.json`, `build/manifest.sha256`
- `"package-content audit rejects payload files outside build/ and the metadata allowlist"` — confirms no source tree or test files leak

### Post-verification cleanliness

After `./scripts/verify-local.sh all`, `git status --porcelain` reports no uncommitted generated output (excluding `graphify-out/` which is gitignored). No verification step produces untracked artifacts.

### CLI compatibility

`node build/px.mjs --version` exits 0 and reports the executing path. The canonical bundle is the sole executable target confirmed by `test/external-target-resolution.test.ts:193` (spawn `build/px.mjs` for `mission-start verify-env`).

### Coherent rollback phase

The entire transitional CommonJS retirement (CP-2) is identified by the rebase-stable command:
```
git rev-list -1 HEAD --grep="^CP-2(task-2288): retire the transitional CommonJS layer$"
```
The command intentionally avoids recording a commit hash because future rebases can change it; its subject-anchored lookup resolves the single retirement phase. Reverting that one commit restores the emitter, package entries, exports, test shims, and asset/package-root assumptions together. The three test fixes in this checkpoint (CP-3) are additive: they retarget tests to the canonical runtime boundary and do not alter the rollback phase. A rollback of the retirement restores the `dist/` tree, and these test fixes continue to work because `.test-runtime/` and `build/px.mjs` are independent of `dist/`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC6: Release documentation identifies binary targets as primary and npm as fallback | `docs/npm-package-major-migration.md:19`, `docs/npm-package-major-migration.md:39`, `docs/authority-reference.md:19` document `build/px.mjs` as the shipped target and npm as fallback | PASS |
| SC6: Release verification produces deterministic artifacts | `scripts/verify-reproducible-build.ts:32`, `scripts/verify-reproducible-build.ts:64`, `test/task-2228-distribution-verification.test.ts:88` (`"reproducible build check reports added, removed, and byte-changed artifacts"`), `./scripts/verify-local.sh all` | PASS |
| SC7: Clean checkout contains no generated output before verification | `git status --porcelain` on clean checkout shows no untracked files (excluding gitignored `graphify-out/`) | PASS |
| SC7: No uncommitted generated output after verification | `git status --porcelain` after `./scripts/verify-local.sh all` shows no untracked generated files | PASS |
| SC8: Checkpoint identifies coherent rollback phase | `git rev-list -1 HEAD --grep="^CP-2(task-2288): retire the transitional CommonJS layer$"`; `docs/npm-package-major-migration.md:142` | PASS |
| SC3: CLI compatibility gate passes | `test/external-target-resolution.test.ts:193` — `node build/px.mjs mission-start verify-env` from temp dir, exit 0 | PASS |
| SC3: emitted test runtime includes SQLite adapter dependencies | `scripts/build-test-runtime.ts:26`, `scripts/build-test-runtime.ts:66`, `src/platform/runtime/lib/commands/status.ts:129` | PASS |
| Gate: all tests pass | `./scripts/verify-local.sh all` — 1398 pass, 0 fail | PASS |
| Gate: static analysis passes | `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED | PASS |

Next action: Mission complete — all checkpoints (CP-1 through CP-4) recorded, all gates passing, review findings resolved. Request integration.
