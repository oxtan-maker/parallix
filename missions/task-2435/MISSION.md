# Mission: Add truthful mission activity, attention, flow and operation visuals (task-2435)

## Goal
Make the operator read-side UI describe mission activity, attention, FLOW metrics, review state, and operation progress only from their authoritative projected facts, without turning secondary evidence or missing telemetry into confident visual claims.

## Why Now
TASK-2434 provides the prerequisite projection work. This mission completes the operator-facing read path so animation, rankings, charts, review detail, and logs communicate what the system knows rather than what the client can guess.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: authoritative current-work states; separate coordinator recovery evidence; projected attention and review data; FLOW provenance and health; bounded SSE operation history; reduced-motion accessibility.

## Scope
- Drive mission activity animation and textual state from projected `currentWork`/mission-activity facts, distinguishing live, unconfirmed, stale, blocked, and idle work.
- Keep coordinator/session/process observations separately labelled as recovery evidence and prevent them from asserting a running agent without authoritative current work.
- Preserve agent-family availability, blocked, countdown, px-command liveness, unknown-versus-zero, and unattributed-evidence semantics in the family strip.
- Render attention items in the server-projected order using the projected reason and action without client-side reranking or command selection.
- Render FLOW, cycle, throughput, and bottleneck views from projected metrics, provenance, sample-size, and health data; represent unavailable history without synthetic points or summaries.
- Use dedicated projected review round, phase, disposition, and blocking fields where supplied.
- Consume SSE operation progress in a bounded log that deduplicates entries across reconnects.
- Honor `prefers-reduced-motion` by removing decorative motion while retaining a clear textual activity state.

## Out of Scope
- Changing mission lifecycle, coordinator, px-process, review, or metric projection semantics beyond the fields required for truthful read-side rendering.
- Creating synthetic historical telemetry, inferred agent counts, client-side attention ranking, or automatic remediation commands.
- Replacing the supplied GPU/fan visual treatment with a new visual language.
- Unbounded event retention, persistent operation-log storage, or a new telemetry pipeline.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Mission cards animate only when projected current work is live; unconfirmed work is visibly uncertain, and stale, blocked, and idle work have no active-running treatment.
- A live coordinator or session with no authoritative current work cannot render a running-agent fan or spinner; its recovery evidence remains separately labelled.
- The agent-family strip distinguishes available, blocked, countdown, px-command liveness, unknown, zero, and unattributed evidence without equating px process totals to agents.
- Attention rows preserve server order and use the server-projected reason and action, with no client ranking calculation or command choice.
- FLOW, cycle, throughput, and bottleneck views display projected values together with the applicable provenance, sample-size, and health state; unavailable history produces no fabricated chart points, medians, or weekly throughput.
- Review UI uses projected round, phase, disposition, and blocking fields when provided rather than parsing display flags to reconstruct them.
- SSE operation progress is retained to a documented hard bound and reconnecting does not create duplicate log entries.
- With `prefers-reduced-motion`, decorative animation is disabled and the textual activity state remains sufficient to distinguish live, unconfirmed, stale, blocked, and idle work.
- Automated coverage exercises all activity and coordinator combinations, reduced-motion behaviour, metric health cases, and bounded reconnecting operation-log behaviour; `./scripts/verify-local.sh all` succeeds.

## Risks and Assumptions
- Assumes TASK-2434 exposes stable projected facts for current work, attention, metrics, review detail, and operation progress; missing fields must be shown as unavailable or uncertain rather than inferred.
- The supplied GPU/fan variant is the approved pixel target; visual comparison may reveal integration details not expressed in the projection schema.
- SSE events need a stable identity or equivalent deduplication key; if none exists, stop before inventing one in the client.
- The operation-log bound must preserve the most useful recent progress while making eviction behavior explicit and testable.

## Checkpoints
- CP 1: Trace the projection-to-UI paths for mission activity, coordinator evidence, agent families, attention, metrics, review detail, and operation SSE; document the authoritative field for each visual claim and the existing test locations to extend.
- CP 2: Implement and test truthful activity, coordinator-evidence, agent-family, attention, and reduced-motion rendering against the supplied GPU/fan treatment.
- CP 3: Implement and test projected FLOW/metric health and review-detail rendering without synthetic history or display-flag reparsing.
- CP 4: Implement and test the bounded, reconnect-safe SSE operation log; run the mission verification gate and record goal-check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done that cites exact test names, ADR references, test file paths, or recognized repository commands/paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`; file:line references are accepted but discouraged because line numbers rot.
- The exact heading `## Goal Check` followed by the 3-column table `| Criterion | Evidence | Status |`.
- At least one durable evidence row for every success criterion, using the references above; raw `stat`/`ls` output or generic prose alone is not enough and must be paired with an accepted reference.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter the mission lifecycle or workflow orchestration contract outside the read-side projections needed by this mission.
- Do not change the server's projected attention order, reason, action, metric provenance, health, sample-size, or review semantics to compensate for UI gaps.
- Do not add synthetic telemetry, client-side agent inference, fabricated charts, or persistent/unbounded operation-log storage.
- Preserve accessibility semantics and the supplied GPU/fan visual treatment while changing activity presentation.

## Stop Rules
- Stop and request direction if TASK-2434 does not expose an authoritative field needed for a visual claim; do not derive it from lane, assignee, PR, session, or process presence.
- Stop and request direction if SSE progress has no stable identity or documented ordering sufficient to deduplicate reconnects safely.
- Stop and request direction if matching the supplied GPU/fan treatment requires replacing the established UI system or changing unrelated product behavior.
- Stop before adding synthetic metrics or historical points when the projection reports partial, unavailable, no-telemetry, or no-completions data.
