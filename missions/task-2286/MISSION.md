# Mission: Prove one native ESM Node SEA executable (task-2286)

## Goal

Build and natively test one standalone executable from the exact canonical ESM bundle (`build/px.mjs`) used by npm, on a single platform with an ESM-SEA-capable Node 25/26 runtime. The proof demonstrates that Parallix can ship a self-contained binary that runs without separately installed Node or runtime `node_modules`, while preserving all headless and interactive surfaces.

## Why Now

ADR 0044 establishes the distribution architecture with a canonical ESM bundle and platform-specific Node single-executable applications. TASK-2285 already proves the npm-packaged bundle distribution. TASK-2295 (bounded SQLite operator state) and TASK-2305 (Ink TUI wave 3 PTY harness) deliver the preconditions: SQLite domain authority and a reusable PTY launch path. With those foundations, the SEA spike can validate the final distribution surface — the native binary — without waiting for a full platform matrix.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: SEA build adapter (~40 NEL), native smoke test suite (~80 NEL), measurement harness and ADR stop-check (~40 NEL); toolchain availability is the primary risk but the spike is scoped to one platform

## Scope

- Pin an ESM-SEA-capable Node version (`mainFormat: "module"`) and implement a narrow SEA build adapter that wraps the canonical `build/px.mjs` bundle into a standalone executable
- Build one native target (the local platform) from the exact npm bundle payload, with snapshot and code cache disabled initially
- Run binary smoke tests covering: `--version`, `--help`, headless JSON output, TUI PTY launch, SQLite create/write/read, runtime asset access, temporary Git operation, subprocess invocation, signal handling, and source-mapped diagnostics
- Measure binary size, cold start time, idle memory, and shutdown time; compare against documented stop thresholds
- Verify that license/NOTICES, SBOM, checksum, executing runtime version, source commit hash, and unsigned/signature status are inspectable from the executable
- Confirm that failure of Ink, SQLite, assets, signals, Git, or source maps triggers ADR 0044 stop-and-reassess (not silent runtime substitution)
- Verify npm fallback (`build/px.mjs` direct execution) remains supported and unchanged
- Implement rollback: withdrawing the binary artifact without affecting npm or source execution

## Out of Scope

- Cross-platform support (only one native proof is claimed)
- Web board smoke (TASK-2283 is unprioritized; additive follow-up if it ships)
- Snapshot or code cache optimization (disabled for initial proof)
- Code signing (unsigned status is inspected; signing is a later phase)
- Release publication (no publication without explicit authorization)
- Any modification to the canonical bundle build process beyond the SEA adapter wrapper
- Platform matrix (Linux x64/arm64, macOS x64/arm64, Windows x64) — that is a separate phase after this proof

## Success Criteria

