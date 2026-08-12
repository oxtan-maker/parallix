# Outbound adapters

**This directory contains concrete integrations with filesystems, Git, agent processes, review providers, Backlog data, packaged assets, and SQLite.**

Adapters implement application-owned ports or provide concrete mechanisms used
by composition. The guards in `src/adapters/architecture/boundary-guards.ts`
classify every production module by location and then check four specific
things, listed in full under "Enforced rules" below: that the module sits in a
canonical root, that each cross-adapter import matches a named package rule,
that it resolves no collaborator by dynamic key lookup, and that it does not
assemble the complete object graph. Those four bite regardless of where a module
is moved or renamed to.

They are not a general test of whether a module owns another layer's
responsibility. In particular, **an adapter that sequences a multi-integration
workflow — an application responsibility — is not caught by any of them**; see
"Known outstanding debt" below.

## The layer DAG

Six responsibilities own the production tree, one canonical root each. The
layer table `layerRoots` in `src/adapters/architecture/boundary-guards.ts` is the
single classification source — responsibility and layer are the same concept, and
there is no second table:

| Responsibility | Root | Owns |
|---|---|---|
| `domain` | `src/domain` | Business rules and value types, no I/O |
| `application` | `src/application` | Use cases, workflow sequencing, and the ports adapters implement |
| `adapters` | `src/adapters` | One concrete mechanism per module: filesystem, Git, agents, review providers, Backlog, assets, SQLite |
| `interfaces` | `src/interfaces` | Request translation and rendering (CLI parsing, TUI) |
| `composition` | `src/composition` | Object-graph assembly; the only place the complete graph is built |
| `entry` | `src/entry` | Process entry points |

Permitted edges (`allowedDependencyGraph` in
`src/adapters/architecture/boundary-guards.ts`) form a DAG:

```
entry        → composition, interfaces
composition  → domain, application, adapters, interfaces, composition
interfaces   → domain, application, interfaces
adapters     → domain, application            (no adapters self-edge)
application  → domain, application
domain       → domain
```

Adapters must never import `src/interfaces/`, `src/composition/`, or
`src/entry/`.

## Cross-adapter dependency constraints

There is **no blanket adapters-to-adapters permission**. `allowedDependencyGraph.adapters`
deliberately omits an `adapters` self-edge, because a blanket permission lets any
adapter reach any other and is what allows a relabeled monolith to pass on
directory placement alone.

Every cross-adapter edge must instead match a **named package-level rule** in
`adapterPackageDependencies` (`src/adapters/architecture/boundary-guards.ts`),
which lists each package directly beneath `src/adapters/` and the exhaustive set
of siblings it may import. The table has no wildcard entry and no per-file
exception, and the guard enumerates `src/adapters/` at run time, so a new
package cannot be added without declaring its dependencies.

An adapter that needs behaviour it may not import directly depends on an
**application-owned port** under `src/application/ports/` instead; composition
supplies the implementation. The failure diagnostic names that remedy directly.

Naming an edge satisfies the dependency rule but does not grant workflow
ownership. Workflow sequencing across several integrations remains an
application responsibility — but no guard currently enforces that, so an adapter
module that sequences one is caught only in review. See "Known outstanding debt"
below.

## Layout

| Directory | Responsibility |
|---|---|
| `agents/` | Agent configuration, launchers, telemetry, and availability |
| `architecture/` | The executable responsibility-ownership guards themselves |
| `assets/` | Packaged runtime assets |
| `backlog/` | Backlog task and board readers |
| `cli/` | Concrete command mechanisms bound by CLI composition |
| `config/` | Product and state-map configuration |
| `filesystem/`, `git/`, `process/` | Host operating-system mechanisms |
| `forgejo/`, `review/` | Review-provider and review persistence mechanisms |
| `mission/` | Mission execution port implementations |
| `rebase/` | Rebase workflow mechanisms |
| `sqlite/`, `storage/` | Durable operator-state implementations |
| `verification/` | Verification and mutation/coverage gate mechanisms |

## Enforced rules and the fixtures that prove they bite

Each rule below is exercised by a hermetic fixture in
`test/dependency-graph.test.ts` that builds a temporary tree with
`fs.mkdtempSync`. Every fixture has been mutation-checked: disabling the rule
turns that fixture red.

| Rule | What fails | Fixture that proves it |
|---|---|---|
| `unclassified-production-module` | A module under `src/` outside all six roots, including one loose at the `src/` root | `"responsibility scan reports a new unclassified production module with its path and expected owner"`, `"responsibility scan reports a loose module at the src root as unclassified"` |
| `cross-adapter-dependency-not-named` | An import between adapter packages with no named rule | `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"`, `"cross-adapter rules name every adapter package and grant no wildcard"` |
| `hidden-service-location` | Resolving collaborators by dynamic key lookup | `"responsibility guard fails hidden service location in an adapter module"` |
| `complete-graph-outside-composition` | Building the complete object graph outside `src/composition/application-services.ts` | `"responsibility guard fails complete-graph construction outside the composition root"` |

Every diagnostic names the offending file, the failed rule, and the expected
owner, for example:

```
src/adapters/alpha/source.ts: rule cross-adapter-dependency-not-named failed —
imports "../beta/target.js" (src/adapters/beta/target.ts) but package "alpha" declares
no named dependency on "beta"; route it through an application-owned port under
src/application/ports/; expected owner: application, actual owner: adapters
```

The guards run under the static-analysis workflow and use only `node:fs` and
`node:path`. They reach no network service, Forgejo instance, agent, or CLI
process; run them with `npm test -- test/dependency-graph.test.ts`.

## Known outstanding debt

**Multi-integration workflow sequencing under `src/adapters/` is unguarded.**
`src/adapters/cli/commands/` still contains legacy command implementations that
combine request handling, rendering, and workflow sequencing with concrete
integrations — `src/adapters/cli/commands/integrate.ts` and
`src/adapters/cli/commands/handoff.ts` each wire 9 sibling packages — and several
mechanism packages (`git`, `forgejo`, `verification`, `agents`) wire three or
more siblings too. Nothing in CI fails on any of this. The list of enforced rules
above is exhaustive: it is what the tree is actually protected against, and this
axis is not on it.

A rule did exist. It flagged any adapter module importing three or more distinct
sibling packages, and it was retired rather than repaired, because **a fan-out
count cannot distinguish a mechanism from a workflow sequencer** — a host
mechanism such as `git` legitimately uses three siblings, so the threshold
reported 23 production modules and its tree-wide assertion could only ever be
skipped. A permanently skipped guard is not a guard; removing it makes the repo
claim strictly less than it enforces rather than more. Raising the threshold or
adding an allowlist would have been worse: both restore the directory-placement
bypass the rule was meant to close.

Replacing it needs a structural invariant rather than a count — candidates are
dependence on the `cli` adapter package, dependence on more than one
*integration* package as opposed to a host mechanism, or constructing
collaborators rather than receiving them. That invariant can only be enforced
after the modules it would flag are re-homed into `src/application/`, and
**re-homing is tracked by parent TASK-2332**.

`adapterPackageDependencies` is a **ratchet, not a design**. Its entries were
transcribed from the edges the tree already had, so it does not certify that
today's cross-adapter graph is correct; it certifies that no *new* unnamed edge
can appear without an explicit declaration.

New sequencing belongs in application use cases, request translation and
rendering belong in `src/interfaces/`, and concrete object assembly belongs in
`src/composition/`.
