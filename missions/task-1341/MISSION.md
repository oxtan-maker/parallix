# Mission: Make backlog.md optional (task-1341)

## Goal

Remove the hard dependency on Backlog.md-style task files across the parallix CLI so that `px draft` accepts free-text intent (e.g. `px draft "create a hello world program"`) or a directory path (e.g. `px draft ./some-project`) and proceeds without a pre-existing task file in `backlog/tasks/`. Where the workflow previously required a task file, it must fall back to a synthetic task representation with classification `"unknown"` (or equivalent sentinel) so downstream consumers — especially the stats module, gatekeeper, and mission-start preflight — continue operating without throwing fatal errors. Simultaneously audit every other Backlog.md coupling point in the codebase and convert hardcoded assumptions into configurable, opt-in adapters following the existing `workflow.config.json` adapter pattern. Finally, update `README.md` so first-time users can install, configure, and run their first mission without needing to understand Backlog.md.

## Why Now

The current `px draft` flow blocks operators who want to experiment with parallix on a new repo or who do not use Backlog.md at all. The README currently tells users to manually create a markdown task file with specific frontmatter before `px draft` will work — a friction point that contradicts the promise of "just run `px draft task-001`". The stats module already has a `VALID_CLASSIFICATIONS` set limited to `ai_sdlc` and `user_value` (lib/commands/stats.js:35); when no task file exists, `resolveMissionClassification` throws ("Missing or invalid classification"), which cascades into draft, integrate, and stats reporting failures. The adapter pattern in `workflow.config.json` already supports pluggable adapters (`adapters.tasks`, `adapters.agents`, `adapters.missions`), so making the task layer opt-in is architecturally consistent.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: UX friction on first use, stats module crashes without task files, architectural debt from hardcoded Backlog.md coupling

## Scope

### In scope

1. **`px draft` free-text and directory-mode entry points.**
   - Add a `--free-text` flag (or detect when the slug argument is not a `task-NNN` pattern) that creates a synthetic task record in-memory and in a temporary `backlog/tasks/` file with classification `"unknown"`.
   - Add support for `px draft ./path/to/project` that infers a slug from the directory name and creates a synthetic task with classification `"unknown"`.
   - The synthetic task must contain all required frontmatter fields (`id`, `title`, `status`, `assignee`, `labels`, `dependencies`) so downstream code that reads the task file does not crash.

2. **Stats module resilience to unknown classification.**
   - Extend `VALID_CLASSIFICATIONS` in `lib/commands/stats.js` to include `"unknown"` as a valid classification.
   - Modify `resolveMissionClassification` to return `{ classification: 'unknown', taskFile: null }` when no task file exists, instead of throwing.
   - Ensure `recordStageStats` and `upsertStatsRow` accept `classification: 'unknown'` rows without error.
   - Ensure `renderWeeklyStatsReport`, `renderRangeStatsReport`, and `renderMissionPhaseReport` correctly render and summarize `unknown` classification missions.

3. **Mission-start preflight relaxation.**
   - In `lib/commands/mission-start.js`, relax the task-file requirement in preflight when a synthetic task was created during draft. The preflight must not fail if `resolveTaskFile(slug)` returns `{ ok: false }` when the mission is in draft-created state.

4. **Gatekeeper mandatory-files relaxation.**
   - In `lib/tools/gatekeeper.js`, the `checkMandatoryFiles` function currently flags `backlog/tasks/<slug> - *.md` as missing when no task file exists. Relax this check: if the mission directory exists with a MISSION.md and at least one checkpoint, treat the task file as satisfied.

5. **Integrate command resilience.**
   - In `lib/commands/integrate.js`, ensure that `completeTask`, `getTaskStatus`, and `deriveImplementerAndFixRounds` handle missing task files gracefully. When no task file exists, derive the implementer from the mission branch history or review-state, and record the stats row with classification `"unknown"`.

6. **Status command resilience.**
   - In `lib/commands/status.js`, handle missing task files in `findStaleMissionWorktrees` and `status()` without crashing. Display `unknown` status when the task file cannot be resolved.

7. **Active command resilience.**
   - In `lib/commands/active.js`, ensure `resolveTaskFile` failures during execute preflight do not crash when a synthetic task was created during draft.

