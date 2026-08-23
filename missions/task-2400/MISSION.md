# Mission: Eliminate board filesystem and Git read amplification (task-2400)

## Goal
Make the interactive board projection read repository topology and task metadata once per projection instead of rediscovering both per mission. Introduce one immutable worktree-topology snapshot reused by the mission-read and gate-read readers (so `git worktree list --porcelain` subprocesses are O(1) w.r.t. mission count), read each distinct task Markdown document once for its metadata, and stop enumerating `backlog/archive/` from the normal board projection — without touching running-agent detection, durable cache/authority, or existing precedence rules.

## Why Now
The board builder (`BoardProjectionBuilder`) is constructed once but `.build()` runs on every refresh, and every mission materialisation re-runs the same expensive reads:
- `resolveWorktree()` in `src/adapters/git/worktree.ts` shells out to `git worktree list --porcelain`. It is called once per mission in `ConcreteMissionReadAdapter.buildWorktreeRead()` / `buildIntegrationBaseRead()` and once per mission in `ConcreteGateReadAdapter.searchRoots()`, so subprocess count grows linearly with mission count.
- Each mission materialisation calls `getTaskStatus`, `getTaskAssignee`, `getTaskLabels`, and `getTaskFrontmatterValue` (several times for title/id/closedAt), and each helper does its own `fs.readFileSync` of the whole task file; `buildIntegrationBaseRead` and `buildWorktreeRead` then re-read the same file through `buildRecord`.
The board is the most frequently refreshed surface, so this is the highest-leverage read path. The fix is bounded to a single build and needs no new infrastructure, so doing it now is cheap and low-risk.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: read amplification on the refresh path, linear-in-missions `git worktree list` subprocesses, redundant per-task `readFileSync`, archive scanned though it is cold storage

## Scope
- Worktree topology: obtain one immutable worktree-topology snapshot per board projection and route both `ConcreteMissionReadAdapter` (mission materialisation) and `ConcreteGateReadAdapter` (gate lookup) through that snapshot instead of calling `git worktree list --porcelain` per mission. The number of `git worktree list` subprocesses caused by those projection readers must be O(1) with respect to mission count.
- Task metadata: read each distinct task Markdown document once per projection and extract id, status, assignee, title, labels, and closedAt from that single snapshot rather than calling the small frontmatter helpers (each of which currently `readFileSync`s the whole file). Per-read/per-build materialisation only.
- Archive exclusion: `loadAllMissions()` enumerates `backlog/tasks/` and `backlog/completed/` only; it must not `readdirSync`/scan `backlog/archive/`.
- Preserve all existing task/worktree precedence rules for the in-scope stores (`tasks` > `completed` dedup by frontmatter `id`, priority ordering) and all board semantics (attention ranking, gate/review/current-work wiring, source facts).
- Preserve `detectRunningMissionSessions` and everything it depends on verbatim: its `ps` scan, its own worktree observation, `currentWork`, session markers, process liveness, and all fallback semantics. It may contribute at most one additional constant worktree-list operation; the requirement is to remove per-mission worktree subprocesses, not to consolidate worktree authorities.
- Add regression tests that count filesystem reads and `git worktree list` invocations so the O(1)/single-read behaviour cannot regress to N-per-mission. Use enough missions that a fake constant implementation cannot accidentally pass.
- Do NOT introduce a daemon, filesystem watcher, event bus, persistent projection cache, new durable authority, or generic caching framework. The design stays: read topology once, read each task document once, build the projection from those snapshots.

## Out of Scope
- Archival policy: moving old completed missions into `backlog/archive/`, retention rules, completed-task ageing, and archive mutations are owned by `backlog.md` and are explicitly out of scope. Do not repair `backlog.md` here.
- Running-agent detection: no behavioural change to `detectRunningMissionSessions`, its `ps` scan, its worktree observation, session markers, or fallbacks.
- New durable metadata cache or a second task authority; no cross-build/cross-process caching of task or worktree state.
- Any change outside the board projection read path (write paths, task transitions, review state, metrics computation, CLI commands other than the board).
- Any change to `resolveBaseWorktree` base-branch resolution semantics beyond what is required to reuse the topology snapshot.

## Success Criteria
> Falsifiability rule (ADR 0039 Part 2): each criterion below is measurable; a criterion that cannot be failed by a named test is not accepted.

1. Worktree-list subprocesses are O(1) w.r.t. mission count. In `test/board-readers.worktree-amplification.test.ts`, build a projection over `N = 5` missions and again over `N = 50` missions using a counting `resolveWorktree` seam, and assert the total `git worktree list` call count for the 50-mission tree is at most a small constant above the 5-mission count (e.g. `<= count5 + 2`), not proportional. Fails on the parent tree (current code calls it once per mission).
2. Each distinct task document is read once per projection for metadata. Same test file, counting seam on the task-file read helper(s): assert `readFileSync` (or the injected read primitive) is invoked once per distinct task file across the full build (mission materialisation + gate lookup), not once per helper call. Fails on the parent tree.
3. `loadAllMissions()` does not scan `backlog/archive/`. Test asserts (a) a task file placed only under `backlog/archive/` does not appear in the projected missions, and (b) the archive directory is never passed to `readdirSync`/`existsSync` by the projection path. Fails on the parent tree (archive is currently enumerated at priority 2).
4. Precedence and board semantics preserved. The existing suites `test/board-readers.test.ts`, `test/board-projections.test.ts`, `test/backlog_gate.test.ts`, and `test/running-sessions.test.ts` pass unchanged, and a dedicated assertion confirms tasks > completed dedup by `id` still holds for the two in-scope stores.
5. Running-agent detection untouched. `test/running-sessions.test.ts` passes unchanged and `detectRunningMissionSessions` retains its current exported contract and fallbacks (no signature or behavioural change).
6. No new durable authority or runtime. Static review (evidence in checkpoint Goal Check) confirms no daemon, watcher, event bus, persistent cache, or new caching dependency was introduced.

