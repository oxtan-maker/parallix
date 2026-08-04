# Inbound interfaces

**This directory translates CLI and TUI input into application requests and renders results.**

Interfaces depend on application contracts and domain values. Production
command registries and concrete adapter selection are injected by
`src/composition/`.

## What this directory is not

It is not a composition root and does not select SQLite, Git, agent, Backlog,
Forgejo, or filesystem implementations.