8. **Audit and refactor all remaining Backlog.md coupling.**
   - Search the entire `lib/` tree for hardcoded references to `backlog/tasks/`, `backlog/completed/`, `backlog/archive/`, `backlog_task_create`, and `Backlog.md` in error messages/log output.
   - Convert any remaining hardcoded paths into adapter-configurable paths (e.g. `adapters.tasks.storagePath` in `workflow.config.json`).
   - Clean up error messages that mention `backlog_task_create` (Backlog.md CLI command) as the sole repair path — add a "manual task file" alternative.

9. **README.md update.**
   - Rewrite the quick-start section so a first-time user can run `px draft "hello world"` or `px draft .` without creating any task files.
   - Remove the requirement to create a Backlog.md-style task file before `px draft` from the primary install instructions.
   - Keep Backlog.md as an *optional* enhancement in a secondary section for operators who want structured task management.
   - Match the tone and structure benchmarked in `docs/readme-rewrite-benchmark.md` (shallow path to value, capability statement first, Git named early).

### Out of scope

- Migrating existing Backlog.md users away from their current task files (backward compatibility is preserved).
- Adding a new task management UI or dashboard.
- Replacing the existing `backlog/tasks/` file-based storage with a database or API.
- Changes to the Forgejo review integration or token management.
- Changes to the Graphify knowledge graph integration.
- Modifying the agent launcher implementations (codex, claude, opencode, mistral).
- Changes to the verification gate system.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. **`px draft` accepts a non-task-slug free-text argument.** Running `px draft "create a hello world program"` in a fresh repo with `workflow.config.json` present creates a mission branch, worktree, MISSION.md scaffold, and a synthetic task file in `backlog/tasks/` with classification `"unknown"` — without any pre-existing task file. Verified by: the command exits 0, `backlog/tasks/` contains a file matching the inferred slug, and the file's frontmatter includes `labels: ["unknown"]`.

2. **`px draft` accepts a directory path.** Running `px draft ./some-project` (where `./some-project` is an existing directory) creates a mission with slug derived from the directory basename, a synthetic task file, and proceeds through the same draft flow as criterion 1. Verified by: the command exits 0 and the task file's `id` frontmatter matches `TASK-{basename-hash}`.

3. **Stats module accepts classification `"unknown"`.** `resolveMissionClassification` returns `{ classification: 'unknown', taskFile: null }` for a slug with no task file. `recordStageStats` and `upsertStatsRow` accept rows with `classification: 'unknown'` without throwing. `renderWeeklyStatsReport` includes unknown-classification missions in its counts. Verified by: unit tests in `test/stats.test.js` asserting `resolveMissionClassification('nonexistent')` returns `{ classification: 'unknown', taskFile: null }` and `upsertStatsRow({ mission: 'test', classification: 'unknown', ... })` succeeds.

4. **Mission-start preflight passes without task file.** Running `px active <slug>` for a draft-created mission (where the task file exists with classification `"unknown"`) passes preflight. Verified by: `mission-start.test.js` asserts `missionStart(['task-free-text'], { returnResult: true })` returns `{ pass: true }`.

5. **Gatekeeper does not block on missing task file when other artifacts exist.** `checkMandatoryFiles(slug)` returns `{ ok: true }` when MISSION.md and at least one CP-*.md exist in the mission directory, even if no task file exists in `backlog/tasks/`. Verified by: `gatekeeper.test.js` asserts `checkMandatoryFiles('task-no-file', { rootDir: <temp-repo-with-mission> })` returns `{ ok: true }`.

6. **Integrate completes without task file.** `px integrate <slug>` for a draft-created mission completes the integration flow (squash merge, stats recording, cleanup) without crashing on missing task file. The stats row is recorded with classification `"unknown"`. Verified by: `integrate.test.js` asserts integration succeeds and the stats CSV contains a row with `classification=unknown`.

7. **No hardcoded Backlog.md references remain in error messages.** All error messages and log output in `lib/` that previously cited `backlog_task_create` as the sole repair path now also mention the manual task file creation alternative. Verified by: `grep -r 'backlog_task_create' lib/` returns zero matches.

8. **README.md quick-start works without mentioning task file creation.** The README's "Quick start" section (first 80 lines) contains no instruction to create a Backlog.md-style task file before `px draft`. The first actionable example uses `px draft` with a free-text or simple slug argument. Verified by: reading the first 80 lines of `README.md` confirms no mention of creating task files, and no mention of `backlog/tasks/` in the quick-start block.

