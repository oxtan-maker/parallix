# CP-1: Inventory of scoped stale references

## Summary

Read all five scoped documents. Recorded exact stale `lib/`, `dist/`, and `index.js` references and their intended disposition.

### docs/use-cases.md (18 lib/index.js refs)

| Location | Stale Reference | Disposition |
|---|---|---|
| UC-1 (E) | `lib/commands/draft.js:133`, `:135`, `:138-139` | Remove |
| UC-2 (E) | `lib/agents/limit-hit.js:8-36`, `lib/agents/agents.js:382`, `:340-348` | Remove |
| UC-3 (E) | `lib/commands/checkpoint.js:41-47`, `:56-58`, `:67`, `lib/commands/handoff.js:92-102` | Remove all |
| UC-5 (E) | `lib/core/verification.js:5-11`, `:25-31`, `:34` | Remove |
| UC-6 (E) | `lib/commands/stats.js:14`, `:21-30` | Remove |
| UC-7 (E) | `index.js:39`, `:158`, `:224`, `lib/commands/diff.js:*`, `lib/tools/forgejo.js:*`, `lib/review/review-adapter.js:*` | Remove all (entire (E) line is lib/index.js) |
| UC-9 (E) | `lib/commands/draft.js:173-188`, `:223`, `:411-430`, `:439-468`, `lib/core/mission-utils.js:67-99` | Remove |
| UC-10 (E) | `lib/core/verification.js:5-12`, `:26-32`, `:35` | Remove |
| Red-team #4 | `lib/core/verification.js:35` | Remove |
| Limitations UC-7 | `lib/review/review-adapter.js:16`, `lib/commands/diff.js:113-116` | Remove |
| Limitations UC-9 | `lib/commands/draft.js:428` | Remove |
| Limitations UC-10 | `lib/core/verification.js:5-12` | Remove |
| UC-10 (E) gate desc | `on \`lib/\`` (eslint target) | Remove lib/ from description |

**Retained per scope:** Test file refs (`test/draft.test.ts`, etc.), `workflow.config.json` refs, visualBoard paths, capability descriptions, confidence levels, measured values, caveats, red-team analysis. Ranking table bare filenames (`limit-hit.js`, `review-commands.js`, `review-loop.js`) retained — they lack `lib/` prefix.

### docs/authority-reference.md (2 refs)

| Location | Stale | Replacement | Verified |
|---|---|---|---|
| §4.4 | `lib/tools/backlog.js` | `src/adapters/backlog/backlog.ts` | `src/adapters/backlog/backlog.ts` exists |
| §4.4 | `lib/commands/draft.js` | `src/adapters/cli/commands/draft.ts` | `src/adapters/cli/commands/draft.ts` exists |

### docs/real-agent-smoke.md (4 refs)

| Location | Stale | Replacement | Verified |
|---|---|---|---|
| Line 6 | `lib/agents/opencode.ts` | `src/adapters/agents/opencode.ts` | Exists |
| Line 103 | `lib/agents/opencode.ts` | `src/adapters/agents/opencode.ts` | Exists |
| Line 145 | `lib/agents/opencode.ts`, `lib/agents/agents.ts` | `src/adapters/agents/opencode.ts`, `src/adapters/agents/agents.ts` | Both exist |
| Line 181 | `lib/core/storage.ts` | `src/adapters/storage/storage.ts` | Exists |

### docs/doc-standards.md (1 ref)

| Location | Stale | Disposition | Verified |
|---|---|---|---|
| §10 | `lib/README.md` | Remove (no `src/README.md` exists) | Confirmed `src/README.md` absent |

### docs/adr/0049...md (15 refs)

| Location | Stale | Replacement |
|---|---|---|
| Context | `lib/commands/coverage-gate.ts` | `src/adapters/verification/coverage-gate.ts` |
| Context | `index.js` + `lib/**/*.js` | `src/**/*.ts` |
| Context scope | `lib/` source files | `src/` source files |
| Options table | `lib/` files | `src/` files |
| Option A | `lib/` tree | `src/` tree |
| Option A | `lib/` files | `src/` files |
| Design §1 | `lib/core/mutation-scoper.ts` | `src/adapters/git/mutation-scoper.ts` |
| Design §1 (build) | `lib/` (build:cjs paragraph) | `src/` (tsx direct) |
| Design §1 (correction) | `dist/`, `dist/index.js`, `dist/lib/**/*.js` | `build/px.mjs` |
| Design §3 | `lib/` tree | `src/` tree |
| Design §3 | `lib/` files | `src/` files |
| Limitations | `lib/commands/handoff.ts` | `src/adapters/cli/commands/handoff.ts` |
| Limitations | `lib/commands/integrate.ts` | `src/adapters/cli/commands/integrate.ts` |
| Deliverables | `lib/core/mutation-scoper.ts`, `lib/commands/mutation-gate.ts` | `src/adapters/git/mutation-scoper.ts`, `src/adapters/verification/mutation-gate.ts` |
| See Also | `lib/commands/coverage-gate.ts`, `lib/core/mutation-scoper.ts`, `lib/commands/mutation-gate.ts` | `src/` equivalents |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| use-cases.md: no lib/ path, no index.js, no (E) to source path | Inventory: 18 lib/index.js refs across 10 locations; all marked for removal | INVENTORY DONE |
| authority-reference.md: no lib/tools/backlog.js, no lib/commands/draft.js | `src/adapters/backlog/backlog.ts`, `src/adapters/cli/commands/draft.ts` verified | INVENTORY DONE |
| real-agent-smoke.md: no lib/agents/, no lib/core/ | `src/adapters/agents/`, `src/adapters/storage/` verified | INVENTORY DONE |
| doc-standards.md: no lib/README.md | `src/README.md` confirmed absent; removal planned | INVENTORY DONE |
| ADR 0049: no lib/ or dist/ | 15 refs inventoried, src/ and build/px.mjs replacements verified | INVENTORY DONE |
| Verification gate | `./scripts/verify-local.sh docs` | PENDING (CP-3) |
| graphify update | `graphify update .` | PENDING (CP-3) |

Next action: Execute edits for all five scoped documents (CP-2).
