# CP-3: Contract Decision Made and Documented

## Work Done

Added a "Contract Decision" section to `MISSION.md` (inserted before Checkpoints section, lines 62+). The decision is **official always-on** integration for all supported agent families.

## Decision

**Choice**: official always-on

**Rationale** (four points documented in MISSION.md):

1. **Upstream support is universal**: Graphify provides official always-on files for all three platforms. Source evidence:
   - `skill-codex.md:233` — Codex support with `multi_agent = true` requirement
   - `skill-opencode.md:232` — OpenCode support with `@mention` dispatch
   - `always_on/claude-md.md` — Claude always-on guidance (9 lines)
   - `always_on/agents-md.md` — Agents/Code always-on guidance (12 lines)

2. **Official install commands exist**: `graphify claude install`, `graphify codex install`, `graphify opencode install` — confirmed by upstream skill docs.

3. **Hybrid adds complexity**: Prompt-based or hybrid would duplicate always-on rules. Templates achieve the same outcome without modifying upstream files.

4. **Precedence rule**: Always-on guidance in templates takes priority. Fast path when `graphify-out/graph.json` exists; full pipeline otherwise.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| SC2: Contract decision document exists naming one of "official always-on", "prompt-based", or "hybrid" with upstream source citation | `MISSION.md:65-78` — "Choice: official always-on" with citations to `skill-codex.md:233`, `skill-opencode.md:232`, `always_on/claude-md.md`, `always_on/agents-md.md` | PASS |

## Next action

Proceed to CP-4: Wire Graphify into all five workflow prompts and three agent templates.
