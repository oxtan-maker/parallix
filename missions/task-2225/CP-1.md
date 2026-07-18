# CP-1 — packageRoot() asset-resolution hardening (task-2225, phase T2)

## Summary of work done

Implemented ADR 0044 phase T2 (docs/adr/0044-workflow-distribution-model.md §6, §9): a single
`packageRoot()` helper that resolves the Parallix package root from a module's `__dirname`,
plus migration of every depth-coupled, package-owned asset lookup in the seven required
categories (prompts/, templates/, config/, data/, docs/, examples/, executable scripts) to it.

- **Helper:** `lib/core/package-root.ts` — `packageRoot(fromDir)` walks upward from the caller's
  `__dirname` to the nearest ancestor `package.json` named `@magnusekdahl/parallix`. It never
  reads `process.cwd()`, caches per start dir, tolerates malformed `package.json` (keeps walking),
  and throws a descriptive error when no matching ancestor exists.

- **Migrated call sites** (each now `path.join(packageRoot(__dirname), <category>, …)`):

  | Location | Asset | Category |
  | --- | --- | --- |
  | `lib/review/review-prompts.ts:16-19` | `prompts/review.md`, `act-on-review.md`, `review-verbose.md`, `act-on-review-verbose.md` | prompts |
  | `lib/commands/draft.ts:18` | `prompts/draft.md` | prompts |
  | `lib/commands/draft.ts:19` | `templates/mission-scaffold.md` | templates |
  | `lib/commands/active.ts:18` | `prompts/execute.md` | prompts |
  | `lib/agents/agent-config.ts:18` | `config/agents.json` | config |
  | `lib/core/runtime-matrix.ts:6` | `config/agents.json` | config |
  | `lib/core/state-map.ts:7` | `config/state-map.json` | config |
  | `lib/commands/mutation-gate.ts:27` | `config/mutation-baseline.json` (via `REPO_ROOT`) | config |
  | `lib/commands/stats.ts:123` | `data/stats.seed.csv` | data |
  | `lib/review/review-loop.ts:710` | `scripts/bootstrap.sh` | executable script |

- **Inventory decisions (reviewed and excluded, with rationale):**
  - `lib/review/rebase.ts:160` (`../index.js`) resolves the sibling `lib/index.js` workflow-CLI
    module — a one-level relative reference within `lib/`, not a package-root asset in the seven
    categories. `packageRoot()/index.js` would target the **root** `index.js` (a different file),
    so migrating it would change behavior. Left unchanged.
  - `lib/commands/coverage-gate.ts:57` and `lib/core/mutation-scoper.ts:20` (`REPO_ROOT`) resolve
    `test/`, `coverage/`, and the git operating root — none in the seven asset categories. Left
    unchanged per AC #2 scope.
  - `lib/commands/integrate.ts:238` reads `config/integration-pipelines.json` from the **user
    workspace** (`getPrimaryWorktree()`), not the package. Out of scope (non-package-owned).
  - `docs/` and `examples/`: no `__dirname`-anchored package-owned lookups exist. Every `docs/`
    lookup uses the caller's workspace `rootDir` (user repo), and `examples/` is not read at runtime.

- **Behavior-preservation note (`stats.ts`):** the prior expression `path.join(__dirname, '..',
  'data', …)` under-counted its `..` segments and resolved to the non-existent `lib/data/`. The
  migrated form resolves the real package `data/` dir at the root. No `stats.seed.csv` is shipped
  (`data/` holds only `.gitkeep`/`.npmignore`), so seeding remains a no-op in both layouts —
  observable behavior is preserved while the depth-coupling bug is removed.

## Goal Check

