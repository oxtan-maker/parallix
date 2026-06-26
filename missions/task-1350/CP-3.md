# CP-3: README.md Audited for Accuracy

## Goal Check

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | "Current status" — Distribution claim accurate | PASS | README.md:177 says `@magnusekdahl/parallix` + local tarball; `package.json:2` confirms name, `package.json:14-16` confirms public access, no Homebrew/Docker/binaries in repo |
| 2 | "Current status" — Review surface claim accurate | PASS | README.md:178 says Forgejo as PR viewer/publication surface; `workflow.config.json:15` confirms `"provider": "forgejo"` with baseUrl, remote, repo |
| 3 | "Current status" — Versioning claim accurate | PASS | README.md:179 says PATCH bumps, CHANGELOG.md authority; `CHANGELOG.md:6-30` documents PATCH bump policy, `CHANGELOG.md:29-30` confirms PATCH discipline |
| 4 | "Current status" — Telemetry claim accurate | PASS | README.md:180 says structured telemetry for codex/claude, zeros for local-custom/mistral; `lib/agents/codex-telemetry.js`, `lib/agents/claude-telemetry.js` exist with parsers; `lib/agents/mistral-telemetry.js:24` returns null by design |
| 5 | "Current status" — Graphify claim accurate | PASS | README.md:181 says optional, not prerequisite; confirmed in code (graphify skipped when not installed) and `AGENTS.md:1-12` (graphify is advisory) |
| 6 | All relative links resolve | PASS | Verified: `docs/use-cases.md`, `docs/authority-reference.md`, `docs/forgejo-setup.md`, `docs/operator-setup.md`, `docs/readme-rewrite-benchmark.md`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, `docs/adr/` — all exist |
| 7 | README.md structural ordering matches doc-standards.md §7 | PASS | H1+headline (1-3), quickstart (9-17), Why (21), What it does (32), Workflow (45), Example (106), Use cases (158), What it is not (166), Current status (173), Documentation (186), Development (196), License (208) |
| 8 | No inaccuracies requiring correction | PASS | All claims verified against `workflow.config.json`, `package.json`, `docs/use-cases.md`, and source code — no corrections needed |

## Next action: Write CP-4 — update subdirectory READMEs (`examples/README.md`, `lib/README.md`) to conform to the standard