9. **All existing tests pass.** `npm test` completes with exit code 0. Verified by: running `npm test` after the changes produces zero test failures.

10. **Backward compatibility preserved.** Existing repos with Backlog.md-style task files in `backlog/tasks/` continue to work exactly as before. `px draft task-001` where `task-001` has a proper task file with `ai_sdlc` or `user_value` classification behaves identically to pre-change behavior. Verified by: existing test suites (`draft.test.js`, `backlog.test.js`, `integrate.test.js`) all pass without modification.

## Risks and Assumptions

- **Risk:** The stats module's weekly/monthly reports aggregate by classification; introducing `"unknown"` may skew the `ai_sdlc` vs `user_value` ratio. Mitigation: display `unknown` as a separate bucket in reports, clearly labeled.
- **Risk:** Synthetic task files written to disk during free-text draft may collide with real task files if the user later creates a Backlog.md task with the same slug. Mitigation: synthetic tasks use a reserved prefix in the `id` (e.g., `SYNTH-`) or include a `source: synthetic` field so they can be identified and cleaned up.
- **Assumption:** Operators using free-text draft do not expect structured task metadata (acceptance criteria, dependencies, labels). The synthetic task is intentionally minimal.
- **Assumption:** The existing adapter pattern in `workflow.config.json` is sufficient for making the task storage path configurable; no new config schema is needed.
- **Risk:** Modifying `VALID_CLASSIFICATIONS` in stats.js may affect downstream dashboards or CSV consumers that only expect `ai_sdlc` and `user_value`. Mitigation: `"unknown"` is additive; consumers that filter on known classifications simply exclude unknown rows.
- **Assumption:** The gatekeeper's purpose (ensuring mission artifacts exist before review) is not undermined by relaxing the task-file check — MISSION.md and checkpoints are the true artifacts required for review.

## Checkpoints

- CP 1: Audit complete — inventory all Backlog.md coupling points in `lib/` with file paths and line numbers, categorized by severity (hard-fail vs warn-vs-continue).
- CP 2: Stats module updated — `VALID_CLASSIFICATIONS` includes `"unknown"`, `resolveMissionClassification` returns `unknown` for missing tasks, unit tests pass.
- CP 3: Draft command updated — free-text and directory-mode entry points work, synthetic task file creation verified, draft agent receives appropriate prompt context.
- CP 4: Downstream commands resilient — mission-start, gatekeeper, integrate, status, and active all handle missing task files without crashing; unit tests pass.
- CP 5: Hardcoded references removed — all `backlog_task_create` mentions replaced with dual-path error messages; adapter-configurable paths implemented.
- CP 6: README.md updated — quick-start section rewritten per benchmark, first-time user path verified.
- CP 7: Full test suite passes — `npm test` clean, all new tests added for unknown-classification paths.

## Gates

- [ ] npm test (all tests pass)
- [ ] Manual smoke test: `px draft "hello world"` in a fresh repo (no backlog/tasks/ pre-existing)
- [ ] Manual smoke test: `px draft .` in a repo with an existing project
- [ ] Manual smoke test: stats report renders unknown classification correctly

## Restricted Areas

- Do not modify agent launcher implementations (`lib/agents/`) — agent behavior is unchanged.
- Do not modify Forgejo integration (`lib/tools/forgejo.js`, `lib/review/`) — review surface is unchanged.
- Do not modify the Graphify integration — knowledge graph behavior is unchanged.
- Do not modify the verification gate system (`lib/core/verification.js`) — gate execution is unchanged.
- Do not change the `workflow.config.json` schema for existing fields — only add new optional fields.

## Stop Rules

- If the synthetic task approach creates more coupling (new hardcoded paths in stats/integrate) than it removes, pause and redesign the abstraction boundary.
- If `npm test` has more than 3 failing tests after 2 hours of fixing, stop and escalate — the change may be too broad for a single pass.
- If the README rewrite introduces claims that cannot be backed by `docs/use-cases.md`, revert to the current README structure for those sections.
- If backward compatibility breaks (existing `px draft task-NNN` flows fail), stop and prioritize fixing backward compat over new features.
