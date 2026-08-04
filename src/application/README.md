# Application layer

**This directory owns Parallix use cases, orchestration, projections, and dependency contracts.**

Application code depends only on `src/domain/` and application-local modules.
Outbound dependencies are declared under `ports/` or in the checked shared port
modules; concrete implementations live under `src/adapters/`.

## What this directory is not

It is not a database, CLI, filesystem, Git, process, or provider layer. The
complete dependency rule is executable in `test/dependency-graph.test.ts`.
