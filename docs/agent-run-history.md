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

For foreground draft, active and integration, Ctrl+C stops the invoked
workflow and its owned children before returning a non-success result. Repeated
Ctrl+C keeps the same cleanup running. After cleanup succeeds, retry the same
command immediately; the Mission and recorded evidence remain available.
Interrupting `px lead` also ends fleet polling and interrupts its forwarded
clients. Each forwarded command reports confirmed shutdown or continuing
work with instructions; use `px history <slug> list` to inspect its retained output.
A CLI interrupt does not stop an independently started web workflow or another
Mission. Use `px stop <slug>` to explicitly settle that Mission's workflow.
The stop result names the Mission and reports confirmed shutdown or a pending
stop; a successful signal delivery alone does not confirm shutdown.
Cleanup escalates to forced termination when needed, with two confirmation
stages of up to two seconds of polling per owned process tree, plus process
inspection time. Attributed detached executions are also settled. If termination
cannot be confirmed, Parallix reports a pending stop and refuses replacement;
inspect the retained history and retry `px stop` after resolving the surviving
execution.

Review has a detached owner. Once admitted, closing the foreground `px review`
client, Ctrl+C or SIGTERM ends observation while the owner and reviewer continue
and can record their verdict. Use `px stop <slug>` to terminate review explicitly;
it fences writes and confirms attributed work has stopped before allowing a
replacement.

If an unfinished review loses all its running work, `px review <slug> --status`
and `px status <slug>` report an orphaned round and name the recovery sequence:
`px stop <slug>`, then `px review <slug>`. An unconfirmed probe is reported as
unconfirmed, not as proof that work has ended. Status commands only inspect;
they do not stop or restart review.

A verdict rejected by the ownership fence remains rejected. Its decision,
findings and comment are retained at the evidence location printed by
`px verdict`. A restarted reviewer receives references identifying the original
round and workflow as unaccepted evidence. The reviewer must assess the current
tree and submit a fresh verdict; retained evidence never grants approval.

When an owned draft, active, review, integrate or stop command fails, its final
summary follows the streamed output. It names the workflow stage and command,
the observed coordinator exit code or signal, recorded diagnostics, and the
next operator action. A cause that the recorded evidence does not establish is
shown as unknown. A failed verification command is listed separately with its
own exit code when that evidence was retained.

The summary includes a command such as
`px history task-1234 show run:<run-id>:stdout@<offset>+<length>` to inspect a
retained output slice. It says plainly when no output was retained. Recovery
is reported separately: no recorded attempt, attempted and resolved, or budget
exhausted with its attempt count. Incomplete recovery evidence is reported as
unresolved; a nonzero command exit alone never establishes recovery-budget
exhaustion. Inspect the cited output and `px status <slug>`, address the recorded
failure, then explicitly retry as directed.

## Attach to a mission

From the mission worktree, or with an explicit mission slug:

```sh
px attach --list
px attach task-1234
```

Use `Ctrl-b d` to detach; it does not stop work. `--read-only` opens a watching
client. When work finishes, its operation window closes and one console shell remains
for inspection and later commands, showing the last 50 lines of command output
and its exit code. Hosted mission commands started from that console also retain their output.
Mission commands resolve their worktree from the Mission identity even when the
console or shell startup files leave the shell in the base checkout. Execute,
review and recovery retries retain the mission branch preflight; the console
location does not authorize work in the base checkout.
Removing the mission worktree retires the terminal after any owned operation
drains and the operator detaches; an attached result view remains available. Attach does not require a live agent or retained
run record. Concurrent operations use separate windows in the same mission
session. Different repositories and missions have separate private sockets.
Use `px attach <slug> --close` to remove an idle terminal when finished; it
refuses to close a terminal with an owned operation. Terminal cleanup does not
remove retained history. `px attach <slug> --list` reports the terminal state
and how many operations are retained; after landing has retired the terminal,
`px history <slug> list list` and `search` recover the final integration result,
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

Selecting a mission card in `px web` immediately shows its current terminal
above the retained history. The terminal refreshes every second while the view
is open, including when browsing older operations. Retained history opens at
the newest operation, with new output appended while an operation runs. Earlier
history loads page by page; search covers every retained operation (literal
text); the operation and stream selectors switch between records; copy copies
what is shown. Scrolling back keeps the selected operation and position when
new runs arrive; resume following to return to the newest operation. Failed
initial history reads retry during polling. Incomplete or malformed history
responses are reported as read errors; already loaded history stays visible
until a valid refresh recovers. Terminal refreshes skip ticks while a read is
pending and keep the displayed output if a refresh fails. Closing the mission
view cancels its reads.
The view states whether an operation is starting, live, ended, ran without a terminal (pipe),
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

The web mission view reads the current terminal screen independently of retained
transcripts. Rotating or expiring transcript segments does not interrupt that
display. Private transcript segments supply the console's replay after a command
finishes; durable history keeps its existing access and redaction rules.

### Where transcripts are stored and how much is kept

Transcripts are bulk data, so they never live beside the tmux sockets in the
runtime directory. They go to their own owner-only directory under the operator
state home (`PARALLIX_HOME`), or the explicit disk-backed
`PARALLIX_TERMINAL_TRANSCRIPT_DIR`; when the state home sits on a memory-backed filesystem
the transcript root moves to `/var/tmp/parallix-terminal-transcripts-<uid>`, and
when no candidate is disk-backed and writable the launch reports why instead of
writing there, and hosting falls back to the pipe. Sockets, launch scripts and
fifos keep their short private runtime paths, including the compact socket path
used when a configured state path is too long for a Unix socket.

The kept volume is finite. One writer holds four 1 MiB segments and drops its
oldest as it starts a new one, so continuous output never grows a single capture
file without bound. Launches and live writers also apply per-mission and
aggregate budgets — 16 MiB per mission and 256 MiB across all missions — and
expire segments untouched for seven days. Writers enforce these budgets before each
segment, at completion and every second while an operation pipe is open, even
when that operation is idle. The retained interactive console has no transcript
writer: its current screen remains available to attach and web viewing. Each segment reserves at least its full 1 MiB capacity (or its
allocated blocks when larger), plus 16 KiB for file and directory metadata. A writer removes its oldest segment
before creating another; rotation makes no temporary transcript copy. If another
writer evicts an open segment, its inode can retain at most 1 MiB until the
evicted writer closes it at its next check, within one second. This transient
space is additional to the retained-file budgets, per evicted live writer. The
newest operation segments are kept; live terminal output continues while capture
rotates. If a storage write fails, capture drops that segment and retries at
the next segment boundary. A worker startup failure drains the capture pipe so
durable workflow output can continue.

When requested output is no longer retained, the console says which case it is
instead of showing a silent gap: earlier output of that operation was rotated
out, so the retained tail follows, or the transcript of that operation is no
longer retained. Retention of the private transcript never touches the durable,
redacted history records above, and those keep their own bounds.

Transcripts written beside the socket by earlier releases are reclaimed at the
same launch or live-writer check: removed when their socket is gone, truncated
when an older server is still appending to them.

Terminal separation is not a security sandbox. On Linux, the existing
Bubblewrap confinement boundary remains responsible for agent filesystem
isolation and masks terminal-host state from confined agents. tmux does not
grant an agent cross-Mission access, does not replace that boundary, and does
not hold lifecycle, verification-gate, or review authority.

## Execution counts and workflow activity

The board header counts confirmed executing provider invocations by their actual
family. Web mission cards use that observation for worker identity while keeping
their fan, mission ID, agent and title header first, without a separate execution
count row. One invocation counts once;
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
