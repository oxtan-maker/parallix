# Mission: Refactor `lib/agents/agents.ts` Into Stable Seams (task-1426)

## Goal
Refactor `lib/agents/agents.ts` so the file stops acting as a 1,050-line catch-all and instead becomes a thin orchestration entrypoint over smaller `lib/agents/` modules, while preserving the current public API, retry semantics, blocklist behavior, session behavior, and launcher-selection behavior.

## Why Now
`lib/agents/agents.ts` currently mixes at least four distinct responsibilities in one file: config/blocklist IO, git-worktree/local-config resolution, launcher availability and agent selection, and the `startAgent()` retry/launch/session flow. That size makes behavior changes risky, slows review, and encourages future fixes to keep landing in the same monolith. The repo has already been extracting per-agent launchers and telemetry into `lib/agents/*`; this refactor finishes that direction by giving the shared harness logic credible internal seams before the next agent-behavior changes stack on top of it.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: `lib/agents/agents.ts` is 1,050 lines; it contains separable helper clusters already exercised by `test/agents.test.js` and `test/agents-limit-hit.test.js`; the mission is structural refactoring, not product behavior change

## Scope
- Extract config and blocklist concerns from `lib/agents/agents.ts` into dedicated `lib/agents/` helper module(s). This includes the read/parse/invalid-config path, local-config merge/migration path, blocklist timestamp parsing, block checks, and blocklist write helper behavior.
- Extract worktree/main-worktree detection helpers from `lib/agents/agents.ts` into dedicated `lib/agents/` helper module(s), keeping current warning behavior and cache semantics intact.
- Extract launcher registry and selection concerns from `lib/agents/agents.ts` into dedicated `lib/agents/` helper module(s). This includes launcher status probing, PATH probing hook, eligibility filtering, weighted/random selection, launcher support assertion, and no-output watchdog config resolution.
- Reduce `lib/agents/agents.ts` so it primarily owns exported wiring/constants and the high-level `startAgent()` / `startDraftAgent()` orchestration path.
- Update tests and any directly affected docs only as needed to reflect the refactor and preserve evidence for unchanged behavior.

## Out of Scope
- No changes to agent-family product behavior, launcher CLI arguments, model resolution rules, blocklist policy, limit-hit detection heuristics, or telemetry semantics except what is strictly required to preserve behavior after extraction.
- No renaming of agent families or public config keys (`codex`, `claude`, `vibe`, `custom`, `human`).
- No changes outside the shared agent harness surface unless import rewiring is strictly required by the refactor.
- No new workflow features, prompt changes, or review/integrate pipeline changes.
- No broad doc rewrite of `docs/agents.md`; only touch docs if the refactor changes concrete file locations or code references that the docs already name.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC 1: `lib/agents/agents.ts` is reduced to an orchestration-focused module and no longer defines the config/blocklist parsing and merge helpers inline. Specifically, `parseAgentConfigFile`, `readAgentConfig`, `readAgentConfigOrExit`, `parseBlockUntil`, `isAgentBlocked`, `resolveBlocklistTargetPath`, and `updateAgentBlock` live in dedicated `lib/agents/` helper module(s) with named exports.
- SC 2: `lib/agents/agents.ts` no longer defines the git-worktree discovery helpers inline. Specifically, `getMainWorktreePath`, `getGitPath`, `parseWorktreePaths`, `detectMainWorktreePath`, and the associated common-dir cache move to dedicated `lib/agents/` helper module(s) without changing the current warning behavior for non-repo and failing-git cases.
- SC 3: `lib/agents/agents.ts` no longer defines the launcher-selection helpers inline. Specifically, launcher status probing, PATH probing hook, `workflowLauncherStatus`, `setCommandPathProbe`, `eligibleAgentsForStep`, `weightedRandom`, `selectAgent`, `assertAgentSupported`, and `resolveNoOutputWatchdogConfig` live in dedicated `lib/agents/` helper module(s), and their current exported/public call surface remains available to existing callers.
- SC 4: The `startAgent()` orchestration path preserves the current retry and persistence rules after the extraction. Evidence must cover these behaviors: pinned blocked-agent reroute, launcher-unavailable reroute, limit-hit block-and-retry, deterministic launch-failure skip-blocklist, transient launch-failure blocklist write, successful session-marker persistence, and resume decision behavior.
- SC 5: External import stability is preserved for existing repo callers and tests: `lib/agents/agents.ts` continues to export the same top-level symbols currently used across the repo (`startAgent`, `startDraftAgent`, `selectAgent`, `eligibleAgentsForStep`, `readAgentConfig`, `readAgentConfigOrExit`, `assertAgentSupported`, `workflowLauncherStatus`, `setCommandPathProbe`, `isAgentBlocked`, `parseBlockUntil`, `isInvalidAgentConfigError`, `updateAgentBlock`, `resolveBlocklistTargetPath`, `resolveNoOutputWatchdogConfig`, `shouldPersistLaunchFailureBlock`, plus the agent-name constants).
- SC 6: Verification proves the refactor did not break the shared agent harness surface: `./scripts/verify-local.sh all` passes, and because the mission changes files under `lib/`, `./scripts/verify-local.sh static-analysis` also passes before handoff.

