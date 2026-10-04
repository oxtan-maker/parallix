# Outbound adapters

**This directory contains concrete integrations with filesystems, Git, agent processes, review providers, Backlog data, packaged assets, and SQLite.**

Adapters implement application-owned ports or provide concrete mechanisms used
by composition. The guards in `src/adapters/architecture/boundary-guards.ts`
classify every production module by location and then check five specific
things, listed in full under "Enforced rules" below: that the module sits in a
canonical root, that each cross-adapter import matches a named package rule,
that it resolves no collaborator by dynamic key lookup, that it does not
assemble the complete object graph, and that a workflow-facing adapter does not
choose the follow-on workflow action itself. Those five bite regardless of where
a module is moved or renamed to.

They are not a general test of whether a module owns another layer's
responsibility; "Workflow ownership" below states exactly what the fifth rule
covers and what it deliberately leaves alone.

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

Every cross-adapter edge must instead match either a **named host-mechanism
rule** in `adapterPackageDependencies` or an application-owned port route. The
mechanism table is the enforced design: it contains only the concrete host
services an adapter may use directly. Workflow behaviour crosses an application
port, whose concrete implementation composition supplies. Neither route has a
wildcard or per-file exception, and the guard enumerates `src/adapters/` at run
time, so a new package cannot add an unnamed dependency.

An adapter that needs behaviour it may not import directly depends on an
**application-owned port** under `src/application/ports/` instead; composition
supplies the implementation. The failure diagnostic names that remedy directly.

Naming an edge satisfies the dependency rule but does not grant workflow
ownership; see "Workflow ownership" below.

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
`test/unit/adapters/architecture/dependency-graph.test.ts` that builds a temporary tree with
`fs.mkdtempSync`. Every fixture has been mutation-checked: disabling the rule
turns that fixture red.

| Rule | What fails | Fixture that proves it |
|---|---|---|
| `unclassified-production-module` | A module under `src/` outside all six roots, including one loose at the `src/` root | `"responsibility scan reports a new unclassified production module with its path and expected owner"`, `"responsibility scan reports a loose module at the src root as unclassified"` |
| `cross-adapter-dependency-not-named` | An import between adapter packages with no named rule | `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"`, `"cross-adapter rules name every adapter package and grant no wildcard"` |
| `hidden-service-location` | Resolving collaborators by dynamic key lookup | `"responsibility guard fails hidden service location in an adapter module"` |
| `complete-graph-outside-composition` | Building the complete object graph outside `src/composition/application-services.ts` | `"responsibility guard fails complete-graph construction outside the composition root"` |
| `adapter-owned-workflow-control` | A workflow-facing adapter invoking a workflow-control operation under a branch outside a typed port binding | `"workflow ownership rejects an adapter-owned control loop that selects the follow-on action (TASK-2637.06)"`; accepted bindings: `"workflow ownership accepts an adapter that binds a named typed port and delegates once to its application entry"`, `"workflow ownership accepts a typed port factory and unconditional single delegation"` |

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
process; run them with `npm test -- test/unit/adapters/architecture/dependency-graph.test.ts`.

## Workflow ownership

An adapter is **workflow-facing** when it value-imports an application entry: a
module under `src/application/` outside `ports/` and `presentation/`. Such an
adapter may bind typed application ports and delegate to that entry. It may not
decide what the workflow does next: invoking a workflow-control operation —
lifecycle transition, retry, recovery, phase gate, agent launch, or review round,
named in `workflowControlOperations` — under an `if`, `else`, loop, `catch`,
ternary, or `&&` fails the rule unless the call sits inside an object literal or
factory typed as an imported application port. Inside a port binding the
application entry decides when the operation runs.

`test/integration/composition/application-boundaries.test.ts` applies the rule to the whole production
tree. The re-homed review and active workflow adapters satisfy it by binding
typed ports to their application entries, not through an exception.

The syntactic rule follows direct aliases, injected defaults, and chains rooted
in an imported control operation, including `launch = opts.launch ?? startAgent`
and parameter defaults. It does not prove arbitrary data flow through unrelated
objects or higher-order callbacks; those still require source review.

The rule deliberately excludes:

* **Concrete mechanisms.** An adapter with no application entry — `git`,
  `forgejo`, `verification`, `agents` and the other host mechanisms — is left to
  the named package rules however many siblings it uses.
* **Counts.** There is no sibling-import count, fan-out threshold, allowlist, or
  per-file exception. A count cannot tell a host mechanism that uses three
  siblings from a module that sequences a workflow.
* **Unlisted control.** Sequencing through an operation that is not in
  `workflowControlOperations` is not detected; review still owns that judgment.

`adapterPackageDependencies` is the enforced host-mechanism design. It does not
authorize workflow sequencing: that behaviour must cross an application-owned
port and be assembled by composition.

New sequencing belongs in application use cases, request translation and
rendering belong in `src/interfaces/`, and concrete object assembly belongs in
`src/composition/`.
