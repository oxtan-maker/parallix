## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

Before editing any `.md` file in the repo root or `docs/` directory, consult `docs/doc-standards.md` for the full standard.

## Integration Gates

Static-analysis (`./scripts/verify-local.sh static-analysis`: ESLint + tsc --checkJs + test-hygiene) is a required integration gate for any mission that modifies files under `lib/`. The gate configuration lives in `config/integration-pipelines.json` and is enforced by `px integrate` before the squash-merge step. Missions touching `lib/` cannot merge while the static-analysis gate fails. Use `--no-integration-gates` to opt out in emergencies.

This repo routes verification through `./scripts/verify-local.sh {{area}}`. Earlier phases use the fast general verifier (`all`), while `integrate` resolves the stricter pre-merge gate plan from `config/integration-pipelines.json`. The standalone workflow E2E suite is part of that integration-only layer via the `workflow` gate.
