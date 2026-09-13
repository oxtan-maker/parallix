# ADR 0057: Verification tiers and trust boundaries

**Status:** Accepted

**Date:** 2026-09-12

**Task:** TASK-2500.04

## Context

Parallix had a hermetic default suite and one integration suite. The integration
suite mixed tests that run from a clean checkout with tests requiring workstation
tools, platform-specific packaging, or a configured agent and model. Making that
mixed suite a required hosted check would either make CI depend on operator state
or require dropping coverage until it passed.

The audited baseline contained 464 test files: 305 in the default suite, 157 in
the integration suite, and two gate-only agent/lifecycle tests. An isolated run of
the integration suite showed that nearly all integration coverage uses only
checkout-local facilities; the genuine workstation requirements were limited to
sandbox confinement, external analysis tooling, and native executable packaging.
This supports splitting the integration suite rather than treating all boundary
tests as inherently local.

The decision must satisfy four constraints:

1. A hosted lane must run without credentials, model configuration, private
   services, or unprovisioned workstation tools.
2. Existing local and real-agent coverage must remain mandatory before merge.
3. A new boundary test must not enter hosted CI without review of its dependencies.
4. Each lane must make a distinct, reviewable claim about what a green run proves.

## Options considered

| Option | Clean-runner reliability | Coverage retained | Classification drift | Operational cost | Decision |
|---|---|---|---|---|---|
| Keep one integration suite | Low: workstation and agent dependencies remain mixed in | High locally | None, but no hosted lane exists | Low | Reject |
| Hosted suite with a local-only exclusion list | High initially | High | Unsafe: new boundary tests enter CI by default | Low | Reject |
| Capability detection and runtime skips | Variable: the same command proves different things on different machines | Partial and easy to overlook | Hidden in skip conditions | Medium | Reject |
| Explicit CI-safe and local registries | High | High: the existing full suite remains intact | Fails closed on unclassified tests | Small ongoing classification cost | **Accept** |

Keeping one suite does not meet the purpose of the decision: it cannot provide a
required clean-runner check. An exclusion list creates that check cheaply, but a
new integration test is trusted until somebody notices otherwise—the wrong
default at a trust boundary. Runtime capability detection avoids maintaining a
registry but turns a green command into an environment-dependent claim and permits
silent skips. Positive registries make the review decision explicit while
preserving the complete local suite.

## Decision

Adopt four verification tiers:

| Tier | Permitted dependencies | Excluded dependencies |
|---|---|---|
| `unit` | In-process modules, injected doubles, isolated temporary state | Real processes, databases, sockets, and external binaries |
| `integration-ci` | Checkout, temporary directories, loopback sockets, and standard hosted-runner tools such as Node, npm, Git, Bash, and tar | Credentials, operator state, model services, live Forgejo, and extra workstation binaries |
| `integration-local` | The CI set plus declared workstation or platform tooling | Real model traffic and live-agent configuration |
| `agent-e2e` | Configured agent runners and reachable model backends | — |

Membership in `integration-ci` and `integration-local` is positive and explicit.
Together their registries must partition the integration suite without gaps or
overlap. Every local-only entry must state the unavailable dependency. An
unclassified boundary test fails verification and runs in neither integration
sub-lane until classified.

The existing full integration command remains the union of both integration
registries. Lifecycle and real-agent checks retain their dedicated commands and
their places in the repository-owned pre-merge gate plan. Hosted CI supplements
that plan; it does not become merge authority.

## Relationship to existing decisions

- ADR 0041 remains authoritative for pre-merge gate selection and execution.
  This ADR classifies tests; it does not replace the local integration pipeline.
- ADRs 0043 and 0045 remain authoritative for branch targets and integration
  modes. Hosted CI evaluates a revision but does not make a hosted branch or
  Forgejo ref an ancestry, rebase, integration, or merge authority.
- ADR 0048's fail-closed and exact-tree requirements still apply to every proof
  consumed by the workflow; tier membership does not make stale evidence valid.
- ADRs 0044 and 0046 continue to govern release verification and manual npm
  publication. A hosted test lane does not introduce CI-driven publication.

## Trust model

A green hosted run proves that a clean checkout builds and typechecks, hermetic
logic passes, CI-safe process/Git/SQLite/package/loopback boundaries work, and the
portable package artifacts are valid. It does not prove workstation confinement,
native executable packaging, external operator-tool integrations, a real Forgejo
lifecycle, or agent/model connectivity.

A green local integration and lifecycle run additionally proves the declared
workstation-dependent boundaries and a complete mission lifecycle with a stubbed
agent. Only the real-agent lane proves that Parallix can launch a configured agent
against a reachable model and consume its output.

Therefore a green hosted check is necessary but not sufficient for merge. The
repository's configured pre-integration gates remain authoritative.

## Consequences

- Hosted verification can be required without weakening local or agent coverage.
- Adding an integration test now requires a classification decision; this is the
  deliberate cost of preventing accidental trust expansion.
- Local-only reasons form an auditable queue for future CI provisioning or test
  isolation work.
- The exact commands, membership, and current exclusions remain owned by package
  scripts and the executable test-category registry, not duplicated in this ADR.