| Criterion | Evidence | Status |
| --- | --- | --- |
| A single `lib/core/` `packageRoot()` helper walks upward from a module `__dirname`, returns the nearest dir whose `package.json` names `@magnusekdahl/parallix`, and does not consult `process.cwd()` | `lib/core/package-root.ts:33-68` (no `process.cwd()` reference); tests `packageRoot resolves the checkout root by package name`, `packageRoot walks up from any nested module dir to the same root`, `packageRoot does not consult process.cwd()` in `test/task-2225-package-root.test.js` | ✅ Pass |
| All package-owned lookups for prompts/, templates/, config/, data/, and executable scripts use paths derived from `packageRoot()`; no migrated lookup retains a fixed count of `..` to reach the package root | `lib/review/review-prompts.ts:16`, `lib/commands/draft.ts:18`, `lib/commands/draft.ts:19`, `lib/commands/active.ts:18`, `lib/agents/agent-config.ts:18`, `lib/core/runtime-matrix.ts:6`, `lib/core/state-map.ts:7`, `lib/commands/mutation-gate.ts:27`, `lib/commands/stats.ts:123`, `lib/review/review-loop.ts:710` all call `packageRoot(__dirname)`; `git grep -n "__dirname, '..', '..'" lib` over migrated categories returns none | ✅ Pass |
| A test changes the process CWD to a temporary dir outside the checkout and proves each migrated resolution path still finds its intended package asset | `test/task-2225-package-root.test.js` tests `every migrated asset resolves under the package root from a temp CWD` and `migrated call sites resolve their assets at module load from a temp CWD` (require modules under `mkdtempSync`/`chdir`) | ✅ Pass |
| Existing behavior in the current source layout is retained for every migrated command/script (same package-owned asset resolved) | Each migrated const resolves to the identical `<root>/<category>/<file>` as before, verified by `every migrated asset resolves under the package root from a temp CWD` asserting `resolved === path.join(ROOT, rel)`; `stats.ts` documented above (both prior and new resolve to a non-existent seed → seeding no-op preserved) | ✅ Pass |
| `npm test`, `node test/e2e-mission-lifecycle.test.js`, `./scripts/verify-local.sh all`, and `./scripts/verify-local.sh static-analysis` complete successfully | `npm test` → 2176 pass / 0 fail / 25 skipped; `node test/e2e-mission-lifecycle.test.js` → 6 pass / 0 fail; `./scripts/verify-local.sh all` → EXIT 0; `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED (ESLint, tsc typecheck, test-hygiene, test typecheck) | ✅ Pass |
| Phase remains revertible as one focused commit sequence; reverting restores prior asset-lookup expressions without asset-content or distribution-layout changes | Diff limited to `lib/core/package-root.ts` (new), 8 `.ts` call sites + regenerated `lib/commands/stats.js`, and `test/task-2225-package-root.test.js` (new); no asset files, no `dist/` flip; `git diff --check` clean | ✅ Pass |

## Definition of Done

| DoD | Evidence | Status |
| --- | --- | --- |
| #1 Verification gate ran and passed on the final tree with captured proof | `./scripts/verify-local.sh all` EXIT 0 (2176 pass/0 fail); `static-analysis` ALL STAGES PASSED | ✅ Pass |
| #2 Lint and static analysis clean on every changed file | `verify-local.sh static-analysis`: ESLint clean, tsc typecheck clean, test typecheck clean | ✅ Pass |
| #3 No `.only` / bare `.skip` introduced | `test/task-2225-package-root.test.js` uses plain `test(...)`; test-hygiene gate PASS | ✅ Pass |
| #4 Final checkpoint Goal Check table cites real evidence (file:line, test names) | This table | ✅ Pass |
| #5 Docs updated for behavior change | No user-facing/workflow behavior change (behavior-preserving refactor per ADR 0044 T2); `stats.ts` depth-bug note captured above | ✅ N/A |
| #6 Bug-labeled reproduction test | Mission is labeled `typescript`/`migration`/`user_value` (not `bug`); focused red/green coverage still added in `test/task-2225-package-root.test.js` | ✅ N/A |

Next action: `git commit` the phase, then re-run `px review task-2225 --submit`.
