# CP-2: Apply scoped documentation edits

## Summary

All five scoped documents updated. Edits applied in commit `054e14007`.

### docs/use-cases.md — 18 lib/index.js refs stripped

- **UC-1 (E):** Removed `lib/commands/draft.js:133`, `:135`, `:138-139`. Retained `workflow.config.json` pattern, test refs, measured values, caveats.
- **UC-2 (E):** Removed `lib/agents/limit-hit.js:8-36`, `lib/agents/agents.js:382`, `:340-348`. Retained `test/agents-limit-hit.test.ts` refs.
- **UC-3 (E):** Removed all lib/ paths (`checkpoint.js`, `handoff.js`). Retained `test/handoff.test.ts`.
- **UC-5 (E):** Removed `lib/core/verification.js` paths. Retained `workflow.config.json`, `test/verification.test.ts`.
- **UC-6 (E):** Removed `lib/commands/stats.js` paths. Retained `test/stats.test.ts`, visualBoard retro refs.
- **UC-7 (E):** Entire (E) line was lib/ + index.js only. Replaced with test refs: `test/diff.test.ts`, `test/forgejo.test.ts`.
- **UC-9 (E):** Removed `lib/commands/draft.js`, `lib/core/mission-utils.js`. Retained `test/draft.test.ts`.
- **UC-10 (E):** Removed `lib/core/verification.js` paths. Retained `scripts/verify-local.sh`, `.eslintrc.cjs`, `workflow.config.json`, `test/verification.test.ts`. Removed `on \`lib/\`` from eslint description.
- **Red-team #4:** Removed `lib/core/verification.js:35` from shared mechanism citation.
- **Limitations:** Removed `lib/review/review-adapter.js:16`, `lib/commands/diff.js:113-116`, `lib/commands/draft.js:428`, `lib/core/verification.js:5-12`.
- **Ranking table:** Bare filenames (`limit-hit.js`, `review-commands.js`, `review-loop.js`) retained — no `lib/` prefix, not in scope.
- **Retained elements verified:** All capability descriptions, confidence levels (Confirmed/Partial/Aspirational), measured values (+57% to +107%, ~27/week), caveats, and red-team analysis intact.

### docs/authority-reference.md — 2 paths updated

- `lib/tools/backlog.js` → `src/adapters/backlog/backlog.ts` (§4.4)
- `lib/commands/draft.js` → `src/adapters/cli/commands/draft.ts` (§4.4)

### docs/real-agent-smoke.md — 4 paths updated

- `lib/agents/opencode.ts` → `src/adapters/agents/opencode.ts` (lines 6, 103)
- `lib/agents/opencode.ts`, `lib/agents/agents.ts` → `src/adapters/agents/opencode.ts`, `src/adapters/agents/agents.ts` (line 145)
- `lib/core/storage.ts` → `src/adapters/storage/storage.ts` (line 181)

### docs/doc-standards.md — 1 ref removed

- `lib/README.md` removed from §10 (no `src/README.md` exists)

### docs/adr/0049...md — 15 refs updated

- `lib/commands/coverage-gate.ts` → `src/adapters/verification/coverage-gate.ts`
- `index.js` + `lib/**/*.js` → `src/**/*.ts`
- `lib/` source files → `src/` source files (5 occurrences)
- `lib/core/mutation-scoper.ts` → `src/adapters/git/mutation-scoper.ts`
- Build paragraph: `lib/` (build:cjs) → `src/` (tsx direct execution)
- Correction note: `dist/`, `dist/index.js`, `dist/lib/**/*.js` → `build/px.mjs`
- `lib/commands/handoff.ts` → `src/adapters/cli/commands/handoff.ts`
- `lib/commands/integrate.ts` → `src/adapters/cli/commands/integrate.ts`
- Deliverables: mutation-scoper, mutation-gate, coverage-gate paths updated
- See Also: 3 lib/ paths updated to src/ equivalents

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| use-cases.md: no lib/ path, no index.js, no (E) to source path | `grep -n 'lib/\|index\.js' docs/use-cases.md` → 0 matches; capability descriptions, confidence levels, measured values, caveats, red-team analysis verified present | PASS |
| authority-reference.md: no lib/tools/backlog.js, lib/commands/draft.js | `docs/authority-reference.md` §4.4 cites `src/adapters/backlog/backlog.ts`, `src/adapters/cli/commands/draft.ts` | PASS |
| real-agent-smoke.md: no lib/agents/, no lib/core/ | `docs/real-agent-smoke.md` lines 6, 103, 145, 181 cite `src/adapters/agents/`, `src/adapters/storage/` | PASS |
| doc-standards.md: no lib/README.md | `docs/doc-standards.md` §10 lists `examples/README.md` only; `src/README.md` confirmed absent | PASS |
| ADR 0049: no lib/ or dist/ | `grep -n 'lib/\|dist/' docs/adr/0049-*.md` → 0 matches; `src/` and `build/px.mjs` replacements inline | PASS |
| Verification gate | `./scripts/verify-local.sh docs` | PENDING (CP-3) |
| graphify update | `graphify update .` | PENDING (CP-3) |

Next action: Run graphify update and documentation verifier (CP-3).
