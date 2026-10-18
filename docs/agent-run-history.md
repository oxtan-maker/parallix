# Agent terminal sessions and run history

Interactive mission operations automatically use tmux when it is installed
and runnable. Headless callers keep pipes. Owned workflow output combines stdout and
stderr in one coordinator transcript in the order observed. Each mission has a persistent terminal keyed by its Mission ID
(`task-1234`, `task-2622.18`, `px-0042`, …), kept exactly as recorded; an
uppercase alias such as `TASK-2622.18` is accepted on the command line. Parallix
commands and their agents share that terminal across roles, retries and
provider changes. No configuration is needed.
Interactive draft, review and integrate commands keep the foreground CLI
connected to their owned executor, preserving terminal progress updates.
Redirected output uses plain messages. Interactive active, recover and verify
operations enter the mission terminal automatically. Queries and structured
writes keep their caller-side output.

For foreground draft, review/handoff and integration, Ctrl+C stops the invoked
workflow and its owned children before returning a non-success result. Repeated
Ctrl+C keeps the same cleanup running. After cleanup succeeds, retry the same
command immediately; the Mission and recorded evidence remain available.
A CLI interrupt does not stop an independently started web workflow or another
Mission. Use `px stop <slug>` to explicitly settle that Mission's workflow.
Cleanup escalates to forced termination when needed, with two confirmation
stages of up to two seconds of polling per owned process tree, plus process
inspection time. Attributed detached executions are also settled. If termination
cannot be confirmed, Parallix reports a pending stop and refuses replacement;
inspect the retained history and retry `px stop` after resolving the surviving
execution.

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
remove retained history. `px attach <slug> --list` reports the terminal state
and how many operations are retained; after landing has retired the terminal,
`px history <slug> list` and `search` recover the final integration result,
gate diagnostics and statistics from the surviving repository checkout.
Terminals and history recorded by earlier releases resolve without being
renamed. A record or session that cannot be attributed to exactly this Mission
and repository is reported and is never attached to, closed or deleted.
Retirement failures warn without blocking integration closeout. The console
retains the resolved terminal-state location so commands and attachment from
inside it reuse the same mission socket. If a configured state path is too long
for a portable Unix socket, Parallix uses a stable, private compact socket path
for that mission instead.

Explicit terminal-host overrides and unavailable-tool policy remain available
through `px config` and the workflow configuration schema. A pipe-hosted mission
has no attachable terminal; its retained output is still searchable. tmux hosting
requires Linux or macOS with a working tmux binary. Only a confirmed missing
socket or server means the terminal is absent. Permission denial, ambiguous
connection errors, a failed probe, missing tmux, or a timeout leave its state
unavailable; retained history stays readable and observation never retires it.

## Mission history on the board

Selecting a mission card in `px web` opens its retained history, newest
operation first, with new output appended while an operation runs. Earlier
history loads page by page; search covers every retained operation (literal
text); the operation and stream selectors switch between records; copy copies
what is shown. Scrolling back keeps the selected operation and position when
new runs arrive; resume following to return to the newest operation. Failed
initial history reads retry during polling. The live
pane is an optional extra view and never replaces the history. The view states
whether an operation is starting, live, ended, ran without a terminal (pipe),
has no history, or whether the terminal could not be inspected; a failed or
timed-out inspection keeps the history on screen and is not reported as "no
terminal".

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

Each mission operation (`active`, `review`, `integrate`, `recover`) is retained
as its own record next to the agent runs it launched, with its exit status, so
harness messages, preflight, gates, handoff, review and retries are searchable
too. A terminal-hosted operation records everything its pane drew, with stderr
merged by the terminal. An owned workflow without a terminal captures both executor pipes into its
ordered coordinator transcript, including inherited child output. Other
in-process operations keep stdout and stderr apart; child output that bypasses
that process is not captured, and the record says so. Commands dispatched from
the board share workflow ownership and retain their coordinator and agent runs.

Coordinator command records are labelled workflow captures, with no agent
family or attempt. When current work is published, they correlate to its
existing operation ID; missing publication leaves that correlation unconfirmed. Agent records retain their invocation identity and separate execution
observation: an open capture alone does not mean the agent is live. A confirmed
process identity must match the identity recorded for that execution to confirm
liveness. A reused PID or identity mismatch means that execution is no longer
live; hosted workflow commands record their process identity before execution.
A PID without a recorded start identity, or an unreadable current identity,
leaves execution unconfirmed even when its terminal window still exists. This
does not change family availability or the Mission assignee. Earlier coordinator records remain
readable with the same history references. Hyphenated agent family names stay
canonical in invocation and history metadata; old encoded family tokens are
decoded when read, without renaming retained records or terminal windows.

