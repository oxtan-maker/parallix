# CP-1: Documentation Standard Drafted

## Goal Check

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `docs/doc-standards.md` exists with ≥8 distinct rule-level guidelines | PASS | `docs/doc-standards.md:1-92` — 10 sections covering: (1) headline/tagline (line 8), (2) opening paragraph (line 18), (3) quickstart depth (line 28), (4) caveats/honesty (line 36), (5) superlative prohibition (line 44), (6) "what it is not" section (line 52), (7) structural ordering (line 60), (8) tone/voice (line 74), (9) link hygiene (line 82), (10) subdirectory READMEs (line 88) |
| 2 | Covers headline/tagline structure | PASS | `docs/doc-standards.md:8-16` — one-line capability statement, zero internal jargon, audience/context naming |
| 3 | Covers opening paragraph requirements | PASS | `docs/doc-standards.md:18-24` — problem-first or contrast-first, 2-4 sentences, surprising defaults early |
| 4 | Covers quickstart depth | PASS | `docs/doc-standards.md:28-34` — 2-3 commands, shallow path to value, fenced code block |
| 5 | Covers caveat placement | PASS | `docs/doc-standards.md:36-42` — caveats as trust signals, alpha status in visible section, quantitative claims with sources |
| 6 | Covers superlative prohibition | PASS | `docs/doc-standards.md:44-50` — no superlatives without adoption data, falsifiability requirement |
| 7 | Covers "what it is not" section | PASS | `docs/doc-standards.md:52-58` — required section after use cases, pre-empt top 3 objections |
| 8 | Covers structural ordering | PASS | `docs/doc-standards.md:60-72` — 14-item canonical order for README.md |
| 9 | Covers tone/voice guidance | PASS | `docs/doc-standards.md:74-80` — plain, anti-hype, engineer-to-engineer, active voice, evidence ties |
| 10 | Under 10,000 characters | PASS | `wc -c` = 4953 characters |

## Next action: Write CP-2 — update AGENTS.md with documentation enforcement hook referencing `docs/doc-standards.md`
