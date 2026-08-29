## graphify

This project has a knowledge graph at `$(pwd)/graphify-out/` with god nodes, community structure, and cross-file relationships. All graphify commands below use `$(pwd)/graphify-out/graph.json` to anchor to the active worktree and avoid resolving to a sibling worktree's graph.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>" --graph "$(pwd)/graphify-out/graph.json"` when `$(pwd)/graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>" --graph "$(pwd)/graphify-out/graph.json"` for relationships and `graphify explain "<concept>" --graph "$(pwd)/graphify-out/graph.json"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- When `$(pwd)/graphify-out/graph.json` is absent, do not run graphify query/path/explain. Instead signal that the graph has not been built yet (e.g. "graphify-out/graph.json not found in this worktree — run `/graphify .` to build it first") and fall back to reading source files directly.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If `$(pwd)/graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source browsing.
- Read `$(pwd)/graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

Before editing any `.md` file in the repo root or `docs/` directory, consult `docs/doc-standards.md` for the full standard.

## Documentation

Authored documentation has one job: explain durable user-facing concepts,
architectural invariants, supported behavior, limitations, and rationale. Do
not reproduce volatile implementation facts such as source paths, line-number
evidence, test inventories, or copied command/configuration inventories.
Executable facts remain owned by commands, schemas, configuration, source, and
tests. Checkpoint documents may cite exact evidence for a completed mission;
that evidence must not become live documentation.

An internal refactor with unchanged behavior and invariants normally has no
documentation impact. Update authored documentation when user-visible meaning,
supported behavior, constraints, or rationale changes. Run
`./scripts/verify-local.sh docs` after editing live authored documentation.

## Local-only development

Mission branches must never be pushed to the `origin` (GitHub) remote. Only the `main` branch may be pushed to `origin`. The `review` (Forgejo) remote is the sole push target for code review on mission branches. The `px checkpoint` command stages and commits locally without pushing to `origin`. A `pre-push` hook (`.git/hooks/pre-push`) provides local enforcement — any attempt to `git push origin <non-main-branch>` will be rejected on machines where the hook is installed. The hook is local-only metadata (not tracked in git), so instruction-based enforcement via this AGENTS.md section is the team-wide mechanism for all clones.

## Integration Gates

Static-analysis (`./scripts/verify-local.sh static-analysis`: ESLint + tsc --checkJs + test-hygiene) is a required integration gate for any mission that modifies code files.

This repo routes verification through `./scripts/verify-local.sh {{area}}`. Earlier phases use the fast general verifier (`all`), while `integrate` resolves the stricter pre-merge gate plan from `config/integration-pipelines.json`. The standalone workflow E2E suite is part of that integration-only layer via the `workflow` gate.

## unit tests
Unit tests must finish within 500 ms when run alone; use `npm test -- --unit-test-headroom` to enforce and diagnose that authoring target. Default `npm test` retains its 1,000 ms per-test hard cap. Unit tests must mock external boundaries and never access real Forgejo; avoid missing mocks that launch expensive CLI commands or agents.
