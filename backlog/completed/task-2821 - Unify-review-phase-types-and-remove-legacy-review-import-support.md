---
id: TASK-2821
title: Unify review phase types and remove legacy review import support
status: done
assignee: [codex]
created_date: '2026-10-25'
labels:
  - ai_sdlc
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Complete the review model cleanup left unfinished by previous migration and
policy-extraction missions. Review phase rules now share a domain table, but
the live loop and persistence contracts still accept arbitrary strings and
carry overlapping state representations. Domain normalization repairs typos
such as `rewiewing` and guesses workflow phases from disposition. Different
paths reject, normalize or default the same invalid input. TASK-2668.07 moved
the old adapter normalization into the domain without finishing this cleanup.

Use one canonical review phase vocabulary and domain transition authority.
Trace existing owners and production callers before changing contracts;
reuse the Review aggregate and existing application workflow rather than
introducing a parallel state model. Make normal application and persistence
contracts carry checked phases. Consolidate overlapping representations
where their contracts match; retain a projection only when it serves a
distinct consumer contract, without giving it independent transition rules.
Remove unsafe casts, arbitrary-string escape hatches, redundant aliases,
typo repair and disposition-based phase guessing associated with this path.
Phase and disposition remain distinct concepts.

Remove `src/adapters/review/review-legacy-import.ts` and all support for its
historical review-state and exported-event imports. Delete its public flags,
handlers, ports, composition wiring, re-exports and callers, including calls
from broader legacy mission import workflows. There must be no replacement
legacy review importer, renamed compatibility implementation or retained
backfill shim. Migrate still-needed live behavior to its existing application
owner before deleting shared code; in particular, distinguish current
interrupted-handoff recovery from historical file import. Audit the adjacent
flat-state compatibility mappers and obsolete review-state file handling,
and finish removing superseded code and redundant tests left by the earlier
cutover rather than merely moving it elsewhere. Unrelated mission import
behavior is outside scope except where it calls the removed review support.

Validate CLI syntax at the interface boundary and provider/storage data at
their respective adapters. Keep legal state transitions enforced by the
domain and workflow sequencing owned by the application. Invalid phase data
must produce a structured failure rather than inventing a phase or approval.
The CLI renders failures and exit codes; it is not the only external boundary.
Preserve current database-backed review, persisted valid history, independent
review, concurrency protections, restart behavior and human integration
authority. This task authorizes removal of historical review-file import
support, not deletion or mutation of existing operator data.

Update help and live documentation to remove the retired support. Preserve
historical task records as history. Follow existing architecture and operator
gate ownership; do not introduce gates or increase CPU budgets. Coordinate
overlapping review-entry cleanup with TASK-2810.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 One canonical phase vocabulary and one domain transition authority serve all production review callers; normal loop and persistence contracts use checked phase types rather than arbitrary strings. Remaining state projections have distinct consumer contracts and no competing transition policy.
- [x] #2 Normal review paths contain no phase typo aliases, disposition-based phase guessing or invalid-phase defaults. CLI, provider and persistence boundaries reject malformed input through structured failures without manufacturing workflow progress or approval.
- [x] #3 review-legacy-import.ts is deleted. Historical review-state.json and Markdown review-event import/backfill support, flags, handlers, ports, wiring, re-exports and callers are removed, including callers in broader mission import; no compatibility shim or replacement importer remains.
- [x] #4 Production callers use existing current workflow owners before superseded implementations are removed. Obsolete flat-state compatibility and file-handling code and redundant tests are deleted; distinct behavioral assertions remain. Current interrupted-handoff recovery and valid database history remain supported without historical-file import.
- [x] #5 Existing review start/resume, request changes, implementer response, approval, invalid transition rejection, concurrent decisions and restart safety retain their contracts. No path silently repairs corrupt phase state, grants approval or bypasses human integration authority.
- [ ] #6 Extend the owning suites with meaningful typed-boundary, invalid-state and removed-surface coverage; run focused contract checks and required unit headroom without changing gates, tier membership or budgets. Manually exercise current CLI composition end to end with isolated Git/database fixtures and safe boundary doubles, preserving real operator data and statistics.
- [x] #7 Help and live documentation describe only supported current behavior; mission evidence identifies migrated callers and removed implementations without adding a live implementation inventory. Unavailable verification remains explicitly pending.
<!-- AC:END -->

## Work log

- 2026-10-25: Created manually at the operator's request after source and history
  investigation. The Backlog CLI cannot run on this Mac because its binary
  requires an unavailable macOS system symbol. ID allocated from this checkout;
  reconcile with the main computer's backlog before intake. No implementation
  changes, live Mission creation or operator database writes performed.

