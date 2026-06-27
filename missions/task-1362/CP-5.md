# CP-5: Update AGENTS.md and docs/adr/0041-integration-pipeline-gates.md

## Work Done

Updated two documentation files to reflect the new static-analysis gate for `lib/` changes:

1. **`AGENTS.md`** — Added "Integration Gates" section documenting that `./scripts/verify-local.sh static-analysis` is a required integration gate for missions touching `lib/`, with reference to `config/integration-pipelines.json` and the `--no-integration-gates` opt-out.

2. **`docs/adr/0041-integration-pipeline-gates.md`** — Updated Deliverables item 1 to note that `config/integration-pipelines.json` now includes a `lib` entry mapping to `./scripts/verify-local.sh static-analysis` (added by task-1362).

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | AGENTS.md documents static-analysis gate for lib/ | `AGENTS.md:17-18` — "Integration Gates" section |
| 2 | ADR 0041 Deliverables reflects lib entry | `docs/adr/0041-integration-pipeline-gates.md:148` — includes "Task-1362 added a `lib` entry" |

## Next action
Run `npm test` — all tests must pass (CP-6).
