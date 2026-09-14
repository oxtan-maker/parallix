# CP-1 — Baseline: CodeQL findings against the parent-commit tree

## Work done
Captured and classified every CodeQL finding emitted against the **parent
commit's tree** — the tree before the mission changed anything. The mission
touches the shell-injection boundary (e.g. `src/adapters/git/git.ts:45`), so a
baseline against the final worktree could not establish coverage; the baseline
must be the pre-mission tree. Opened a worktree at the parent commit
`288b9048e` (`execute(task-2502): capture agent output`, the parent of the
first mission commit) and scanned that checkout.

- Query suite: `security/code-scanning` (recorded as `codeql/javascript-queries`
  default security suite in `scripts/codeql-sast.sh`). Never weakened.
- CLI: pinned `codeql` `2.27.0`; verified with `codeql version`.
- The runner scans the worktree at its `HEAD`. Pointing `PARALLIX_EXECUTION_ROOT`
  at the parent-commit worktree makes the scan's source root that tree.
- Command that reproduces the 12-finding baseline (empty suppressions so nothing
  is filtered; `--rerun` forces a fresh database):
  `git worktree add -f <dir> 288b9048e` then
  `CODEQL_SUPPRESSIONS=missions/task-2502/codeql-suppressions-empty.sarif PARALLIX_EXECUTION_ROOT=<dir> npm run test:codeql -- --rerun --list-findings`
  This lists all 12 qualifying findings against the parent tree; the committed
  `codeql-suppressions.sarif` then filters them to 0 for the green gate.
- The final worktree yields the same 12 rules (the mission only adds comments,
  which do not change the scanned patterns); its line numbers shift (e.g.
  `cli-format.ts:118-119`, `host.ts:241`) because the comments insert lines.

## Classification table (12 findings, 11 unique locations)

Captured with the empty-suppressions command above: an unsuppressed
`javascript-typescript` scan of the parent-commit worktree at `288b9048e`
(line numbers are the parent-commit locations).

| ruleId | location | severity | classification |
|---|---|---|---|
| js/clear-text-logging | src/application/presentation/cli-format.ts:114 | warning | false positive |
| js/clear-text-logging | src/application/presentation/cli-format.ts:115 | warning | false positive |
| js/incomplete-multi-character-sanitization | test/task-2452-repro.test.ts:11 | warning | false positive |
| js/incomplete-multi-character-sanitization | test/web-mission-card-render.test.ts:72 | warning | false positive |
| js/incomplete-sanitization | test/task-2285-release-metadata.test.ts:123 | warning | false positive |
| js/incomplete-sanitization | test/task-2285-release-metadata.test.ts:123 | warning | false positive |
| js/incomplete-sanitization | test/task-2286-native-sea-smoke.test.ts:160 | warning | false positive |
| js/missing-rate-limiting | src/interfaces/web/host.ts:237 | warning | false positive |
| js/shell-command-injection-from-environment | src/adapters/git/git.ts:45 | warning | false positive |
| js/shell-command-injection-from-environment | src/adapters/agents/launcher-selection.ts:82 | warning | false positive |
| js/shell-command-injection-from-environment | test/task-2286-native-sea-smoke.test.ts:365 | warning | false positive |
| js/shell-command-injection-from-environment | test/task-2286-native-sea-smoke.test.ts:516 | warning | false positive |

Per-finding justification is recorded in `missions/task-2502/codeql-suppressions.sarif`
and expanded in CP-4.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Baseline covers 100% of findings against the parent commit's tree | a worktree at parent commit `288b9048e` scanned with `CODEQL_SUPPRESSIONS=missions/task-2502/codeql-suppressions-empty.sarif PARALLIX_EXECUTION_ROOT=<parent-worktree> npm run test:codeql -- --rerun --list-findings` lists all 12 findings (empty suppressions; source root is the parent-commit checkout); every row classified below | PASS |
| Every finding is genuine/actionable/false-positive/accepted | classification table above; all 11 rows are `false positive` | PASS |
| Query suite recorded and not weakened | `scripts/codeql-sast.sh` records `CODEQL_RECORDED_SUITE` = `security/code-scanning` | PASS |
| CLI version pinned and verified | `codeql version` → `release 2.27.0`; pinned in `scripts/codeql-sast.sh` | PASS |

## Next action
Commit this baseline and the classification, then proceed to CP-2 (runner
implementation). Do not fix findings until CP-4.

Note: the parent-commit worktree is a throwaway (`git worktree add` under a
tmp dir); the durable reference is the parent commit SHA `288b9048e`, which is
in the repository history and reproducible by anyone. No SARIF/result artifacts
are committed — they are generated results, kept out of Git.