- Historical contract audit (2026-10-25): `330a6a080`, TASK-2322.12
  `missions/task-2322.12/CP-2.md`, deliberately retained the database-backed
  ReviewState view and CAS retry while removing file authority. TASK-2377.04
  (`a382e8307`) removed persisted retry budgets, preserving historical counters
  and launch deduplication. TASK-2385 (`0bd0ad9ae`) protected stale writes and
  explicitly retained equal/higher round behavior. TASK-2378 (`98455d22b` and
  its task record) required real decision timestamps and approval lifecycle
  persistence before Backlog promotion. TASK-2582 (`1222c1a5a`) supplied the
  authoritative round-open boundary and required failed approval transitions
  to stop success reporting. These historical files are available through Git.
- The operator explicitly retires historical review-file imports. The live flat
  view is retained and typed. Approval/round-write removals require caller
  convergence and preserved behavior through recordApproval and the existing
  round-open/domain advancement owners; the historical contracts above are
  not being discarded. Preserve PR identity, stale-decision protection,
  decision times, CAS retry, stage-launch deduplication and human stops.

- Implementation: canonical phases are derived from the runtime vocabulary;
  loop/persistence/event contracts use that domain type. The live ReviewState
  view remains, implementing the loop contract and sharing the domain transition
  assertion. Invalid values produce validation failures; reads do not turn bad
  phases into missing Reviews. Positional writer compatibility, repair metadata
  and unused Git-era persistence outcomes are removed. CAS retry uses the
  existing typed stale-write discriminator rather than error-name matching.
- Caller convergence: normal CLI verdict submission, configured single-family
  approval and polled reviewer approval delegate to the existing decision
  recorder. Observed round number/start time are checked there before mutation;
  replay preserves the original decision and lifecycle timestamp. Bookkeeping
  cannot create decisions or round shells. Existing round-open/domain
  advancement owns subsequent rounds; stale lower-round rejection and the
  equal/higher-round monotonicity assertions remain, with higher rounds first
  opened through the domain. Classifier decisions retain their separate existing
  domain/application owner and are replayed without rewriting provenance.
- Removal: deleted review-legacy-import.ts, historical state/event backfill,
  --backfill-review, its handler/operation/port/composition bindings, broader
  mission-import review and launch-history readers, and the read-adapter
  fallback that invented a Review from flat state. Deleted dead event-file
  frontmatter/filename utilities and import-only assertions. Current explicit
  interrupted-handoff reconciliation now belongs to the application review
  entry owner. Read-only archived snapshot accounting remains in the audit;
  it cannot restore workflow state and is not a replacement importer.
- Distinct conversation-rendering assertions now exercise database events
  through the read adapter/projection/status renderer in the renamed existing
  status-history suite. Retired import-only discovery/budget entries were
  removed; the renamed suite retains its former tier and CPU limits. All retained
  suite budgets are unchanged. No operator gate, architecture exception or
  schema migration was added or changed.
- Verification: `npm run typecheck` passed. Focused ESLint passed for changed
  production files after removing redundant guards on the already-checked
  decision read. The focused delivery run passed 111 assertions, including
  canonical-phase rejection, structured persistence failures, stale-round and
  stale-observation protection, reviewer independence, approval-before-mirror,
  current recovery, CLI flag rejection and file caps. The focused persisted-write
  failure check also passed. Additional owning recovery, projection, event and
  history checks passed during implementation; superseded failing expectations
  were migrated to the current owners, not skipped.
- Manual end-to-end: `/tmp/task2821-manual.ts` reused the existing production CLI
  lifecycle rehearsal with an alternate TypeScript loader required on this Mac.
  Real pinned child verdict/resolve CLIs and isolated Git/SQLite observed
  review -> active -> review -> integration across two rounds, then stopped for
  human integration. A separate observed-provider approval committed through
  the same recorder, replay emitted no duplicate lane event, and a stale
  observation was rejected. Agent/provider boundaries were doubles; no real
  provider traffic or operator data/statistics were used. Fixtures were cleaned
  up. Evidence: `/tmp/task2821-manual-final.log`. Executed source was HEAD
  `439ace9b0` plus the production diff; SHA-256 of `git diff --binary HEAD -- src`
  is `93b954acd0f5fc71d4488e5bc443d5bc740760c4e4b903d59f198a787bd8ab62`.
- Pending supported-platform certification: `npm test -- --unit-test-headroom`
  cannot start because esbuild requires the unavailable macOS
  `_SecTrustCopyCertificateChain` symbol. Temporary-loader behavioral results
  do not certify official unit headroom, the shipped bundle or integration
  timing within 3.5 seconds. No budgets were relaxed. Test-wide TypeScript
  checking reports exactly the same nine diagnostics as a detached starting-HEAD
  comparison (normalized file/error diagnostics matched); there are no additional
  task-induced test-type errors. The temporary baseline worktree was removed.
  AC #6 remains pending for normal runner/timing certification on the main
  computer. Implementation is ready for review, not marked done or integrated.

- Review follow-up (2026-10-26): Reproduced all three reported regressions
  before applying their fixes. The self-author approval reached an illegal
  event write; the provider request/fix path failed opening round 2; the
  observed approval aborted on its first concurrent write.
