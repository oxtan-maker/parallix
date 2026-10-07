# Agent terminal sessions and run history

Interactive mission operations automatically use tmux when it is installed
and runnable. Headless callers keep pipes, preserving stdin and separate
stdout/stderr. Each mission has a persistent terminal keyed by its
`task-XXXX` or `adhoc*` slug. Parallix commands and their agents share that
terminal across roles, retries and provider changes. No configuration is needed.
Interactive active, review, integrate, recover and verify operations enter it
automatically. Queries and structured writes keep their caller-side output.

## Attach to a mission

From the mission worktree, or with an explicit mission slug:

```sh
px attach --list
px attach task-1234
```

Use `Ctrl-b d` to detach; it does not stop work. `--read-only` opens a watching
client. When work finishes, its operation window closes and one console shell remains
for inspection and later commands, showing the last 50 lines of command output
and its exit code. Commands started from that console also retain their output.
Removing the mission worktree retires the terminal after any owned operation
drains and the operator detaches; an attached result view remains available. Attach does not require a live agent or retained
run record. Concurrent operations use separate windows in the same mission
session. Different repositories and missions have separate private sockets.
Use `px attach <slug> --close` to remove an idle terminal when finished; it
refuses to close a terminal with an owned operation. Terminal cleanup does not
remove retained agent history. It also leaves a private command transcript for
the mission terminal. After landing has retired the live terminal, `px attach
<slug> --list` reports the transcript location so an operator can recover the
final integration result, gate diagnostics, and statistics from the surviving
repository checkout.
Retirement failures warn without blocking integration closeout. The console
retains the resolved terminal-state location so commands and attachment from
inside it reuse the same mission socket. If a configured state path is too long
for a portable Unix socket, Parallix uses a stable, private compact socket path
for that mission instead.

Explicit terminal-host overrides and unavailable-tool policy remain available
through `px config` and the workflow configuration schema. A pipe-hosted mission
has no attachable terminal; its retained output is still searchable. tmux hosting
requires Linux or macOS with a working tmux binary.

## Search retained output

History belongs to the current Mission. Outside its worktree, name the Mission
explicitly; from another Mission worktree, Parallix refuses cross-Mission
access.

```sh
px history list
px history search 'FAILED|AssertionError' --regex
px history search case-7193 --run <run-id>
px history show 'run:<run-id>:stdout@<offset>+<length>'
```

Search and show are bounded. Search results and `show` return stable
`run:<id>:<stream>@<offset>+<length>` references, so an agent can cite only the
needed bytes. A replacement agent should receive a command or one reference,
not pasted terminal content.

## What is retained

Terminal history is raw stdout and stderr bytes captured while the launch runs,
not tmux scrollback or a rendered screen. It therefore survives terminal
redraws, alternate screens, session exit, and tmux scrollback limits. Each run
reports its sources, byte coverage, dropped byte ranges, redaction, and plain
omissions. Provider-native session transcripts and tool results are retained
only when that provider exposes a supported source; their source label and
completeness are reported rather than inferred from terminal output.

Output is bounded by the existing recovery-evidence retention and redaction
contract. Under pressure, the store keeps the start and newest segments and
reports the omitted middle range. A supervisor crash leaves the written bytes
and is reported as an interrupted run. Retention eventually removes old runs;
copy stable references into mission evidence before that happens.

## Boundaries and cleanup

Parallix reconciles a dead host or harness before a mission relaunch, stopping
the unsupervised operation window while preserving idle mission terminals and
other supervised work. Normal exit,
cancellation, timeout, and signal handling still flow through the existing
launcher and supervisor.

The retained console is an unconfined operator shell with a minimal operator
environment; completed operation windows and their exported credentials are
removed. A `px` command starts a short-lived operator Bash child to resolve
operator-authorized provider settings before it execs, so those settings are
not retained in the console or tmux-server environment.
Owner-only sockets restrict attachment; evidence redaction does not confine the
shell. The console uses `/bin/sh -i` and the private tmux server ignores the
operator's tmux configuration.

Restart cleanup signals the recorded command before removing its window.
This is best effort when the recorded process identity is stale or a child
has escaped its supervisor: removing a tmux window alone does not prove that
all detached descendants have exited.

The terminal-command transcript is separate from agent-run history: it records
the operator-visible command output and its exit code, including integration
gate and closeout messages. It is retained for terminal recovery; an absent
live terminal or unavailable observation is reported as such rather than being
inferred from scrollback.

Terminal separation is not a security sandbox. On Linux, the existing
Bubblewrap confinement boundary remains responsible for agent filesystem
isolation and masks terminal-host state from confined agents. tmux does not
grant an agent cross-Mission access, does not replace that boundary, and does
not hold lifecycle, verification-gate, or review authority.
