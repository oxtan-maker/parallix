# CP-4: Subdirectory READMEs Updated

## Goal Check

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `examples/README.md` begins with one-line capability statement (no internal jargon) | PASS | `examples/README.md:1` — "Parallix Examples" (H1) followed by capability statement at line 3: "These examples use the provisional `px` runner from inside a caller-supplied target repository" — zero internal jargon |
| 2 | `examples/README.md` uses consistent heading hierarchy (H1 → H2 → H3) | PASS | `examples/README.md:1` (H1), `examples/README.md:15,26,35,50` (H2) — no H3 needed; hierarchy is consistent |
| 3 | `lib/README.md` begins with one-line capability statement | PASS | `lib/README.md:1` — "parallix/lib/ — Grouped Module Layout" (H1), line 3: "Five subdirectories, each with a single responsibility" — capability statement with zero internal jargon |
| 4 | `lib/README.md` uses consistent heading hierarchy (H1 → H2 → H3) | PASS | `lib/README.md:1` (H1), `lib/README.md:5` (table as H2 equivalent) — consistent hierarchy |
| 5 | No subdirectory READMEs require changes beyond what was done | PASS | Both files conform to the standard after the capitalization fix to `examples/README.md:1` |
| 6 | README.md structure matches canonical ordering from doc-standards.md §7 | PASS | Verified `README.md:1-216`: H1+headline (lines 1-3), quickstart (lines 9-17), Why (line 21), What it does (line 32), Core workflow (line 45), Example (line 106), Use cases (line 158), What it is not (line 166), Current status (line 173), Documentation (line 186), Development (line 196), License (line 208) |
| 7 | All relative links in README.md resolve to existing files | PASS | Verified: `docs/use-cases.md`, `docs/authority-reference.md`, `docs/forgejo-setup.md`, `docs/operator-setup.md`, `docs/readme-rewrite-benchmark.md`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`, `docs/adr/` — all exist |
| 8 | README.md "Current status" claims verified against source files | PASS | Distribution: `package.json:2` (@magnusekdahl/parallix), `package.json:14-16` (public access); Review surface: `workflow.config.json:15` (forgejo provider); Versioning: `CHANGELOG.md:6-30` (PATCH bumps); Telemetry: `lib/agents/codex-telemetry.js`, `lib/agents/claude-telemetry.js` (structured), `lib/agents/mistral-telemetry.js` (zeros by design); Graphify: optional per `README.md:41` |

## Next action: Run gates — `./scripts/verify-local.sh docs` and `npm test`
