# Outbound adapters

**This directory contains concrete integrations with filesystems, Git, agent processes, review providers, Backlog data, packaged assets, and SQLite.**

Adapters implement application-owned ports or provide concrete mechanisms used
by composition. They may depend on `src/application/`, `src/domain/`, and other
adapter-local modules. They must never import `src/interfaces/`,
`src/composition/`, or `src/entry/`.

## Layout

| Directory | Responsibility |
|---|---|
| `agents/` | Agent configuration, launchers, telemetry, and availability |
| `assets/` | Packaged runtime assets |
| `backlog/` | Backlog task and board readers |
| `cli/` | Concrete command mechanisms bound by CLI composition |
| `config/` | Product and state-map configuration |
| `filesystem/`, `git/`, `process/` | Host operating-system mechanisms |
| `forgejo/`, `review/` | Review-provider and review persistence mechanisms |
| `mission/` | Mission execution port implementations |
| `sqlite/`, `storage/` | Durable operator-state implementations |
| `verification/` | Verification and mutation/coverage gate mechanisms |

## What this directory is not

Most modules in this directory are outbound mechanisms, but `cli/commands/`
still contains legacy command implementations that combine request handling,
rendering, and workflow sequencing with concrete integrations. Those modules
describe the current tree; they do not demonstrate a completed application
boundary. New sequencing belongs in application use cases, request translation
and rendering belong in `src/interfaces/`, and concrete object assembly belongs
in `src/composition/`.
