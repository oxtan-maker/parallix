# Mission: Exclude build/sea from the npm tarball so the package-content audit passes (task-2381)

Reproduction-Test: test/task-2381-repro.test.ts

## Goal
Make `build/sea/` unpublishable: `npm pack` must never sweep the SEA payload into the tarball, and `scripts/package-content-audit.ts` must reject `build/sea/**` as a forbidden package file if it ever reappears in the packed list. The audit's `checksumViolations()` must stop emitting `checksum manifest does not cover published file: build/sea/...` on a working tree where `tsx scripts/build-sea.ts` has run, while `scripts/package-native-release.ts` keeps reading and tarring `build/sea/` unchanged.

## Why Now
`npm publish` currently fails at `prepublishOnly` -> `npm run test:package-content` with 34 violations on any machine that has run the SEA build. The two scripts disagree about ownership: `scripts/build-sea.ts` writes `build/sea/`, `scripts/build-canonical-bundle.ts` deliberately excludes `build/sea` from the staging dir that produces `build/manifest.sha256`, and `package.json` `files` lists `build/` wholesale. Because `build/sea/` is gitignored, a clean CI tree does not reproduce it — so publishing is blocked exactly on the developer machines that have a full local build, and the failure is invisible to CI. The SEA binary is a ~100MB platform-specific executable already shipped separately by `scripts/package-native-release.ts`; it must be excluded, not added to the checksum manifest.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: two-line production change (`package.json` `files` negation plus one `FORBIDDEN_PREFIXES` entry) with a new regression test file; root cause and fix are already diagnosed in the backlog task and confirmed against `scripts/package-content-audit.ts` and `scripts/package-native-release.ts`.

## Scope
- `package.json`: add a negated pattern to `files` (e.g. `"!build/sea"`) so `npm pack` excludes the SEA payload.
- `scripts/package-content-audit.ts`: add `build/sea/` to `FORBIDDEN_PREFIXES` with a comment stating that the SEA payload ships via `scripts/package-native-release.ts`, not npm.
- New regression test `test/task-2381-repro.test.ts` driving the exported `violationsFor` from `scripts/package-content-audit.ts` (already imported that way by `test/task-2228-distribution-verification.test.ts`) plus an assertion on the `package.json` `files` allowlist.
- Doc touch-up only if an existing packaging doc (e.g. `docs/npm-package-major-migration.md`) enumerates the published tarball contents and would become wrong.

## Out of Scope
- Changing `scripts/build-sea.ts`, `scripts/build-canonical-bundle.ts` staging/manifest logic, or `scripts/package-native-release.ts` behaviour.
- Extending `build/manifest.sha256` to cover `build/sea/**`.
- Any change to `REQUIRED_PATHS`, `REQUIRED_PREFIXES`, `FORBIDDEN_PATHS`, the root-file allowlist, or `checksumViolations()` internals.
- Reducing the SEA binary size, changing SEA release packaging, or touching the release/publish workflow scripts.
- Adding a new npm script or CI job.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `test/task-2381-repro.test.ts` exists and asserts that `violationsFor(['build/sea/px'])` (and a second SEA path such as `build/sea/manifest.sha256`) yields a violation whose text starts with `forbidden package file: build/sea/`; this assertion fails at the mission parent commit and passes on the final tree.
- SC2: `scripts/package-content-audit.ts` `FORBIDDEN_PREFIXES` contains the literal entry `'build/sea/'`.
- SC3: `package.json` `files` contains a negation excluding the SEA payload (`"!build/sea"` or `"!build/sea/**"`), and still contains `build/`, `LICENSE`, `README.md`, `NOTICES`.
- SC4: `npm pack --dry-run --json` on a tree where `build/sea/px` exists lists zero entries whose path starts with `build/sea/` (capture the filtered command output).
- SC5: `npm run test:package-content` exits 0 on a tree where `build/sea/` is populated (either by `tsx scripts/build-sea.ts` or by a stub file created at `build/sea/px` plus `build/sea/manifest.sha256`), with zero `checksum manifest does not cover published file:` lines.
- SC6: `scripts/package-native-release.ts` is byte-identical to the parent commit (`git diff --stat <parent> -- scripts/package-native-release.ts` prints nothing), and `scripts/build-sea.ts` and `scripts/build-canonical-bundle.ts` are likewise unmodified.
- SC7: `test/task-2228-distribution-verification.test.ts` still passes unchanged — the new forbidden prefix does not break the existing `violationsFor`/`parsePackReport` expectations.
- SC8: `./scripts/verify-local.sh all` exits 0 on the final tree with 0 failures.

## Risks and Assumptions
- Risk: `npm pack` negation semantics — a bare `"!build/sea"` may not exclude nested files under all npm versions. Mitigation: verify with `npm pack --dry-run --json` on a tree with a real/stub `build/sea/px`; fall back to `"!build/sea/**"` if the directory-form negation does not exclude descendants.
- Risk: `build/sea/` is gitignored, so the failure is not reproducible from a clean checkout. Mitigation: the reproduction test drives the pure exported `violationsFor` on a synthetic file list rather than depending on a real SEA build; the SC4/SC5 shell evidence uses a stub file under `build/sea/`.
- Risk: adding `build/sea/` to `FORBIDDEN_PREFIXES` while `npm pack` already excludes it makes the audit rule appear dead. Accepted deliberately: the rule is the regression guard, and the unit test in `test/task-2381-repro.test.ts` keeps it live.
- Assumption: `violationsFor` and `parsePackReport` remain exported from `scripts/package-content-audit.ts` (line 144 of the parent commit) so tests can import them without spawning `npm pack`.
- Assumption: the SEA binary continues to be distributed only through `scripts/package-native-release.ts`; no consumer installs it from the npm tarball.

