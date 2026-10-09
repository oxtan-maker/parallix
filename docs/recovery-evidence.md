# Recovery evidence contract

This contract describes the failure evidence the repair lifecycle captures before
it launches a repair agent, and the bounded interface fresh-context diagnostic
repairs use to retrieve it. It exists so a genuine failure that
sits behind a large passing prefix and a later passing-looking summary is never
lost to the terminal tail, to truncation, to a fresh agent context, or to a
process restart.

## Why

A verification command can fail between a long passing prefix and a summary that
looks like success. The terminal tail and a generic final error hide the
actionable failure, so the next repair budget is spent rediscovering a failure
that already happened. The capture step records the failed command and the
structured outcome before any repair launches, and the retrieval interface hands
that evidence to whichever agent repairs the mission, in each fresh launch.

## What is captured

A failed verification command retains, in durable per-mission storage under the
mission worktree:

- the command, its working directory, and the captured revision
- the exit code and signal
- incident and attempt identity, so the original failure and its retries group
  into one series without overwriting each other
- attributable stdout and stderr with byte counts and a capture-completeness
  flag
- whether the streams were truncated, redacted, or otherwise not whole

The incident is grouped by a fingerprint of the command, working directory,
captured revision, exit/signal, and diagnostic. A retry reuses the incident and
advances the attempt number. Each record is written atomically, so an
interrupted write is read as interrupted rather than as a complete record.

## How it is bounded

Retention and resource bounds keep the store finite and never produce a false
claim of completeness:

- a per-record byte cap truncates output past the cap and marks the record
  incomplete, naming which stream was truncated
- a per-mission incident count retires the oldest incident first, so a fresh
  failure always has room
- a retention window expires old incidents
- configured credential redaction is applied before capture and flagged on the
  record

A redacted record discloses that redaction ran; an incomplete record discloses
that the retained output is not the whole output.

## Retrieval

Retrieval is a bounded, honest interface, not a copy of the previous model's
assumptions. A fresh-context agent receives absolute paths in the mission
worktree and an incident fingerprint that stay stable across processes, so a
restart does not invalidate them. The route states exactly what was captured,
points at the omitted middle for retrieval, and names the retrieval call. When a
record is missing, truncated, expired, oversized, interrupted, or
access-denied, the route states it and points at related incidents rather than
claiming completeness.

Every agent-fixable automatic repair, including the first, starts a new ephemeral
conversation with the exact diagnostic and retained evidence. It reloads the
locked mission authority, applicable repository rules, current revision and
available repair obligations. Valid commits and working-tree edits survive
between attempts; the normal session marker remains available for ordinary work.
The repair budget and launcher retry budget remain separate. A successful agent
exit alone is insufficient: the authorized verifier must rerun successfully,
with committed-tree proof wherever the workflow requires it.

Selected paired first-repair replays favored fresh context in token use. They did
not validate full-cascade success or production savings. Automatic recovery keeps
production verification authority; an exploratory green probe cannot establish
success.

When automatic recovery exhausts its budget, the report still names the failed
check, the attempts spent, and the retrieval route so the retained output remains
reachable.

## Honest reporting

The interface reports each failure mode explicitly instead of implying success:

- **missing** — no record for the requested incident and attempt
- **interrupted** — metadata written but output truncated mid-write
- **truncated** — output exceeded the byte cap
- **expired** — older than the retention window
- **oversized** — a single record exceeded the byte cap
- **access-denied** — the store or a file could not be read or written

Every non-success report carries a bounded fallback of related incidents so the
next agent still has something to act on.
