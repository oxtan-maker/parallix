# Composition

**This directory builds the production object graph for the CLI, TUI, mission services, and review persistence.**

Composition is the only production layer allowed to import both application
capabilities and concrete adapters. It binds dependencies and owns their
lifecycle; workflow policy remains in domain or application modules.

## What this directory is not

It is not an inbound interface, an outbound adapter, or an alternate runtime.
