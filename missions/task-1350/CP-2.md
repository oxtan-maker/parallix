# CP-2: AGENTS.md Updated with Documentation Enforcement Hook

## Goal Check

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `AGENTS.md` contains section titled "README & documentation standards" | PASS | `AGENTS.md:14` — `## README & documentation standards` |
| 2 | Section explicitly instructs agents to consult `docs/doc-standards.md` before editing `.md` files | PASS | `AGENTS.md:16` — "consult `docs/doc-standards.md` for the full documentation standard" |
| 3 | Section references the standard file path | PASS | `docs/doc-standards.md` referenced at `AGENTS.md:16` and throughout the summary rules |
| 4 | Checklist of rules to verify before committing documentation changes | PASS | `AGENTS.md:18-29` — 10 rule bullets covering headline, opening, quickstart, caveats, superlatives, "what it is not", structure, tone, links, subdirectory READMEs |
| 5 | Pre-commit checklist present | PASS | `AGENTS.md:31` — "(1) headline has no internal jargon, (2) quickstart is ≤3 commands, (3) all relative links resolve, (4) no unchecked superlatives, (5) "what it is not" section is current, (6) structural order matches §7" |
| 6 | AGENTS.md under 4000 characters | PASS | `wc -c` = 2507 characters |
| 7 | Existing graphify section preserved intact | PASS | `AGENTS.md:1-12` — original graphify section unchanged |

## Next action: Write CP-3 — audit README.md for accuracy against `workflow.config.json`, `package.json`, and `docs/use-cases.md`; correct all inaccuracies
