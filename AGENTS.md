# Repository instructions

## graphify

If `graphify-out/graph.json` exists, start codebase questions with `graphify query "<question>" --graph "$(pwd)/graphify-out/graph.json"`. Use `graphify path` for relationships and `graphify explain` for a focused concept, with the same `--graph` argument. Use `graphify-out/wiki/index.md` for broad navigation when present. Read `GRAPH_REPORT.md` only for architecture review or when a query is insufficient. If the graph is absent, say to run `/graphify .` to build it, then read source directly. Dirty graph output is usable. After code edits, run `graphify update .`.

## Documentation

Read `docs/doc-standards.md` before editing root or `docs/` Markdown. Update live documentation for changed user-facing behavior, constraints, or rationale; internal refactors usually need no doc change. Keep implementation inventories and test evidence out of live docs. After editing live docs, run `./scripts/verify-local.sh docs`.

## Git

Push mission branches only to `review` (Forgejo), never to `origin` (GitHub). Only `main` may be pushed to `origin`.

## Verification

- Before adding tests, trace changed public behavior to its owning suite and
  nearby assertions; extend that suite. Test discovery and the category registry
  own file membership; do not copy inventories into guidance. Task IDs belong in
  case names/comments, not suite names. Example: add `rejects invalid checkpoint
  evidence (TASK-2622.19)` to the existing checkpoint-validation suite.
- Create a cohesive, contract-named suite only when no owner exists; explain its
  boundary. Example: a new webhook-signature contract warrants its own suite.
  Reject numeric task-ID filenames for executable suites, case modules and
  helpers; preserve legitimate task-domain names and regression IDs in cases
  or comments. Do not force unrelated behaviors into giant suites.
- Use the narrowest tier proving the behavior (ADR 0057): `unit` for in-process
  tests with doubles and isolated state; adapter integration for real boundaries
  (`integration-ci` when a clean hosted runner supplies all dependencies,
  `integration-local` when a declared workstation dependency is required);
  `agent-e2e` for configured agent runners with reachable model backends.
  Keep integration membership and local dependency reasons in the category registry.
- Each case owns isolated fixtures and cleanup on success, assertion failure,
  timeout, signal, and child-process exit; later cases must not depend on them.
- Bug-labeled Missions require a focused reproduction: red on parent behavior,
  green with the fix, retained in the owning suite. Run focused contract checks
  before broader required checks; guidance-only changes require focused docs
  checks and `./scripts/verify-local.sh docs`.
- Preserve ports-and-adapters principles, dependency direction, typed application
  ports, composition authority, and adapter boundaries. Changes to these require
  stopping dependent implementation, presenting measured evidence, alternatives,
  behavioral risks, and a proposed decision to the user, then obtaining an explicit
  subsequent decision before implementation. This wave grants no exception.
- Code changes require `./scripts/verify-local.sh static-analysis`.
- Other than that, do not run full test gates when a focused test run is enough, parallix will run the complete test gates automatically at appropriate times.
- `px integrate` uses `adapters.gates.preIntegration` in `workflow.config.json` as its mandatory gate plan. `config/integration-pipelines.json` is for the standalone `./scripts/verify-local.sh integrate` script.
- `px integrate` skips re-running high-level integration hooks a mission already ran green: when a mission was bounced from the integration lane back to active and its fix was validated green by those tests, the next integrate run skips the already-validated hooks for the same commit, and falls back to the full suite when the branch has moved or no validation is recorded. The skip is a sha-keyed whitelist decided purely from the recorded validation, with no repo, branch, or mission special-casing.
- Retune CPU budgets only from current CPU profiles with explicit margin.
  Integration cases and suites, including hook contracts and their waited
  children, must retain finite CPU budgets. Wall deadlines remain hang bounds.
- Unit tests must finish within 500 ms alone; check with `npm test -- --unit-test-headroom`. Mock external boundaries and do not contact real Forgejo. Default `npm test` has a 1,000 ms per-test cap.
- Read ADR 0057 before choosing or changing test selection. Tiers: `unit`, `integration-ci`, `integration-local`, `agent-e2e`.
- Classify every new integration test in `test/lib/test-categories.ts`. Put it in the CI list, or in the local-only list with the missing GitHub-runner dependency named.
- Production source files under `src/` and `web/` must stay at or under 500 lines. `test/file-size-cap.test.ts` (default unit suite) fails for any non-exempt file over the cap; fix with a cohesive, senior-reviewable refactor, not a file split. Pre-existing over-cap files are named in the test's exception list — work entries down and remove them as the debt shrinks.
- Test source files must stay at or under 1,000 lines unless listed as pre-existing debt in `test/file-size-cap.test.ts`. Keep test files cohesive; group execution without merging files for speed.