- Approval now checks the canonical phase rule before self-author recording,
  and the authoritative domain approval command enforces the same rule for
  independent callers. Fixing without a decision cannot approve or change lanes.
- Provider request/fix observations retain actual findings, revision, text and
  source timestamps. Application polling routes them through the existing
  decision/resolution owners before implementation and next-round work.
  Artifact and CLI submissions retain their own recording path. No round shells,
  phase inference or historical import support was restored. The unchanged
  revision rejection remains in the resolution owner.
- Automatic observed writes retry one typed stale-write failure, with the
  observed round number and start rechecked on each read. Concurrent unrelated
  events succeed on retry; round resets and exhausted retries fail without an
  approval. Explicit caller version checks retain their fail-closed contract.
- Follow-up verification: production typecheck and changed-production ESLint
  passed. Focused recovery/round checks passed 51 tests; domain, approval and
  file-cap checks passed 68; provider lookup/evidence checks passed 3. The
  retained request/fix/round-2 regression passed alone in about 30 ms using the
  temporary TypeScript loader. The test-wide typecheck still has exactly the
  same nine normalized baseline diagnostics. No verification gates or retained
  CPU budgets changed. Official headroom, bundle and integration timing
  certification remain pending on a supported machine; AC #6 stays open.
- Manual follow-up: the isolated production CLI rehearsal passed again, using
  real pinned child verdict/resolve commands. A provider continuation rehearsal
  used production state ports with disposable SQLite/Git and provider/agent
  doubles: request changes -> recorded fix -> round 2 -> approval produced
  exactly review -> active -> review -> integration, preserving provider decision
  and response times. Approval replay/stale-observation checks passed too.
  No provider traffic or operator data/statistics were touched; fixtures were
  cleaned. Evidence: `/tmp/task2821-followup-manual.log`.
- Follow-up production fingerprint: `2c755f3178ff5dc12b49f2dfb6adde2a3c48ff8462a13d250c27996b7cc767ac`
  (SHA-256 of the tracked binary source diff followed by each sorted untracked
  source path, NUL and file bytes). Supersedes the earlier source-diff hash for
  this follow-up. Changes remain uncommitted on `mission/task-2821`, ready for
  review with supported-platform certification pending.

- Second review follow-up (2026-10-26): Retained focused red reproductions for
  approval A being recorded against HEAD B, and an interrupted request-changes
  decision resuming implementation while the Mission remained in review.
- Provider polling now returns the observed review with its commit ID, body and
  submission time. The adapter translates that observation to typed facts;
  round-local approval evidence reaches the existing approval recorder intact.
  Provider approval never fills a missing revision with HEAD or a missing
  submission time with the clock. Missing revision stays unverifiable; missing
  observation/time fails. Replay uses the existing stored judgment unchanged.
- Requested-changes recording now settles its lifecycle boundary on replay,
  using the stored decision time and idempotency key. Continuation settles a
  recorded decision before implementation even when the provider has no new
  result. An unfinished or unavailable lane transition remains a failure;
  duplicate lane events and replacement decisions are not introduced. Local
  continuation uses the same owner; dry-run does not settle writes.
- Verification: the owning round suite and file-cap checks passed 16 tests;
  nearby application/recovery/independence/store checks passed 115 tests; focused
  polling/evidence checks passed 6 tests; final changed recovery/start/round checks
  passed 48 tests. Production typecheck and changed-production ESLint passed.
  Test-wide typechecking matched exactly the nine baseline diagnostics.
  New checks cover source revision/time, stale B coverage, missing evidence,
  replay, interrupted continuation, original phase/retry regressions, and exact
  review -> active -> review -> integration events. Existing polling assertions
  now check the retained observation, preserving their wait/progress/timeout
  assertions. No gates, tiers or budgets changed.
- Manual final rehearsal: disposable real Git commits A and B plus SQLite and
  production polling/state ports retained approval A/time while coverage of B
  was stale; replay preserved A. A failed request-changes lane write resumed,
  implemented, opened round 2 and approved with exactly the expected lane events.
  The real pinned child CLI verdict/resolve cycle also passed again. Provider and
  agent boundaries used doubles; no real provider, operator data or statistics
  were used. All disposable rehearsal fixtures were removed. Evidence:
  `/tmp/task2821-second-review-manual-final.log`.
- Official focused headroom was attempted again and could not start: esbuild
  requires the unavailable macOS `_SecTrustCopyCertificateChain` symbol.
  Temporary-loader results do not certify official headroom, the bundle or
  integration timing. AC #6 remains open; status remains review.
- Current production fingerprint: `96c57433ab76c40d9c239582f75f36808713409546724600f68b275831ebd3cc`,
  using the tracked-source-diff plus sorted untracked-source-bytes method above.
  Supersedes the earlier fingerprints for this follow-up. Changes remain
  uncommitted on `mission/task-2821`; review-legacy-import remains removed.
