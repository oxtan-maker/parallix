# CP-4: Prompt and Template Wiring Complete

## Work Done

Added `## graphify` sections to all three agent templates and graphify-first instructions to all five workflow prompts.

### Templates Updated

**1. `templates/CLAUDE.md.template`** (added lines 16-26):
- Added `## graphify` section with all four directives from `always_on/claude-md.md`:
  - `graphify query "<question>"` when `graphify-out/graph.json` exists
  - `graphify path "<A>" "<B>"` for relationships
  - `graphify explain "<concept>"` for focused concepts
  - `graphify update .` after modifying code

**2. `templates/AGENTS.md.template`** (added lines 22-32):
- Added `## graphify` section with all directives from `always_on/agents-md.md`:
  - `/graphify` skill-tool trigger
  - `graphify query "<question>"` when `graphify-out/graph.json` exists
  - `graphify path "<A>" "<B>"` for relationships
  - `graphify explain "<concept>"` for focused concepts
  - Dirty graph tolerance rule
  - `graphify update .` after modifying code

**3. `templates/CODEX.md.template`** (added lines 26-36):
- Added `## graphify` section matching `always_on/agents-md.md` directives:
  - `/graphify` skill-tool trigger
  - `graphify query`, `graphify path`, `graphify explain` directives
  - Dirty graph tolerance rule
  - `graphify update .` after modifying code

### Repo-Local Always-On Files Generated (review F1 fix)

**4. `CLAUDE.md`** (new, repo root):
- Generated from `always_on/claude-md.md` content (verbatim match).
- Surfaces Graphify guidance to Claude agents at the repo root level.

**5. `AGENTS.md`** (new, repo root):
- Generated from `always_on/agents-md.md` content (verbatim match).
- Surfaces Graphify guidance to Codex and OpenCode agents at the repo root level.

### Prompts Updated

**6. `prompts/draft.md`** (added line 15):
- Graphify-first instruction: check `graphify-out/graph.json`, run `graphify query` for mission scope, run `graphify update .` after code changes.

**7. `prompts/execute.md`** (added line 21):
- Comprehensive graphify-first instruction covering `graphify query`, `graphify path`, `graphify explain`, `GRAPH_REPORT.md`, `graphify-out/wiki/index.md`, and `graphify update .`.

**8. `prompts/review.md`** (added line 16):
- Graphify-first instruction: run `graphify query "review {{slug}}"` for graph-based scope view before examining diff.

**9. `prompts/act-on-review.md`** (added line 19):
- Graphify-first instruction: use `graphify query` and `graphify path` to understand affected code areas, run `graphify update .` after changes.

**10. `prompts/portfolio.md`** (added line 28):
- Graphify-first instruction: use `graphify query` to understand architecture and completed-task patterns before proposing missions.

### Regression Test Added (review F2 fix)

**11. `test/codex.test.js`** (added test at line 102):
- `headlessCodexConfig includes multi_agent = true for Graphify subagent support` — asserts `[features]` and `multi_agent = true` are present in config output.

### Files NOT Modified (as required)

- `templates/MISTRAL.md.template` — left unchanged, Mistral is out of scope.
- Graphify upstream files — not modified.
- Backlog task file — preserved with original labels intact.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| SC1: `headlessCodexConfig()` returns `[features]` with `multi_agent = true` | `lib/agents/codex.js:163-164` — Gate command passed | PASS |
| SC2: Contract decision document exists with upstream citations | `MISSION.md:65-78` — "official always-on" with citations to `skill-codex.md:233`, `skill-opencode.md:232`, `always_on/claude-md.md`, `always_on/agents-md.md` | PASS |
| SC3: `CLAUDE.md.template` has `## graphify` with `graphify query` and `graphify update` | `templates/CLAUDE.md.template:17-26` — `graphify query` at line 20, `graphify update` at line 25. Gate 3: `grep -q "graphify" templates/CLAUDE.md.template` PASS | PASS |
| SC4: `AGENTS.md.template` has `## graphify` with `graphify query` | `templates/AGENTS.md.template:23-32` — `graphify query` at line 27. Gate 4: `grep -q "graphify" templates/AGENTS.md.template` PASS | PASS |
| SC5: All five workflow prompts contain graphify references | `prompts/draft.md:15`, `prompts/execute.md:21`, `prompts/review.md:16`, `prompts/act-on-review.md:19`, `prompts/portfolio.md:28`. Gate 2: count=5 PASS | PASS |
| SC6: `MISTRAL.md.template` unchanged (no graphify) | `templates/MISTRAL.md.template` — 0 graphify references (confirmed by grep returning exit code 1) | PASS |
| SC7: Backlog task file exists with labels | `backlog/tasks/task-1330 - Make-Graphify-actually-work-automatically-across-parallix-agents-and-workflow-prompts.md` — labels include `ai_sdlc`, `bug`, `prompt`. Gate 5: file exists PASS | PASS |
| F1-fix: Repo-local `CLAUDE.md` and `AGENTS.md` generated | `CLAUDE.md` (repo root, 9 lines matching `always_on/claude-md.md`), `AGENTS.md` (repo root, 12 lines matching `always_on/agents-md.md`) | FIXED |
| F2-fix: Regression test for `multi_agent = true` | `test/codex.test.js:102-107` — `headlessCodexConfig includes multi_agent = true` test asserts `[features]` and `multi_agent = true`. Test suite: 1572 pass / 0 fail | FIXED |

## Gate Verification

| Gate | Command | Result |
|------|---------|--------|
| Gate 1 | `grep -q "multi_agent = true" <(node -e "const c = require('./lib/agents/codex.js'); console.log(c.headlessCodexConfig('/fake'));")` | PASS |
| Gate 2 | `grep -rl "graphify" prompts/draft.md prompts/execute.md prompts/review.md prompts/act-on-review.md prompts/portfolio.md \| wc -l` → 5 | PASS |
| Gate 3 | `grep -q "graphify" templates/CLAUDE.md.template` | PASS |
| Gate 4 | `grep -q "graphify" templates/AGENTS.md.template` | PASS |
| Gate 5 | `test -f "backlog/tasks/task-1330 - Make-Graphify-actually-work-automatically-across-parallix-agents-and-workflow-prompts.md"` | PASS |

## Next action

All checkpoints complete. Both review findings (F1, F2) fixed. All gates pass. Ready for handoff to review.