## Risks and Assumptions
- The worktree snapshot must be scoped to a single `build()`; `loadAllMissions()` is also called elsewhere (metrics adapter, mission query) outside the projection and must not reuse a stale build snapshot. Assumption: the snapshot is created and consumed within one `build()` call.
- `ConcreteMissionReadAdapter` and `ConcreteGateReadAdapter` are constructed once in `src/composition/board-projection.ts` and reused across builds, so the snapshot must be injectable into them per build without changing their external options contract for existing callers.
- Reusing a single topology snapshot must not change which worktree a mission resolves to; `resolveWorktree()`/`resolveBaseWorktree()` path-normalisation (incl. `workTreeRootFor`) and `detectRunningMissionSessions` worktree observation must yield identical results for the same repo state.
- Removing archive enumeration changes which missions appear on the board (archive missions drop out). This is intended per the description; assume it is accepted behaviour, not a regression.
- The count-based success criteria assume a deterministic counting seam; real-git tests are not required and are discouraged (keep unit tests fast, per repo conventions).

## Checkpoints
- CP 1: Author the read-amplification regression tests (fs-read + `git worktree list` counters, archive-scan assertion) so they fail red on the parent tree; wire the counting seams into the concrete readers.
- CP 2: Introduce the immutable worktree-topology snapshot and route both projection readers through it; confirm `git worktree list` count is O(1).
- CP 3: Collapse the per-mission task-file reads into a single read per distinct task document while preserving every metadata field and precedence rule.
- CP 4: Exclude `backlog/archive/` from `loadAllMissions()`; confirm no scan and correct mission set.
- CP 5: Run all gates, confirm running-agent detection and board semantics unchanged, update docs for any user-facing board behaviour change.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts, in priority order:
  1. **Recognized repo commands or paths** — e.g., `` `node --test test/board-readers.worktree-amplification.test.ts` ``, `` `./scripts/verify-local.sh all` ``, `` `./scripts/verify-local.sh static-analysis` ``
  2. **Test names** — must match a real test name in the repo, e.g. `"board projection worktree-list count is O(1) vs mission count"`
  3. **Test file paths** — must be an existing test file, e.g. `test/board-readers.worktree-amplification.test.ts`
  4. **ADR references** — e.g. `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose alone is NOT enough: a weak agent that pastes `ls`/`stat` or says "reads are reduced" without one of the accepted references above will be rejected. Pair any shell output with exactly one accepted reference (a concrete `node --test ...` invocation, a named test, a test file path, or an ADR number).
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Read-amplification regression test exists and fails red on parent tree | `test/board-readers.worktree-amplification.test.ts`, `"git worktree list count is O(1) vs mission count"` | RED |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- `src/adapters/agents/running-sessions.ts` — `detectRunningMissionSessions`, `defaultListProcesses`, `defaultListWorktrees`, `parsePxInvocation`, and the repo-location/worktree-resolution helpers: no behavioural, signature, or fallback change.
- `src/adapters/git/worktree.ts` — `resolveWorktree` / `resolveBaseWorktree` core resolution and `workTreeRootFor` normalisation semantics (you may stop *calling* them per mission, but must not weaken their correctness).
- `src/adapters/backlog/mission-materialization.ts` — `materializeBacklogMission` precedence/conflict rules.
- `src/adapters/backlog/task-metadata.ts` and `src/adapters/backlog/task-transitions.ts` — the frontmatter helpers' parsing/return contract (only their call frequency changes, not their output).
- Any durable-persistence or authority surface governed by `docs/adr/0053-*.md` and `test/persistence-character-mapping.test.ts` (no new authority, no durable cache).
- Any file outside the board projection read path (write paths, task transitions, review, metrics, CLI commands other than the board).

## Stop Rules
- Stop writing code once the read-amplification regression tests (CP 1) are red on the parent tree; do not proceed to a fix before the red is established.
- Stop if eliminating per-mission worktree subprocesses would require changing `detectRunningMissionSessions` or its worktree observation — surface it instead of touching that area.
- Stop if a single-snapshot design cannot be injected per `build()` without changing the external options contract of `ConcreteMissionReadAdapter` / `ConcreteGateReadAdapter` for existing callers — re-scope rather than over-engineer.
- Stop before adding any durable cache, watcher, daemon, event bus, or generic caching dependency, even if it would reduce reads further.
- Stop before touching backlog.md, archival policy, or completed-task ageing.
- Stop before running any test other than the single `./scripts/verify-local.sh all` gate (plus the static-analysis gate) during drafting; during execution keep unit tests fast and dependency-free (no real git, no real forgejo).
