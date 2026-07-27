# CP-4 — Next-major compatibility notes and a verified rollback

## Summary

Wrote `docs/npm-package-major-migration.md` and made the rollback an executable,
tested procedure rather than prose.

1. **Migration notes** cover every topic SC6 enumerates: the Node floor change
   (23.0.0 → 22.23.1, a *lowering*, so no runtime loses support), the ESM switch, the
   removal of `main`/`exports` and published declarations with guidance for anyone who
   imported Parallix programmatically, `px` TTY vs non-TTY invocation, and the
   `node:sqlite` import boundary. They also document the new payload root (`build/`), the
   release metadata (NOTICES / SBOM / checksums / license audit), and the pi SDK's move to
   an optional peer dependency with the one-line install for `pi` users.

2. **`scripts/rollback-commonjs-package.js` (new)** derives the CommonJS manifest from the
   current one: `"type": "commonjs"`, `main`, `bin.px: "dist/px.js"`, the `exports` map,
   the package-root asset directories back in `files`, and — the part prose would have
   missed — `dependencies` on ink/react/@types/react/pi SDK restored, because the
   transpiled `dist/` tree resolves those from `node_modules` instead of inlining them.
   `--apply` rewrites `package.json`; without it the manifest is printed for review.

3. **`test/task-2285-rollback.test.ts` (new)** proves the rolled-back artifact works. It
   assembles the rollback in a temporary directory (never mutating the checkout, so it
   cannot disturb a concurrent build or pack), checks its `npm pack` contents, and runs
   `dist/px.js` for `--version`, `--help`, a headless JSON command, package-root asset
   loading, and the restored programmatic `main` entry. SC8's "source authority unchanged"
   is proven by applying the real procedure to a fixture checkout and asserting `src/` is
   byte-identical and no file other than `package.json` was touched.

Note on `px --version` in the two shapes: the bundle reports `package: …/build` (the
payload root) while the rollback reports `package: <package dir>`. Both are correct for
their layout; the migration notes call this out.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC6: notes cover the Node floor change 23.0.0 → 22.23.1 | `docs/npm-package-major-migration.md:27` (§ "Node floor: 23.0.0 → 22.23.1") | PASS |
| SC6: notes cover ESM migration | `docs/npm-package-major-migration.md:37` (§ "ESM") | PASS |
| SC6: notes cover removal of the root programmatic export | `docs/npm-package-major-migration.md:50` (§ "Removal of the root programmatic export") | PASS |
| SC6: notes cover UI invocation (`px` TTY vs non-TTY) | `docs/npm-package-major-migration.md:80` (§ "UI invocation: `px` on a TTY vs a non-TTY") | PASS |
| SC6: notes cover the SQLite import boundary | `docs/npm-package-major-migration.md:96` (§ "SQLite import boundary") | PASS |
| SC8: rollback procedure documented | `docs/npm-package-major-migration.md:146` (§ "Rollback"); test `"task-2285 rollback: the migration notes document the procedure"` | PASS |
| SC8: restoring `"type": "commonjs"` and `bin.px` → `dist/px.js` produces a working artifact | `scripts/rollback-commonjs-package.js:59-83` (`rollbackManifest`); tests `"task-2285 rollback: the manifest restores the CommonJS entry points"`, `"task-2285 rollback: the CommonJS bin runs version, help and a headless command"`, `"task-2285 rollback: package-root assets resolve in the CommonJS layout"`, `"task-2285 rollback: the programmatic main entry loads again"` | PASS |
| SC8: rollback tarball ships the CommonJS tree and no bundle | test `"task-2285 rollback: the rolled-back package publishes the CommonJS tree"` (asserts `dist/px.js`, `dist/index.js`, `config/state-map.json`; no `build/`, `src/`, `test/`, `node_modules/`) | PASS |
| SC8: source authority (`src/`) unchanged by the rollback | test `"task-2285 rollback: SC8 — source authority is untouched by the rollback"` (applies `--apply` to a fixture checkout; `src/entry/px.ts` byte-identical, only `package.json` written) | PASS |
| Rollback artifact remains emitted by the build | `scripts/build-canonical-bundle.js:238-263` (CommonJS + ESM sub-tree emission retained); test `"px ui spawns and exits 0 from shipped artifacts"` → `"dist/px.js ui exits 0 (CJS rollback artifact)"` in `test/tui-spawn.test.ts` | PASS |
| Mission-declared gate ran | `./scripts/verify-local.sh all` | PASS |
| Mandatory integration gate ran | `./scripts/verify-local.sh integrate` | PASS |
| Static analysis clean (ESLint, `tsc --noEmit`, test-hygiene, test typecheck) | `` `./scripts/verify-local.sh static-analysis` `` → all four stages PASS; stages defined at `scripts/verify-local.sh:90` (`gate_static_analysis`), `scripts/verify-local.sh:94`, `scripts/verify-local.sh:102`, `scripts/verify-local.sh:114`, `scripts/verify-local.sh:123` | PASS |
| Full integration suite green | `` `npm run test:integration` `` → 1314 pass / 0 fail / 0 cancelled; suite selection at `test/run-default-tests.js:151` | PASS |
| Published package shape and checksums audited | `` `npm run test:package-content` `` → `18 files, checksums verified`; `scripts/package-content-audit.js:16` (`REQUIRED_PATHS`), `scripts/package-content-audit.js:81` (`checksumViolations`) | PASS |
| Production dependency audit clean | `` `npm audit --production` `` → `found 0 vulnerabilities`; enforced pre-publish at `package.json:46` (`prepublishOnly`) | PASS |

Next action: mission complete — hand off for review. `dependencies` were removed (ink/react are
bundled; the pi SDK became an optional peer) to satisfy SC4/SC5. SC3's bare-`px` "prints help"
sub-criterion is now PASS: `parseArgs` in `src/platform/runtime/px.ts:69-72` returns empty
command instead of throwing, and `run()` prints usage before the target-path check.