## Risks and Assumptions
- Risk: The file exports both public helpers and test hooks, so moving code can accidentally break test imports or create circular dependencies between new helper modules and launcher modules. Mitigation: keep new modules dependency-light and keep `agents.ts` as the export aggregator.
- Risk: `startAgent()` behavior is heavily branchy, and seemingly harmless extraction can change retry order, logging timing, or blocklist writes. Mitigation: preserve control flow first, then extract with focused regression evidence tied to existing test names.
- Risk: The repo may still rely on exact helper locations in docs or checkpoint evidence. Mitigation: update only concrete stale references discovered during the refactor.
- Assumption: `lib/agents/agents.ts` is the TypeScript source of truth and no tracked generated JS counterpart must be hand-edited for this mission. If that assumption is false, stop and confirm the required source-of-truth pattern before proceeding.

## Checkpoints
- CP 1: Extract config/blocklist and worktree-resolution helpers into dedicated `lib/agents/` module(s), keep exported behavior stable, and prove the invalid-config, merge-local, migration, timestamp, and blocklist-write paths still behave the same.
- CP 2: Extract launcher registry, launcher health probing, support assertion, eligibility/selection, and no-output watchdog resolution into dedicated `lib/agents/` module(s), keeping the existing exported helper surface intact.
- CP 3: Reduce `startAgent()` to orchestration over the extracted helpers, keep current retry/session/blocklist semantics intact, update any directly affected docs/tests, and close with `./scripts/verify-local.sh all` plus `./scripts/verify-local.sh static-analysis`.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include:
- A summary of the concrete work done in that checkpoint, naming the extracted module(s) or preserved behavior(s)
- A `## Goal Check` section using that exact heading
- A 3-column pipe-delimited markdown table using exactly: `| Criterion | Evidence | Status |`
- At least one evidence row per success criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/agents/agents.ts:292` (must point to an existing file and line)
  2. **Exact test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/agents.test.js` ``, `` `node test/agents-limit-hit.test.js` ``, `` `git diff --stat` ``, `` `px review task-1426 --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough. If shell output is useful, pair it with one of the accepted references above so the evidence is machine-checkable.
- A non-generic `Next action:` line at the bottom naming the next checkpoint task.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Config helpers moved out of `agents.ts` | `lib/agents/agent-config.ts:1`, `lib/agents/agents.ts:1` | PASS |
| Selection helpers still exported through aggregator | `lib/agents/agents.ts:1`, `test/agents.test.js` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- Do not change the semantics of blocklist writes, blocklist merge precedence, or invalid-config failures while extracting helpers.
- Do not change launcher command resolution, agent keys, session marker format, or limit-hit source/reason formatting as part of the refactor.
- Do not introduce new cross-cutting helpers outside `lib/agents/` unless the existing dependency graph makes that unavoidable and the reason is documented in the checkpoint evidence.
- Do not convert this mission into a behavior cleanup or bug-fix sweep; if a real behavior defect is discovered, document it and stop for scope confirmation unless it blocks the refactor from compiling.

## Stop Rules
- Stop if the extraction requires changing behavior in `startAgent()` beyond import rewiring and mechanical helper delegation in order to keep tests passing; that indicates the mission is turning into a bug-fix mission.
- Stop if callers outside the agent harness depend on private helper locations or evaluation order in a way that cannot be preserved through re-exporting from `lib/agents/agents.ts`.
- Stop if the repo requires manual edits to tracked generated JS or build artifacts in addition to the TypeScript source and that source-of-truth rule is not already documented.
- Stop if static-analysis failures appear in untouched `lib/` areas and cannot be cleanly attributed to the refactor; capture the failing command and ask for direction rather than widening scope.
