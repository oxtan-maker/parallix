# Inbound interfaces

**This directory translates CLI and TUI input into application requests and renders results.**

Interfaces depend on application contracts and domain values. Production
command registries and concrete adapter selection are injected by
`src/composition/`. This is the inbound-transport boundary defined by
[ADR 0051](../../docs/adr/0051-ui-neutral-application-boundary.md).

## What this directory is not

It is not a composition root and does not select SQLite, Git, agent, Backlog,
Forgejo, or filesystem implementations.
