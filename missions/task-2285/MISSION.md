# Mission: Publish canonical ESM bundle as npm fallback (task-2285)

## Goal

Change the npm fallback package to execute the canonical ESM bundle (`build/px.mjs`) and complete the CLI-only package boundary for the next major release. The published package includes the bundle, source map, generated asset manifest, licenses, README, and third-party notices — no unbundled source tree, no `dist/` CommonJS output, and no unrelated binary artifacts.

## Why Now

ADR 0044 established the canonical ESM bundle as the sole production JavaScript payload. The build already emits `build/px.mjs` via esbuild, but the npm package still ships the transitional CommonJS `dist/` tree with `"type": "commonjs"`, a `main` entry, and root `exports`. TASK-2282 (Ink TUI wave 1) puts React/Ink into the production bundle and re-baselines the size gate, making the bundle ready to serve as the npm entry point. This mission removes the last CommonJS artifacts from the published surface and sets the Node floor to 22.23.1, enabling the next-major release and unblocking TASK-2286 (native SEA executable) which reuses the same bundle.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is; depends on TASK-2279 and TASK-2282
- Main drivers: package metadata rewrite, `files` allowlist change, package-content audit update, SBOM/checksum/notice generation, pack-and-install smoke, compatibility notes, rollback procedure

## Scope

- Update `package.json` metadata: `"type": "module"`, `bin.px` to `build/px.mjs`, remove `main` and `exports`, set `engines.node >= 22.23.1`
- Revise `files` allowlist to ship only `build/`, `LICENSE`, `README.md`, `CHANGELOG.md`, third-party notices, and required release materials
- Update `scripts/package-content-audit.js` required/forbidden lists for the new package shape (E2M bundle, no `dist/` in published tarball)
- Add SBOM generation and SHA-256 checksum gate to the pre-publish flow
- Create `NOTICES` (third-party notices) file for the published package
- Add `prepack` script that builds the canonical bundle before `npm pack`
- Pack and install in temporary prefixes; verify version, help, headless JSON, TUI non-TTY fallback, SQLite startup, and embedded asset loading
- Adjust packaging-adjacent runtime entrypoint behavior under `src/platform/runtime/` when required to satisfy the packaged CLI contract (for example, bare non-TTY `px` help behavior), without changing unrelated domain or application logic
- Document next-major compatibility and migration notes (Node floor, ESM, root import removal, UI invocation, SQLite import)
- Document and test rollback procedure that restores the prior CommonJS `dist/` artifact

## Out of Scope

- Publishing to the npm registry (ADR 0046 covers the publish process; this mission only prepares the package)
- Native SEA executable builds (TASK-2286)
- Local web operator board (TASK-2283, unprioritized)
- CI/CD automation for publishing
- Programmatic SDK consumer support (Parallix is a CLI, not a library)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `package.json` has `"type": "module"`, `"bin.px"` is `"build/px.mjs"`, no `"main"` key, no `"exports"` key, and `"engines.node"` is `">=22.23.1"`
- SC2: `npm pack --dry-run --json` lists only files under `build/`, `LICENSE`, `README.md`, `CHANGELOG.md`, `NOTICES`, and no files under `dist/`, `test/`, `src/`, `.forgejo-local/`, `sessions/`, `graphify-out/`, `missions/`, `backlog/`, or `node_modules/`
- SC3: A temporary-prefix install (`npm install <prefix> <tarball>`) exits 0 for `px --version`, `px --help`, a representative headless JSON command, non-TTY `px` (prints help), SQLite startup, and embedded asset smoke test
- SC4: Installed execution at `<prefix>/bin/px` runs without any `node_modules` directory present in the package (only Node.js builtins and the bundled payload)
- SC5: `npm audit --production` reports 0 vulnerabilities; `scripts/package-content-audit.js` passes with zero violations; a SHA-256 checksum file is present in the pack output; `NOTICES` file exists and is included in the pack
- SC6: A compatibility/migration document (under `docs/`) covers: Node floor change from 23.0.0 to 22.23.1, ESM migration, removal of root programmatic export (`main`/`exports`), UI invocation behavior (`px` TTY vs non-TTY), and SQLite import boundary
- SC7: The `bin.px` path (`build/px.mjs`) is the same file used as SEA input for TASK-2286 (verified by comparing `bin.px` value in `package.json` to the entry point in `scripts/build-canonical-bundle.js`)
- SC8: Rollback procedure documented in the compatibility/migration notes: restoring `"type": "commonjs"` and `bin.px` to `dist/px.js` produces a working CommonJS npm artifact; source authority (`src/`) is unchanged

