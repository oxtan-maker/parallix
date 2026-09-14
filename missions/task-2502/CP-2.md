# CP-2 — Runner: `scripts/codeql-sast.sh` + `npm run test:codeql`

## Work done
Implemented and wired the runnable SAST gate.

- `scripts/codeql-sast.sh` runs the official `codeql` CLI against the current
  checkout/worktree with the `javascript-typescript` language and the recorded
  `security/code-scanning` suite, writing per-worktree-isolated databases and
  results under `${TMPDIR}/parallix-codeql-<sha256(REPO_ROOT)>` (never inside
  the checkout, never tracked by Git).
- `package.json` script `test:codeql` = `bash scripts/codeql-sast.sh`
  (verified: `grep test:codeql package.json`).
- CLI version pinned to `2.27.0` (`CODEQL_PINNED_VERSION`); packs pinned to the
  `codeql-cli/v2.27.0` tag. The CLI/packs live under `~/.cache` (outside the
  tracked tree) and are cached there.
- `.gitignore` already excludes `.codeql-tmp/` and the success criterion
  confirms no `codeql-dbs/` or `*.codeql` artifacts are tracked
  (`git ls-files | grep -iE "codeql|\.sarif|\.codeql"` shows only the runner
  scripts and the regression test, no databases/results).
- The runner pins the version and exits non-zero with a clear message when the
  CLI is missing or below the pinned version (validated: with an old `codeql`
  on `PATH` and no cache, the runner printed
  `FAIL: codeql on PATH is 2.20.0; pinned is 2.27.0` and exited 1).
- The runner exits non-zero when qualifying findings exist
  (`npm run test:codeql` exits 1 with 12 findings and 0 with the baseline
  suppressions applied).
- Clean-cache bootstrap: `resolve_codeql_bin` and `resolve_packs` create
  `$CODEQL_CACHE_DIR` before downloading/cloning, so a fresh cache dir on a new
  machine/worktree bootstraps the pinned tool. Verified: `CODEQL_CACHE_DIR=/tmp/...
  scripts/codeql-sast.sh --dry-run` downloads the pinned CLI (no more
  `curl: (23) client returned ERROR on write`). Covered by
  `test/task-2502-codeql-clean-cache.test.ts` (integration).
- Per-worktree isolation via `PARALLIX_EXECUTION_ROOT`-derived temp paths; the
  database is rebuilt only when `HEAD` changes, so sibling worktrees are not
  corrupted.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `npm run test:codeql` resolves to the runner | `grep test:codeql package.json` → `bash scripts/codeql-sast.sh` | PASS |
| Runner invokes official `codeql` CLI, builds a `javascript-typescript` DB, runs the recorded suite, exits non-zero on findings | `scripts/codeql-sast.sh`; `npm run test:codeql` → `PASS: security/code-scanning reported no qualifying findings.` | PASS |
| Runner pins CodeQL version; exits non-zero with clear message on missing/wrong CLI | `CODEQL_PINNED_VERSION="2.27.0"` in `scripts/codeql-sast.sh`; verified `FAIL: codeql on PATH is 2.20.0; pinned is 2.27.0` | PASS |
| CodeQL distribution/databases/results not tracked by Git | `git ls-files | grep -iE "codeql|\.sarif|\.codeql"` lists only the runner scripts, the two committed suppression baselines (`missions/task-2502/codeql-suppressions.sarif`, `missions/task-2502/codeql-suppressions-empty.sarif`), and the regression test; no `codeql-dbs/` or `*.codeql` artifacts, DBs live in `${TMPDIR}` | PASS |
| Per-worktree isolation derived from `PARALLIX_EXECUTION_ROOT` | `WORK_ROOT` = `${TMPDIR}/parallix-codeql-$(sha256(REPO_ROOT))` in `scripts/codeql-sast.sh` | PASS |
| Runner fails loudly on missing/wrong CLI | verified above; CLI resolved before DB build | PASS |
| Clean-cache dir bootstraps the pinned tool | `test/task-2502-codeql-clean-cache.test.ts` (integration); fresh `CODEQL_CACHE_DIR` downloads the pinned CLI | PASS |
| `--dry-run` does not build a CodeQL database | `scripts/codeql-sast.sh` exits after tool/pack resolution, before the `codeql database create` branch; verified `CODEQL_WORK_DIR=/tmp/... npm run test:codeql -- --dry-run` lists the plan and exits 0 with an empty work dir | PASS |
| Database built once per run; cache reused across runs | `scripts/codeql-sast.sh` has a single rebuild path (stale/missing DB or `--rerun`); verified `CODEQL_PERSIST=1 npm run test:codeql` builds once on run 1 and not on run 2 (DB reused) | PASS |
| `--suite <name>` (two-argument form) is usable | `scripts/codeql-sast.sh` parses options with a `while (($#))` loop that shifts each argument once; verified `npm run test:codeql -- --suite codeql/javascript-queries --dry-run` exits 0 and echoes the suite; `--suite` with no value exits non-zero; `--suite=NAME` also works | PASS |
| `--suite` flag regression covered | `test/task-2502-codeql-suite-flag.test.ts` (integration) asserts the two-argument, equals, and missing-value forms; routed to the integration layer in `test/default-test-suite.test.ts` | PASS |

## Next action
Commit the runner and wired script, then proceed to CP-3 (gate wiring).