History lives in the repository checkout (`.workflow/run-history/<mission>/`
under the main checkout, ignored by Git), not in the Mission worktree, so it
survives worktree removal and host restart. Worktree-local history from earlier
releases is read in place and moved there before integration removes the
worktree.

Terminal history is raw stdout and stderr bytes captured while the launch runs,
not tmux scrollback or a rendered screen. It therefore survives terminal
redraws, alternate screens, session exit, and tmux scrollback limits. Each run
reports its sources, byte coverage, dropped byte ranges, redaction, and plain
omissions. Provider-native session transcripts and tool results are retained
only when that provider exposes a supported source; their source label and
completeness are reported rather than inferred from terminal output.

Claude's native transcript lookup uses the home supplied when Parallix starts.
If you set `HOME` for the invocation, retention looks in that home's Claude
project directory.

Output is bounded by the existing recovery-evidence retention and redaction
contract: at most 50 records (operations and agent runs together) per mission,
each kept up to 30 days, and per stream the first and newest bytes up to 5 MiB
with the omitted middle reported as a gap. Credential redaction runs only when
`PARALLIX_CREDENTIAL_REDACTOR` is set. A supervisor crash leaves the written
bytes and is reported as an interrupted run. Retention eventually removes old
runs; copy stable references into mission evidence before that happens.

## Boundaries and cleanup

Parallix reconciles a dead host or harness before a mission relaunch, stopping
the unsupervised operation window while preserving idle mission terminals and
other supervised work. Normal exit,
cancellation, timeout, and signal handling still flow through the existing
launcher and supervisor.

The retained console is an unconfined operator shell: the operator's own
interactive shell (`$SHELL -i`, `/bin/sh` when unset), so it reads their rc files
like any terminal and the environment they expect returns. Completed operation
windows and their exported credentials are removed. The private tmux server and
every operation window it launches start from a minimal environment and ignore the
operator's tmux configuration, so operation credentials are not inherited from the
console. Owner-only sockets restrict attachment; evidence redaction does not
confine the shell.

Restart cleanup signals the recorded command before removing its window.
This is best effort when the recorded process identity is stale or a child
has escaped its supervisor: removing a tmux window alone does not prove that
all detached descendants have exited.

The private terminal transcript (unredacted, in the owner-only terminal state
directory) only feeds the console's display of a finished command; it is never
offered through `px history`, `px attach` or the web host. An absent live
terminal or unavailable observation is reported as such rather than being
inferred from scrollback.

Terminal separation is not a security sandbox. On Linux, the existing
Bubblewrap confinement boundary remains responsible for agent filesystem
isolation and masks terminal-host state from confined agents. tmux does not
grant an agent cross-Mission access, does not replace that boundary, and does
not hold lifecycle, verification-gate, or review authority.

## Execution counts and workflow activity

The board header counts confirmed executing provider invocations by their actual
family. Mission cards use the same observation. One invocation counts once;
wrappers, retained consoles, workflow owners and assignees add no providers.
Provider-internal subagents are not individually observable and add no inferred
counts. In-process providers without invocation-level liveness evidence, including
Pi, remain unconfirmed while their capture is open.

Preparation, capacity waits, post-agent gates and pending stop remain workflow
activity. Spinning card fans describe that activity, independently of execution.
A selected or previous family does not establish that a provider is executing.
Pending stop alone does not establish exit.

Historical crashes and legacy captures do not make today's execution counts
incomplete after their supervisor is gone. Uncertainty remains relevant to the
currently admitted operation or a capture whose supervisor is still live.
Independent confirmation of a provider still counts even if its capture
supervisor has exited. Coordinator history does not consume provider checks;
recent provider invocations are checked first.

A complete observation can report zero. When only part of the execution evidence
can be checked, confirmed positive counts show a `+` lower bound; a family with
no confirmed positives reads `unknown`. Cards likewise show confirmed invocations
with their limitation, or `execution unknown`. Failed or interrupted observation
of current execution never establishes zero. Closing capture without an exit
result does not confirm provider exit either. A missing terminal host does not
establish provider death; process identity and retained invocation evidence are
checked independently. Browser reload and web-host restart rediscover existing
invocations without launching replacements.