## Risks and Assumptions

- **Risk:** Bundle size exceeds 5 MB stop rule after TASK-2282 adds Ink/React. The build script already enforces this gate; if it fails, TASK-2282 must reduce bundle content before this mission proceeds.
- **Risk:** `node:sqlite` is not available on Node 22.23.1 in all distributions. Assumption: the target Node 22.23.1 release includes `node:sqlite` as a built-in (it was added in Node 22.10.0).
- **Risk:** Dynamic `import()` of the TUI module (`dist/interfaces/tui/`) from the CommonJS rollback path may break if the ESM-only TUI modules are not emitted during the `prepack` build. Assumption: `scripts/build-canonical-bundle.js` still emits the `dist/` CommonJS tree with ESM TUI sub-modules during `prepack`.
- **Assumption:** TASK-2282 (Ink TUI wave 1) completes before this mission, so the bundle contains the Ink runtime and the size gate is re-baselined.
- **Assumption:** No external consumers depend on the current `main` or `exports` programmatic entry points (ADR 0044 confirms Parallix is a CLI, not a library).

## Checkpoints

- CP 1: Update `package.json` metadata (`type`, `bin`, remove `main`/`exports`, `engines.node`) and revise `files` allowlist for the ESM bundle package shape
- CP 2: Update `scripts/package-content-audit.js` required/forbidden lists, add `NOTICES` file, and add SBOM/checksum generation to `prepack` or post-build step
- CP 3: Pack with `npm pack`, install in a temporary prefix, and run smoke tests: `px --version`, `px --help`, headless JSON, non-TTY fallback, SQLite startup, embedded assets
- CP 4: Write next-major compatibility and migration notes under `docs/`; document rollback procedure; verify rollback produces a working CommonJS artifact

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `package.json:8` (must point to an existing file and line)
  2. **Test names** — e.g., `"npm pack contains only build/ and metadata files"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/package-content-audit.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0044` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm pack --dry-run --json` ``, `` `node --import tsx test/package-smoke.test.ts` ``, `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| `package.json` has `"type": "module"` | `package.json:6` | PASS |
| `npm pack` ships only `build/` and metadata | `` `npm pack --dry-run --json` `` output, `scripts/package-content-audit.js:3-10` | PASS |
| Smoke test passes in temp prefix | `` `node test/npm-fallback-smoke.test.js` `` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- Do not modify `src/` outside packaging-adjacent runtime entrypoint behavior needed for the published CLI contract; domain, application, adapter, and unrelated TUI logic remain out of scope
- Do not modify `scripts/build-canonical-bundle.js` bundler configuration (entry point, format, target, alias, jsx, banner) — only the `prepack` hook and `files` allowlist are in scope
- Do not modify test files under `test/` except for the package-content audit and any new smoke tests this mission authors
- Do not publish to the npm registry (only `npm pack` and temporary-prefix installs)
- Do not modify the CommonJS `dist/` emission logic in `scripts/build-canonical-bundle.js` (it remains the rollback artifact)

## Stop Rules

- Stop if `scripts/build-canonical-bundle.js` bundle-size gate fails (bundle exceeds 5 MB) — re-baseline with TASK-2282 before proceeding
- Stop if `npm pack --dry-run` includes any file under `src/`, `test/`, or `node_modules/` — the `files` allowlist must be corrected before continuing
- Stop if the temporary-prefix install fails any smoke test (`px --version`, `px --help`, headless JSON, non-TTY, SQLite, assets) — diagnose bundle resolution before continuing
- Stop if `npm audit --production` reports any vulnerability — resolve or document before proceeding
- Stop if the CommonJS rollback (`dist/px.js`) does not produce a working CLI — the rollback gate must pass before the mission closes
