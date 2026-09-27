# Repository instructions

## graphify

If `graphify-out/graph.json` exists, start codebase questions with `graphify query "<question>" --graph "$(pwd)/graphify-out/graph.json"`. Use `graphify path` for relationships and `graphify explain` for a focused concept, with the same `--graph` argument. Use `graphify-out/wiki/index.md` for broad navigation when present. Read `GRAPH_REPORT.md` only for architecture review or when a query is insufficient. If the graph is absent, say to run `/graphify .` to build it, then read source directly. Dirty graph output is usable. After code edits, run `graphify update .`.

## Documentation

Read `docs/doc-standards.md` before editing root or `docs/` Markdown. Update live documentation for changed user-facing behavior, constraints, or rationale; internal refactors usually need no doc change. Keep implementation inventories and test evidence out of live docs. After editing live docs, run `./scripts/verify-local.sh docs`.

## Git

Push mission branches only to `review` (Forgejo), never to `origin` (GitHub). Only `main` may be pushed to `origin`.

## Verification

- Code changes require `./scripts/verify-local.sh static-analysis`.
- Other than that, do not run full test gates when a focused test run is enough, parallix will run the complete test gates automatically at appropriate times.
- `px integrate` uses `adapters.gates.preIntegration` in `workflow.config.json` as its mandatory gate plan. `config/integration-pipelines.json` is for the standalone `./scripts/verify-local.sh integrate` script.
- Unit tests must finish within 500 ms alone; check with `npm test -- --unit-test-headroom`. Mock external boundaries and do not contact real Forgejo. Default `npm test` has a 1,000 ms per-test cap.
- Read ADR 0059 before changing test selection. Tiers: `unit`, `integration-ci`, `integration-local`, `agent-e2e`.
- Classify every new integration test in `test/lib/test-categories.ts`. Put it in the CI list, or in the local-only list with the missing GitHub-runner dependency named.
- Production source files under `src/` and `web/` must stay at or under 500 lines. `test/file-size-cap.test.ts` (default unit suite) fails for any non-exempt file over the cap; fix with a cohesive, senior-reviewable refactor, not a file split. Pre-existing over-cap files are named in the test's exception list — work entries down and remove them as the debt shrinks.