## Checkpoints
- CP 1 (bug lock, red): author `test/task-2381-repro.test.ts` importing `violationsFor` from `../scripts/package-content-audit.ts`. Reproduction scenario: call `violationsFor(['build/px.mjs', 'build/px.mjs.map', 'build/asset-manifest.json', 'build/manifest.sha256', 'build/package.json', 'build/sbom.json', 'build/config/x', 'build/migrations/x', 'build/prompts/x', 'build/templates/x', 'package.json', 'README.md', 'LICENSE', 'NOTICES', 'build/sea/px', 'build/sea/manifest.sha256'])` and assert the result contains `forbidden package file: build/sea/px` and `forbidden package file: build/sea/manifest.sha256`. Add a second case asserting `package.json`'s `files` array contains an entry matching `/^!build\/sea/`. Both assertions fail at the mission parent commit (red) and pass once CP 2 lands (green). No production edit in this checkpoint.
- CP 2 (fix, green): add `'build/sea/'` to `FORBIDDEN_PREFIXES` in `scripts/package-content-audit.ts` with the ownership comment, and add the `files` negation in `package.json`. Re-run the reproduction test to green, then run `npm run test:package-content` and `npm pack --dry-run --json` against a tree with a stub `build/sea/px` and `build/sea/manifest.sha256`, capturing the filtered output for SC4/SC5.
- CP 3 (verification and close-out): confirm `scripts/package-native-release.ts`, `scripts/build-sea.ts`, and `scripts/build-canonical-bundle.ts` are untouched (SC6), run `./scripts/verify-local.sh all`, remove any stub files created under `build/sea/`, and record the final Goal Check table covering SC1–SC8.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section, using exactly that heading
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`
- At least one evidence row per criterion (SC1–SC8) using durable, verifiable references. For this mission, prefer:
  1. **Recognized repo commands or paths** — `` `npm run test:package-content` ``, `` `npm pack --dry-run --json` ``, `` `npm test -- test/task-2381-repro.test.ts` ``, `` `git diff --stat -- scripts/package-native-release.ts` ``, `` `./scripts/verify-local.sh all` ``
  2. **Test names** — the exact `it(...)`/`test(...)` titles authored in `test/task-2381-repro.test.ts`, e.g. `"violationsFor flags build/sea payload files as forbidden package files"`
  3. **Test file paths** — `test/task-2381-repro.test.ts`, `test/task-2228-distribution-verification.test.ts`
  4. **ADR references** — `ADR 0044` (§8, the package-content audit contract cited at the top of `scripts/package-content-audit.ts`)
  5. **File:line references** — accepted when needed (e.g. the `FORBIDDEN_PREFIXES` block), but line numbers rot; prefer naming the symbol `FORBIDDEN_PREFIXES` in `scripts/package-content-audit.ts` instead
- Weak-agent failure mode to avoid: a row whose Evidence is only raw `stat`, `ls`, or `find` output, or only prose such as "verified the SEA files are gone", is NOT acceptable. Shell output (including `npm pack --dry-run` listings) must be paired with one of the accepted references above — the command that produced it, the test name that locks it, or the test file path.
- A non-generic `Next action:` line at the bottom naming the next concrete step (e.g. "CP 2: add `'build/sea/'` to `FORBIDDEN_PREFIXES` and the `!build/sea` files negation").

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — reproduction test locks the bug red→green | `test/task-2381-repro.test.ts`, `"violationsFor flags build/sea payload files as forbidden package files"`, `npm test -- test/task-2381-repro.test.ts` | PASS |
| SC5 — package-content audit clean with populated build/sea | `npm run test:package-content` — exit 0, 0 `checksum manifest does not cover` lines | PASS |
| SC8 — verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`
- [ ] `npm run test:package-content`

## Restricted Areas
- `scripts/build-sea.ts` — do not modify; SEA payload layout is out of scope.
- `scripts/build-canonical-bundle.ts` — do not modify; the staging exclusion of `build/sea` at the "build/sea is not ours" comment is the intended behaviour.
- `scripts/package-native-release.ts` — do not modify; it must keep reading `build/sea/` from disk.
- `checksumViolations()`, `REQUIRED_PATHS`, `REQUIRED_PREFIXES`, `FORBIDDEN_PATHS` and the root-file allowlist in `scripts/package-content-audit.ts` — read-only; the only permitted edit in that file is the `FORBIDDEN_PREFIXES` addition and its comment.
- `test/task-2228-distribution-verification.test.ts` — do not weaken or delete existing assertions; if it breaks, the fix is wrong.
- `package.json` — edit the `files` array only; do not touch `scripts`, `bin`, `version`, or dependencies.
- Do not commit any stub file created under `build/sea/` for verification (`build/` is gitignored; confirm `git status` is clean of it before the final checkpoint).

## Stop Rules
- Stop and report if excluding `build/sea` from `files` causes any `missing required package file:` or `missing required package asset directory:` violation — that means the negation is over-broad and is eating `build/` payload files.
- Stop and report if `npm pack --dry-run --json` still lists `build/sea/` paths after both negation forms (`"!build/sea"` and `"!build/sea/**"`) have been tried — the exclusion mechanism is not what the task assumes.
- Stop if the fix appears to require editing `scripts/build-canonical-bundle.ts` or `build/manifest.sha256` generation; that contradicts the mission's chosen direction and needs a scope decision.
- Stop if `test/task-2228-distribution-verification.test.ts` fails and the only way to green it is changing its assertions.
- Stop if `./scripts/verify-local.sh all` reports failures unrelated to this change rather than patching production code to green a stale baseline.
- Stop after CP 3; do not proceed to publishing, tagging, or running `npm publish` for real.