- SC1: The build pins an ESM-SEA-capable Node version (major >= 25) and aborts with a clear error before artifact creation on unsupported runtimes (e.g., Node 22/24)
- SC2: SEA input is byte-identical to the canonical `build/px.mjs` produced by `scripts/build-canonical-bundle.js`; snapshot and code cache flags are disabled in the SEA build config
- SC3: All native smoke tests pass on the built executable: `--version` (exit 0, version string), `--help` (Usage line), headless JSON (`--json` parseable, no cursor control), TUI PTY launch (non-zero PTY fd, clean exit), SQLite create/write/read (row round-trip), asset access (all keys from `asset-manifest.json` resolve), temporary Git operation (`git status` via subprocess), subprocess spawn (exit 0), signal handling (SIGTERM graceful), source-mapped diagnostics (stack trace maps to `.ts` file)
- SC4: The executable runs without separately installed Node (embedded runtime) and without runtime `node_modules` (verified by listing the executable's payload directory)
- SC5: Binary size is measured in bytes and reported; cold start time is measured in milliseconds; idle memory is measured in MB; shutdown time is measured in milliseconds; each measurement is compared against the stop thresholds documented in the mission checkpoint
- SC6: The following are inspectable from the executable: LICENSE text, third-party NOTICES, `sbom.json`, `manifest.sha256`, executing Node runtime version, source commit hash, and unsigned/signature status
- SC7: Failure of any of Ink, SQLite, assets, signals, Git, or source maps triggers an ADR 0044 stop-and-reassess error (not silent runtime substitution or fallback)
- SC8: npm fallback (`node build/px.mjs` from the checkout) passes the same headless smoke tests as the native executable
- SC9: Rollback withdraws the binary artifact (removes SEA executable and metadata) without affecting npm or source execution; `node build/px.mjs` still works after rollback

## Risks and Assumptions

- **Toolchain availability:** The current development machine runs Node 24.15.0, which may not support `mainFormat: "module"` in SEA. The mission may need to wait for a Node 25/26 runtime or use a sidecar Node installation. If no ESM-SEA-capable Node is available, the mission scope reduces to the build adapter implementation and a deferred smoke-test checkpoint.
- **Platform specificity:** The proof is one-platform-only. Results from Linux x64 are not claimed to generalize to macOS or Windows.
- **SEA API stability:** Node SEA `mainFormat: "module"` is experimental in Node 25/26. API changes between versions may require adapter adjustments but do not invalidate the proof.
- **Bundle size:** The existing 5 MB bundle stop rule (SC6 in `build-canonical-bundle.js`) applies; the SEA executable will be larger due to the embedded runtime, but the bundle payload itself must still comply.
- **PTY availability:** The reusable PTY harness from TASK-2305 must be merged before this mission's TUI PTY smoke checkpoint.

## Checkpoints

- CP 1: Pin the native Node toolchain and implement the narrow SEA build adapter. Deliver a build script that pins the Node version, checks `mainFormat: "module"` support, and produces one SEA executable from `build/px.mjs` on the local platform. The build must fail fast on unsupported runtimes.
- CP 2: Run the full native smoke test suite on the built executable. All SC3 surfaces (version, help, headless JSON, TUI PTY, SQLite, assets, Git, subprocess, signals, source maps) must pass. Record binary size, cold start, idle memory, and shutdown time.
- CP 3: Verify inspectable metadata (SC6), npm fallback (SC8), rollback (SC9), and stop-and-reassess behavior (SC7). Either approve the platform-matrix phase or invoke ADR 0044 stop-and-reassess with documented findings.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:

- A summary of work done in this checkpoint
- A `## Goal Check` section with a 3-column pipe-delimited markdown table:

  ```markdown
  | Criterion | Evidence | Status |
  |---|---|---|
  ```

- At least one evidence row per criterion using verifiable references. Parallix already verifies these evidence forms:
  1. **File:line references** — e.g., `scripts/build-sea.js:42` (must point to an existing file and line)
  2. **Test names** — e.g., `"native smoke: px --version from SEA executable"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2286-native-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0044` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `node build/px.mjs --version` ``, `` `./scripts/build-canonical-bundle.js` ``, `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is **not sufficient** as evidence — pair shell output with one of the accepted references above. For example, reporting "binary is 48 MB" must be accompanied by a file:line reference to the measurement code or the exact command that produced it.
- A non-generic `Next action:` line at the bottom describing the specific next step

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SEA build adapter pins Node >= 25 | `scripts/build-sea.js:12-18`, `"SEA build: pins and validates ESM-capable Node version"` | PASS |
| Native smoke: version/help/JSON pass | `test/task-2286-native-smoke.test.ts`, `"native smoke: px --version from SEA executable"`, `"native smoke: px --help from SEA executable"` | PASS |
| Executable runs without external node_modules | `test/task-2286-native-smoke.test.ts`, `"native smoke: no node_modules in SEA payload directory"` | PASS |
| Binary size measured and reported | `test/task-2286-native-smoke.test.ts`, `"native smoke: binary size is 48234560 bytes"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- `scripts/build-canonical-bundle.js` — the canonical ESM bundle builder is not modified; the SEA adapter is a separate script that consumes its output
- `build/px.mjs` — the bundle payload is not altered by the SEA build; it is the exact input
- `src/` runtime code — no application code changes are made; the mission tests the existing bundle
- `package.json` bin entry — the npm `bin.px` entry remains `build/px.mjs` and is not replaced by the SEA executable
- `config/integration-pipelines.json` — no gate configuration changes in this spike

## Stop Rules

- If no ESM-SEA-capable Node runtime (`mainFormat: "module"`) is available on the development machine, the mission completes the build adapter (CP 1) and defers smoke tests (CP 2/3) to the next machine with Node 25/26. The mission contract is not invalidated.
- If the SEA build produces an executable that cannot run `--version` with exit 0, invoke ADR 0044 stop-and-reassess (the ESM-capable pinned SEA runtime cannot pass native tests on a claimed platform) and document the root cause.
- If binary size exceeds 100 MB (bundle + embedded runtime), document the measurement and flag for the platform-matrix phase; do not block the proof.
- If any smoke test surface (Ink, SQLite, assets, signals, Git, source maps) fails with an error that suggests silent runtime substitution, invoke ADR 0044 stop-and-reassess rather than patching the failure in this spike.
- No release publication occurs without explicit authorization (DOD #4).
