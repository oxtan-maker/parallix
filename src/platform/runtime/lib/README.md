# parallix/lib/ — Grouped Module Layout

Five subdirectories, each with a single responsibility. No flat `.js` files at the lib root (only `index.js` for backward compatibility).

| Directory | Responsibility |
|-----------|----------------|
| `agents/` | AI agent launchers, session management, and rate-limit detection |
| `commands/` | Workflow command handlers — each file is a `node parallix <cmd>` entry point |
| `core/` | Shared infrastructure with no command-handler imports (pure utilities) |
| `review/` | Review subsystem: artifacts, commands, loop, polling, prompts, state |
| `tools/` | External integrations and supporting workflow libraries |

See `LAYOUT_DECISION.md` in the mission directory for the full dependency graph analysis and rationale.
