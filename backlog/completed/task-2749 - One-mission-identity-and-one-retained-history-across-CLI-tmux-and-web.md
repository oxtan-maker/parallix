---
id: TASK-2749
title: 'One mission identity and one retained history across CLI, tmux and web'
status: done
assignee: [codex]
created_date: '2026-10-14 18:17'
labels: []
dependencies: []
ordinal: 239008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Opening a mission on the board reliably shows its retained workflow history, whether or not a tmux session or worktree still exists. CLI, launch, attach, web reads and cleanup use one authoritative identity contract. Combine terminal identity and history in this mission; do not deliver another web-only naming patch.
Reference inspected: 4d459cbbfd27ab5a880964542bd4bdfb55a776a2. Reproduce on starting HEAD and read its instructions before editing. This mission is separate from the already-requested projection-error/256-entry operation-log fix.
Starting evidence
- src/domain/agent-run.ts already holds identity, but agentRunIdentity() rewrites Mission IDs into terminal-safe tokens (task-2622.18 becomes task-2622_18). tmux-terminal-reader.ts derives targets from the unsanitized ID. Moving more code into domain without fixing this contract will not help.
- src/domain/mission.ts defines canonical Mission IDs as lowercase and permits dots. Preserve that authority; uppercase CLI aliases, where supported, are an input-normalization concern, not permission to widen domain validation.
- tmux-terminal-reader.ts captures the visible pane; tmux-host.ts removes finished operation windows and replays a 50-line tail into the console. Web composition prefers any live pane over recorded history.
- retained-mission-output.ts offers a tail from one run. Discovery and run-history storage depend on the worktree. These are not complete mission-history semantics.
Required design and behavior
Identity authority, not tmux in the domain
Own logical mission-terminal identity and its invariants in the domain, using the existing Repository/Mission/Run concepts rather than a parallel identity system. Preserve canonical MissionId losslessly. One repository+mission has a stable logical terminal; operations, attempts and provider sessions remain distinct attributed records beneath it.
Keep tmux commands, socket paths, filesystem encodings and process handles in adapters. Resolve their native handles through an application-owned capability; web and CLI pass canonical MissionId and consume its result. No browser/interface-generated socket paths, sanitizers, worktree guesses or session-name reconstruction. Apply this contract to launch, attach, capture, history, retirement and cleanup, not merely web reads. Extend architecture checks at the owning boundary.
Preserve existing sessions/history where attribution is unambiguous. Implement one bounded compatibility resolver for old naming/records, not scattered fallbacks. Ambiguous legacy matches must be reported, never attached to or deleted as the wrong mission. New identities must not collide for distinct supported Mission IDs. Do not rename or terminate running sessions to migrate them.
History independent of the live terminal
Reuse the existing segmented run-history/capture and credential-redaction mechanisms. Expose the retained workflow transcript, including harness messages, preflight/gate output, agent output, handoff, review, retries and exit status. Keep operation/run boundaries and stream attribution; do not claim a total stdout/stderr ordering that was not recorded or model activity the provider never emitted.
Retain/discover history by repository+mission independently of worktree existence. Adapt/migrate the existing store or preserve it before cleanup; do not create a competing logger or delete the only transcript with the worktree. Existing retention limits stay explicit: show truncation, gaps, interrupted capture and unavailable provider transcripts honestly. Do not expose unredacted tmux capture files as a shortcut.
The mission view defaults to retained history with current output appended. Provide earlier-history paging, search across retained history, copy, operation/run selection and follow-output that pauses when the operator scrolls back. A live pane is an optional attachment/view, not an override that hides history. Use bounded reads and incremental updates; do not reread/render all retained bytes on each poll.
Return typed distinctions for starting/not yet hosted, live, ended with history, capture-only/pipe execution, missing history and failed/timeout probes. A transient tmux error must not erase already displayed output or falsely assert that no session exists. Resolve owned resources only; the API must not accept arbitrary paths, native handles or shell commands. Preserve loopback/session protections and safe text rendering.
Decisive verification
Extend owning suites with production behavior, not duplicated test implementations:
1. Round-trip launch -> web lookup -> attach -> history -> cleanup for dotted, hyphenated and DB-owned IDs, across two repositories and accepted CLI aliases. Reject invalid/ambiguous identities; never resolve another mission's resources.
2. An isolated real-tmux fixture emits identifiable first/middle/last output beyond the visible pane, finishes, starts another operation, then loses its tmux session and worktree. Earlier and later retained output stays discoverable through the actual history API, with correct attribution and redaction. Assert no duplication from replaying a transcript into the console.
3. Probe timeout, absent tmux, partial capture, retention eviction and host restart give accurate results without wiping usable history. Paging/search do not require loading the whole transcript.
Use cheap fixtures, existing test tooling and the narrowest appropriate tiers. Manually inspect the running browser against isolated data, including scrolling back while output arrives. No real mission deletion or paid/model-backed runs; no new E2E framework. Run focused regressions and required static analysis, not repeated full gates.
Delivery
Implement the shared contract and all consumers together. Record before/after reproductions, exact checks, migration/retention behavior and limitations in the normal checkpoint. Do not broaden lifecycle policy or implement the async command runner here. Publish the application capability for the separate board-action mission to reuse. Follow normal review; no automatic integration or origin push.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->


## Delivery evidence

The reconciliation reuses RepositoryId, MissionId and AgentFamily in the
existing AgentRunIdentity. Coordinator captures correlate with CurrentWork
without inventing an agent family or attempt. Invocation observations identify
the exact run, and inconclusive observations remain unknown. Native terminal
addressing stays in adapters; existing socket names, run IDs and retained
references remain stable. Old encoded family names are decoded on read without
rewriting stored evidence.

The final Goal Check rows are recorded in CP-9; inspect them with
`px checkpoint read --slug task-2749 --name CP-9`. Final focused checks passed
343 tests with unit headroom, and the declared tmux/presentation integration
pair passed 30 tests. Static analysis, test hygiene, file-size guards and docs
verification passed. Manual isolated process and Chromium checks confirmed
canonical hyphenated family attribution, execution observation, history-read
recovery and paused scrollback while output changes.

DoD #6 is not applicable: this Mission has no bug label. No new review approval
or complete pre-integration gate result is claimed. Review remains stopped;
the operator decides when to restart review and integration.
