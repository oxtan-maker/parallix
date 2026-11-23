# ADR 0064: Mission terminal sessions and run history

**Status:** Accepted; concurrent-review presentation implemented by PX-0046

**Date:** 2026-10-05

**Task:** TASK-2643

## Context

Operators need one place to observe and re-enter all work belonging to a
mission, including Parallix commands, agents, verification and retries. A
terminal scoped to an individual agent attempt is too narrow, while treating a
terminal as workflow state would give process infrastructure authority it does
not own.

The terminal may outlive an operation or its worktree. Retained run history
must also survive those boundaries, without making terminal scrollback the
durable evidence source. Headless callers must keep their stdin, output and
exit-status contracts.

## Options considered

| Option | Mission console | Stopped mission terminal | Costs / risks | Decision |
|---|---|---|---|---|
| Keep one session per agent attempt | Agent output only; changes across retries and roles | Removed on exit | Wrong lifetime and scope | Reject |
| Group agent windows in a persistent mission session | Still omits Parallix and non-agent work | Available | Preserves the wrong hosting boundary | Reject |
| Run the mission's Parallix operation in a persistent mission terminal | Parallix and its descendants share one console | Available | Requires explicit process and evidence boundaries | **Accept** |

## Decision

Use one persistent terminal session per repository and mission. Repository and
canonical Mission identity define the logical terminal; native socket and
session names are adapter details. Repository-scoped private sockets prevent
identical Mission IDs in different repositories from colliding.

Host the mission's Parallix operation in that terminal so its agents and other
children inherit the same host. Host selection and attachment are separate:
foreground operations host only with an interactive TTY, while Parallix-owned
background executors follow the terminal policy without a caller TTY.
Attachment also requires an interactive TTY. Inherited work must not create
another mission host. Concurrent operations use separate windows in the same
session.

Automatic selection uses the terminal host when it is available and falls back
to pipes when a launch cannot start. Explicit host and unavailable-tool
policies apply to every hosting-eligible launch, including Parallix-owned
background executors. A command that started is never replayed as a fallback.
Hosting remains a process-adapter concern wired by composition; application and
domain code do not depend on tmux.

An operation owns its window and process tree, not the mission terminal.
Completion or cancellation closes that operation window while leaving an idle
console for inspection and later commands. Cleanup and worktree retirement may
close an idle terminal, but terminal state neither proves workflow activity nor
controls mission lifecycle.

Retain attributed history for both mission operations and individual agent
runs in the repository's canonical state, outside the Mission worktree. The
terminal transcript supports console replay but is not durable evidence. The
mission view may combine retained history with current terminal output, and it
must report unavailable or ambiguous live state rather than silently treating
it as absent.

Keep workflow authority, verification, retry, confinement and evidence
redaction outside the terminal adapter. Agents do not receive the terminal's
private control socket. The retained console is an operator shell with a
minimal environment and must not inherit operation credentials.

## Relationship to existing decisions

- ADR 0051 retains dependency direction and application-owned workflow ports.
- ADR 0053 retains Mission and current-work persistence authority.
- ADR 0048 retains fail-closed verification and exact-revision evidence.
- ADRs 0037 and 0053 retain review policy and durable review state; terminal
  presentation does not derive quorum or lifecycle decisions.

## Consequences

The terminal follows a mission across agents, roles, retries and stopped work.
Web and board consumers address it by Mission identity rather than reconstructing
adapter handles or attempt-specific sessions.

Persistent consoles consume resources until cleanup or retirement. Parallel
operations require isolated windows and per-operation status, cancellation and
ownership. A private socket limits who can attach, but does not make the idle
operator shell a confined agent environment.

Moving hosting around the outer operation risks recursive invocation, lost exit
status and incorrect signal propagation. The process boundary must preserve
those contracts, and pipe launches retain their existing behavior when the
terminal host is not selected.
