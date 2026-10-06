# ADR 0064: Mission terminal sessions and run history

**Status:** Accepted

**Date:** 2026-10-05

**Task:** TASK-2643

## Context

The operator requires tmux to behave like running Parallix in a terminal:
everything belonging to a mission shares its terminal, keyed by `task-XXXX`
or `adhoc*`. This also provides the terminal a future web card can display,
including when the mission is stopped.

A terminal limited to individual agent attempts omits Parallix command output
and verification work. The mission command needs a shared terminal while run
identity remains the attribution key for captured evidence. Headless callers
need unchanged stdin, stdout, stderr and exit-status contracts.

## Options considered

| Option | Mission console | Stopped mission terminal | Costs / risks | Decision |
|---|---|---|---|---|
| Keep one session per agent attempt | Agent output only; changes across retries and roles | Removed on exit | Wrong lifetime and scope | Reject |
| Group agent windows in a persistent mission session | Still omits Parallix and non-agent work | Available | Preserves the wrong hosting boundary | Reject |
| Run the mission's Parallix command in a persistent mission terminal | Parallix, agents and command children share the terminal | Available | Requires command-entry hosting and explicit exit/status handling | **Accept** |

## Decision

Use one persistent tmux session per repository and mission. Its session key is
the existing mission slug (`task-XXXX` or `adhoc*`), independent of role,
provider, attempt and lifecycle lane. Retain repository-scoped private socket
isolation so identical mission slugs in different repositories cannot collide.

Run the mission's Parallix command inside that terminal, as an operator would
run it from a shell. Interactive CLI callers attach automatically so their
input reaches the operation. Host only when stdin and stdout are TTYs;
headless callers keep the pipe path, including stdin and separate stdout/stderr.
The CLI command registry explicitly allows active, review, integrate, recover
and verify hosting. Queries and structured Mission writes retain caller-side output
contracts; when invoked within mission work they inherit its terminal. Agents, fallback and resume attempts, review, recovery,
verification and other command children inherit that terminal. Inherited agent
spawns do not create another host. An interactive standalone agent launch without
an outer command terminal may use its own operation window in this same mission
session; this is the fallback for TUI actions and other unhosted callers.
Concurrent mission operations may
use separate windows within the same mission session; they must not inject
commands into an occupied terminal or create another mission session.

When an operation finishes or is stopped, close its operation window. Keep
one console shell in the mission worktree for inspection, reconnection and later
commands. Cancellation terminates the owned operation and its children, not
the mission terminal. Restart reconciliation distinguishes an idle terminal
from an unsupervised operation; a session's existence is never proof of active
mission work. Explicit terminal cleanup removes the session independently of
evidence retention and mission workflow state. Worktree cleanup retires the
terminal: close an idle session immediately, or after its owned operations drain.
Terminal retirement is best effort with a warning on failure; it cannot prevent
administrative closure of a landed mission or change a completed command's status.

Attach resolves the mission terminal directly, including while idle. Run selectors apply to retained history, not terminal attachment; an active
run record is not a prerequisite for attaching to a stopped mission.
The console must retain the operator-state locations needed to resolve the same
mission socket on re-entry while excluding operation credentials.
Future web terminal access uses this same mission identity and terminal.
Web terminal rendering is outside this decision's implementation scope.

Detect tmux automatically: use it when installed and runnable, otherwise use
the pipe path without requiring configuration or reporting an ordinary missing
optional tool as an operator problem. An unusable socket path or launch failure
before command start also falls back under auto; a command that started is never
replayed as fallback. Explicit pipe/tmux overrides remain available; the fail
policy applies only to an explicit tmux override. Command hosting belongs to the CLI/process adapters and is wired by composition; application
and domain code must not acquire tmux dependencies. Re-entry must prevent
recursive hosting and preserve the command's exit status for its caller.

Keep the existing launch supervisor, confinement, retry budgets and workflow
authority. Wrap agent commands with confinement inside the mission terminal;
agents must not gain access to its private control socket. Hosting the outer
command must not bypass supervision or turn tmux into a lifecycle authority.

Retain per-run durable capture and bounded retrieval under the existing
evidence ownership, access, retention and redaction contract. A mission console
includes operator and harness output; it is not a replacement for attributable
agent history. Scrollback and rendered screens are not durable evidence.

## Relationship to existing decisions

- ADR 0051 retains the dependency direction and application-owned workflow
  ports. Terminal hosting is a concrete process mechanism wired by composition;
  it does not replace a use case with a CLI subprocess in TUI or web adapters.
- ADR 0053 retains Mission and current-work persistence authority. A tmux
  session or its transport files cannot become a second mission database.
- ADR 0048 retains fail-closed gates, cancellation boundaries and exact-revision
  evidence. Terminal output and process exit are not workflow completion proof.
- ADRs 0054 and 0055 retain shared guarded board commands and typed browser
  transport. Future terminal viewing must not move lifecycle policy to tmux,
  browser state or terminal text parsing.
- ADR 0057 retains verification tiers. Real tmux and confinement checks remain
  local integration boundaries; unit checks use doubles.

## Consequences

The CLI entry supplies its executable and arguments explicitly through
composition. Terminal hosting does not depend on the child-command wrapper or
`PARALLIX_CLI_COMMAND`; installed, source and native CLI invocations use the same
mission-hosting path.

The terminal follows the mission across agents, roles, retries and stopped
work. Future web console access can use the mission key without reconstructing
an attempt-specific terminal.

Persistent shells consume resources until explicitly cleaned up. Worktree
removal must account for the retained terminal. Multiple simultaneous commands
need isolated windows and per-operation status, cancellation and ownership.
The idle console is an unconfined operator shell. It starts from a minimal
operator environment rather than the operation's exported credentials. Its
commands can still access the operator's files and credentials. Owner-only
sockets limit who can attach; evidence redaction does not confine this shell.
The console uses `/bin/sh -i`; its private tmux server starts with an empty
configuration rather than loading the operator's tmux configuration.

Restart cleanup signals the recorded command before removing its window, but
cannot guarantee descendant cleanup if process identity is stale or a child
has escaped the existing supervisor. Window removal alone is not proof that
every detached descendant exited.

Moving hosting outward risks recursive CLI invocation, lost exit statuses and
incorrect signal propagation; these require focused command-host and real tmux
boundary checks before rollout. Linux/macOS tmux availability remains an
operator dependency; pipe launches retain their existing behavior.
