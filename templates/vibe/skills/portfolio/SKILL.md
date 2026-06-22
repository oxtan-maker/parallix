---
name: portfolio
description: Use when the user explicitly asks for the parallix portfolio workflow, including `/portfolio` invocations. This is a thin launcher only; load and follow AGENTS.md, parallix/README.md, and docs/agent-prompts/portfolio.md rather than inventing a parallel workflow.
user-invocable: true
---

# Portfolio

This skill is a thin entrypoint for the parallix portfolio workflow.

Load and follow:
1. `AGENTS.md`
2. `parallix/README.md`
3. `docs/agent-prompts/portfolio.md`

Authority:
- `AGENTS.md` owns hard rules and workflow boundaries.
- `parallix/README.md` owns workflow modes and prompt mapping.
- `docs/agent-prompts/portfolio.md` owns the portfolio execution prompt.

Do not treat this skill as a second workflow authority. It exists only to shorten invocation in Vibe.
