# Test memory containment

The regular test runner puts the whole test process tree inside one memory
limit. A test that allocates without bound is killed, with every worker and
descendant it spawned, and the run fails with a report. The agent or terminal
that started the run keeps working and can read the failure.

## Why not a V8 heap cap

`--max-old-space-size` bounds one isolate's JavaScript heap. It does not bound
Buffers and other native allocations, compiler and DOM-library memory, or the
workers and child processes a suite starts. An aggregate boundary around the
tree does, and it is enforced by the kernel rather than by the code under test.

## What is contained

Every run that goes through `npm test` is contained before the first test
starts: focused selections (`npm test -- <suite>`), the unit and integration
tiers, covered runs, and the verification gates that call them. The limit covers
the workers, native allocations and spawned descendants combined. The runner
itself stays outside the limit, so it can report the breach. Swap is capped at
zero inside the limit; a breach is killed instead of thrashing the host.

Each workload has a finite default limit chosen from measured peaks with
headroom. The runner prints the effective limit and the observed peak at the end
of every contained run, so a suite drifting toward its limit is visible before it
breaches.

A test that itself starts the runner (a nested `npm test`) stays inside the
enclosing limit, so the outer limit counts and kills the nested tree too. A
breach is reported only when the kernel recorded an OOM kill (sampled, or systemd's retained `oom-kill` result if the scope vanished between samples); a failure near the
limit without one keeps its own assertion, timeout or signal outcome.

## When a run is killed for memory

The run exits `137` and prints, on stderr:

* `MEMORY LIMIT EXCEEDED` with the command, the selected suite, the configured
  limit, the observed peak and kill count (or that they were unavailable), and
* the cause: the aggregate test-process-tree memory limit. It is not an
  assertion failure and not a timeout, which print their own distinct output.

To repair it, rerun the named suite alone with `npm test -- <suite>`, find the
allocation that grows without bound (a loop that retains data, a fixture that
reads an unbounded file, a runaway child process) and bound it. Raise the limit
only for a measured, legitimate need.

## Configuration

* `PARALLIX_TEST_MEMORY_LIMIT_MIB` sets the limit for one invocation. It must be
  an integer number of MiB, at least 256 and not above the host's memory;
  anything else is rejected before any test runs.
* `PARALLIX_TEST_MEMORY_BOUNDARY=off` runs without a boundary. It is a bypass for
  hosts that cannot enforce one, and it prints a warning. Agents must not use it
  to get past a memory failure.

## Requirements and fallback

Enforcement uses Linux cgroup v2 through `systemd-run --user` with the memory
controller delegated to the user manager. Before launching, the runner proves
the limit and the swap cap are applied. If they cannot be, the run fails and says
what is missing (for a headless host, enabling lingering for the user usually
fixes it). It never falls back to running unbounded on its own.

The one automatic exception is GitHub-hosted runners, which are disposable and
have no delegated user manager: there the boundary is off with a printed notice.
Other platforms must opt out explicitly.

## Runner health before verification

Before expensive local verification or a test run starts, a fresh preflight
creates a memory-limited scope and reads back its memory limit and zero swap
cap. It also requires at least 64 MiB of available capacity and one free inode
on the runtime filesystem (`XDG_RUNTIME_DIR`, or `/run/user/<uid>`) and the test
temporary filesystem (`TMPDIR`, or the system temporary directory). This is an
admission minimum, not a guarantee that a workload will fit. When the boundary
is off, including the existing GitHub-hosted exception, preflight still checks
temporary capacity but does not require a user manager or its runtime directory.

A failed check exits with status `75` and a `[runner-health] infrastructure`
diagnostic naming the operation, resource, observation time and remediation.
Verification stops before builds or tests start. The workflow returns this
infrastructure blocker to the operator without spending implementer repair
attempts. Restore capacity or the user manager as directed, then rerun the
original verification command: recovery requires a fresh healthy preflight and
successful verification. Parallix does not remove runtime data automatically.

## Temporary storage after an interrupted run

The native coverage runner starts with a disk-backed `TMPDIR`, or `/var/tmp`
when the configured temporary directory is memory-backed. If neither is
writable on disk, startup fails with guidance to set `TMPDIR`. Once Node has
allocated its raw coverage directory, the test bootstrap restores the ordinary
fixture `TMPDIR`. Covered and uncovered fixtures therefore use the same
filesystem; only raw coverage and explicitly isolated transcript storage need
disk space.

Scratch ownership is recorded before use, both in the runner manifest and
beside its data. Covered manifests share the scratch filesystem. The data's
owner record includes the PID, process start identity and, on Linux, boot
identity; it also protects the runner's surviving suite process. Normal cleanup
removes these roots. At the next test-runner startup, recovery checks the exact
runner scratch layout and reclaims confirmed abandoned roots, including after
SIGKILL, reboot or loss of a volatile manifest. Live or uncertain owners keep
their data. Repeated recovery is safe.

Legacy roots without trusted ownership records are kept and reported; an age
or directory name alone never proves abandonment. Recovery does not require
reading every same-user process environment. Shared caches, durable evidence
and unrelated directories survive; there is no blanket temporary-directory
sweep. Test bootstraps register their own private disk-backed transcript roots
for cleanup instead of writing into the operator's shared fallback.

The test runner also keeps one stable temporary root per checkout. Its tsx and
Node compile caches stay warm between invocations, while different checkouts do
not share cache state. A durable owner record ties that root to the repository,
the linked checkout and the creating process. Normal mission closeout retires
the matching cache through the same worktree-cleanup boundary; active checkout
caches remain available.

After an interrupted closeout, the existing recovery pass considers only
marked checkout-cache roots with the exact managed name and location. It
removes one only when the directory is owned by the current user, neither the
root nor its ownership record is a symlink, the repository still confirms that
the linked checkout was retired, and the recorded PID plus process-start
identity is dead. Missing or conflicting proof leaves the cache untouched and
reports it as unresolved. Recovery does not age-delete unmarked cache-shaped
directories or scan unrelated temporary data.

## What is not contained

The boundary belongs to the runner. Invoking Node's test runner directly
(`node --test`), running a test file with `tsx`, or starting a fixture by hand
bypasses it, and so does the opt-out above. Those invocations are unbounded and
are not supported for agent use; go through `npm test`. The dedicated agent and
lifecycle end-to-end commands also start Node directly and are not contained.
The local browser end-to-end command uses `npm test` and retains this boundary.

## Proving the breach path

A real breach makes the kernel kill processes, which desktop Linux surfaces to the
user. The regular test lanes therefore never provoke one. The breach regressions
for the runner run only on request: `PARALLIX_TEST_MEMORY_BREACH=1 npm test --
<the runner memory-containment suite>`; without it they are reported as skipped.
