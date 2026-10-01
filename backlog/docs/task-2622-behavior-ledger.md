# TASK-2622.01 — Behavior ledger (HISTORICAL ARTIFACT)

> Status: **baseline / historical**. Maps each runtime-discovered test identity
> to its behavior guarantee, tier, task provenance, assertion location, owning
> contract, and migration disposition. Same-line LCOV coverage is **never**
> treated as proof of equivalent behavior (AC#3). This is a comparison aid, not
> a second selection authority.

## Ledger schema (one row per tested unit)

| field | meaning |
|---|---|
| identity | discovered test file / case path |
| behavior | behavior / boundary / fixture / historical-regression |
| guarantee | the invariant the test pins |
| tier | unit | integration-ci | integration-local | agent-e2e |
| task-provenance | originating task ID (kept as regression provenance) |
| assertion | file:line of the primary assertion |
| owning-contract | application use-case/service that owns the behavior |
| disposition | keep | move-with-task-id | delete-under-review | merge-into-contract-suite |

## Tier distribution (pinned revision b3459b627)

Total discovered `test/**/*.test.ts`: **610**

| tier | files | authority |
|---|---|---|
| unit | 397 | default suite (not in CI/local/e2e arrays) |
| integration-ci | 203 | `test/lib/test-categories.ts` `INTEGRATION_CI_TESTS` |
| integration-local | 8 | `test/lib/test-categories.ts` `INTEGRATION_LOCAL_TESTS` (+ `INTEGRATION_LOCAL_REASONS` GitHub-runner dependency reasons) |
| agent-e2e | 2 | `test/lib/test-categories.ts` `AGENT_E2E_TESTS` (e2e-mission-lifecycle, e2e-real-agent-smoke) |

## Owning contracts (application use-case layer, `src/application`, 112 files)

Mixed suites route to the owning contract, not to a text-screen guess. Area prefix → owning contract examples:

- `board-*`, `tui-*`, `stats-*`, `product-*`, `web-*` → `src/application/projections/*` + `tui-capabilities`
- `integrate-*`, `mission-*` → `src/application/integrate-command-use-case.ts`, `mission-integration-service.ts`, `recovery-supervisor.ts`
- `review-*` → `src/adapters/review/*` consumers of `ReviewState`
- `sqlite-*`, `persistence-*` → `src/adapters/mission/sqlite-mission-store`
- `forgejo-*`, `github-*` → Forgejo adapter (CI-lane prohibited markers in `PROHIBITED_CI_DEPENDENCY_MARKERS`)
- `codex-`, `opencode-`, `qwen-`, `vibe-`, `custom-*` → agent launcher contracts

## Behavior-category counts

- Files carrying a `boundary` / `fixture` / `regression` marker: **557** of 610 (430 boundary, 127 regression, 0 fixture by the classification in the full ledger).
- Task-named files by filename (`test/task-*.test.ts`): **341** — of which **340** carry a numeric task ID (`task-\d+`); `test/task-metadata-pure.test.ts` has a textual suffix and is the reconciled 1-file difference (see the counts reconciliation section). Task IDs retained as regression provenance within behavior-owned suites.

## Migration disposition rules (for TASK-2622 wave, owned here as policy)

1. Keep behavioral guarantees and historical failure modes, not just line totals.
2. Keep task IDs as regression provenance inside behavior-owned suites; do not strip them on move.
3. File ownership is provisional: review each assertion, route mixed suites to the owning contract.
4. New integration tests require classification in `test/lib/test-categories.ts` with local-only GitHub-runner dependency reasons named.
5. No giant files: production `src/` and `web/` <= 500 lines, tests <= 1000 (existing debt listed in `test/file-size-cap.test.ts`).

## Per-unit records — full enumeration (F1 satisfied)

The ledger holds **one record for every discovered tested unit** — all **610**
`test/**/*.test.ts` files — not a representative sample. The complete table is
in `backlog/docs/task-2622-behavior-ledger-full.md` (610 rows, one per file),
and the machine-readable form is `backlog/docs/task-2622-behavior-ledger.jsonl`
(one JSON object per line). Every row follows the schema above with the pinned
primary-assertion `file:line`, owning contract, and migration disposition.

## Pinned-revision discovery counts — reconciliation (F2 satisfied)

Discovery run on the pinned revision **b3459b62757740a109bc9d1a72b5ed981bda3909**
(`find test -name '*.test.ts'` against the pinned tree):

| quantity | authoritative count |
|---|---|
| total `test/**/*.test.ts` | **610** (604 root + 6 in `test/adapters/`) |
| task-named by filename `test/task-*.test.ts` | **341** |
| of those, carrying a numeric task ID (`task-\d+`) | 340 |
| unit | 397 |
| integration-ci | 203 |
| integration-local | 8 |
| agent-e2e | 2 |
| fixtures (`test/fixtures/**`, non-test files) | 31 |

**The earlier conflicting figures (340 / 341 / 346) were definition mismatches,
not divergent populations, and are now reconciled to the single authoritative
count above:**

- **341** = files matching the filename glob `test/task-*.test.ts`.
- **340** = files whose filename carries a *numeric* task ID (`test/task-\d+`).
  The one file that matches the glob but **not** the numeric definition is
  `test/task-metadata-pure.test.ts` (textual suffix `metadata-pure`, no
  `task-<number>`). It is counted in the 341 glob total and excluded from the
  340 numeric total — this is the entire 1-file discrepancy.
- **346** was a stale over-count from an earlier draft enumeration and is
  superseded by the authoritative **341** glob / **340** numeric counts above.
- The wave inventory (`task-2622-test-wave-inventory.json`) computes
  `taskNamed` with the `task-\d+` rule, hence its `340`; its tier split
  (unit 397 / integration-ci 203 / integration-local 8 / agent-e2e 2) matches
  the authoritative counts.

**Intervening-work difference, identified and refreshed.** The wave inventory
was captured at revision `78c1fc1464c931ec2afdbd92dc66975726dbe4f9`, which is an
ancestor of the pinned baseline `b3459b627`. The five commits between them are
`backlog(task-2622.01)` bookkeeping transitions that changed **only**
`backlog/tasks/task-2622.01 ...md` and **zero** `test/` files. Therefore the
test population is byte-identical at both revisions — 610 files / 341 glob /
340 numeric at each — so no test population refresh was required; the only
refresh was correcting the count definitions above, which this section records.

## Per-unit schema (one row per tested unit)

| field | meaning |
|---|---|
| identity | discovered test file / case path |
| behavior | behavior / boundary / fixture / historical-regression |
| guarantee | the invariant the test pins on the pinned revision |
| tier | unit | integration-ci | integration-local | agent-e2e |
| task-provenance | originating numeric task IDs (kept as regression provenance) |
| assertion | `file:line` of the primary assertion |
| owning-contract | application use-case/service that owns the behavior |
| disposition | keep | move-with-task-id | delete-under-review | merge-into-contract-suite |
