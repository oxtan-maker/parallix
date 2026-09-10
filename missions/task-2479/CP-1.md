# CP-1 — Integration replay inventory

## Summary

Classified every line the current first-value recording emits between the typed
`px integrate` and the shell prompt that follows it. The source is the committed
recording `docs/assets/first-value-demo.cast` (rendered to plain text by
stripping the ANSI control sequences from its `"o"` events), so the inventory
describes real observed output rather than a reconstruction.

The integration phase of that cast contains 59 output lines. Each is classified
as **decision** (evidence the human needs to authorize landing), **progress**
(what the command is doing now), **diagnostic** (implementation detail useful
only when something is wrong), **analytics** (reporting that belongs on an
analytical surface), or **anomaly** (malformed or misleading output).

### Inventory

| # | Observed line (abridged) | Class | Emitter | Disposition |
|---|---|---|---|---|
| 1 | `[INFO] Integration preflight for parallix-adhoc-0001` | progress | `printIntegrationPreflight` (`src/adapters/cli/commands/integrate.ts`) | replace with a readiness header (CP-2) |
| 2 | `[PASS] Mission branch: mission/parallix-adhoc-0001` | decision | `printIntegrationPreflight` | keep as the `Mission` readiness row |
| 3 | `[PASS] Mission doc: /tmp/.../MISSION.md` | diagnostic | `printIntegrationPreflight` | demote to `fmt.log.debug` |
| 4 | `[PASS] Backlog task: none — adhoc mission, Mission store is authoritative` | diagnostic | `printIntegrationPreflight` | demote — DB/backlog authority wording (Success Criterion 3) |
| 5 | `[PASS] Mission classification: unknown` | diagnostic | `printIntegrationPreflight` | demote; the check itself must not weaken |
| 6 | `[PASS] Backlog status follows the Mission lifecycle (integration); promotion happens at closeout` | diagnostic | `evaluateTaskStatusForIntegration` via `printIntegrationPreflight` | demote |
| 7 | `[INFO] Forgejo PR/approval checks skipped (review provider is not forgejo).` | diagnostic | `printIntegrationPreflight` | demote — provider-disabled plumbing (Success Criterion 3) |
| 8 | `[PASS] Integration checkout branch: /tmp/... is on main` | decision | `printIntegrationPreflight` | fold into the `Target` readiness row |
| 9 | `[PASS] Integration checkout conflicts: no unresolved merge entries in the git index` | decision | `printIntegrationPreflight` | fold into the `Workspace` readiness row |
| 10 | `[PASS] Integration checkout dirty state: clean` | decision | `printIntegrationPreflight` | fold into the `Workspace` readiness row |
| 11 | `[WARN] Backlog context: does not resolve to /tmp/...` | anomaly | `printIntegrationPreflight` | genuinely misleading on the happy path: the cast is recorded from the mission worktree, which is the supported invocation; keep the check, stop presenting it as a warning when the closeout target resolves |
| 12 | `[INFO] Forgejo configuration: allow_manual_merge assumed enabled` | diagnostic | `printIntegrationPreflight` | demote; unconditional even when Forgejo is off |
| 13 | `[WARN] Integration warnings: backlog-context` | anomaly | `printIntegrationPreflight` | consequence of #11 |
| 14 | `[INFO] Variant B automation: Backlog task closeout, worktree-path rewrite, squash commit ...` | diagnostic | `VARIANT_B_AUTOMATION_SUMMARY` | demote |
| 15 | `[INFO] Integration gate target: slug=... root=... commit=... tree=... requirePreIntegration=false` | diagnostic | `integrate.ts` gate block | demote |
| 16 | `Repository gates (integration): none configured — skipping.` | progress | `src/adapters/config/repository-gates.ts` | keep — a gate line the operator needs (Success Criterion 8); restricted area, presentation only |
| 17 | `[INFO] Integration gates for ...: none configured and adapters.gates.requirePreIntegration is not set — proceeding without a lifecycle gate.` | decision | `integrate.ts` gate block | keep — states that no gate ran, which the trust decision depends on |
| 18 | `[INFO] Moving process directory to /tmp/... before mission worktree deletion.` | diagnostic | `integrate.ts` | demote |
| 19 | `[INFO] Selecting integration variant: Variant B (local squash-merge)` | diagnostic | `integrate.ts` | demote |
| 20 | `[INFO] ` (empty) | anomaly | leading `\n` in the `Step 1` message | removed with the Step lines (Success Criterion 13) |
| 21–26 | `[INFO] Step 1..6: ...` | progress | `integrate.ts` | replace with one landing progress line (CP-3/CP-4, Success Criterion 11) |
| 27 | `[INFO] Workflow stats recorded: parallix-adhoc-0001: implementer=claude, ...` | diagnostic | `recordPostIntegrationStats` (`src/adapters/cli/commands/integrate-post.ts`) | demote; the recording itself stays (Success Criterion 6) |
| 28 | `[INFO] Workflow stats updated:` + weekly report body (Mission flow, Agent telemetry, Agent performance, Agent spend by stage, previous-week comparison) | analytics | `recordPostIntegrationStats` | remove from the success path; already available from `px stats` (Success Criterion 4) |
| 29 | `[INFO] Mission telemetry by phase: ...` + phase table | analytics | `recordPostIntegrationStats` via `renderMissionPhaseReport` | remove from the success path (Success Criterion 5) |
| 30 | `[INFO] Step 7: Cleaning up the local mission worktree...` | progress | `integrate.ts` | restate as an unnumbered cleanup result (Success Criterion 11) |
| 31 | `[INFO] No existing graphify graph found. Skipping knowledge graph update.` | diagnostic | `src/adapters/filesystem/mission-graphify.ts` | silence on the ordinary success path (Success Criterion 12) |
| 32 | `[PASS] Integration completed successfully.` | decision | `integrate.ts` | keep, but carry the destination branch and SHA transition (Success Criterion 10) |
| 33 | `[INFO] ` (empty) | anomaly | leading `\n` in `nextActionMessage` | remove (Success Criterion 13) |
| 34 | `[INFO] Next: cd /tmp/...` | progress | `integrate.ts` `finally` block | keep |

### Consequences carried into CP-2..CP-4

- **Missing from the cast entirely:** review approval, reviewer identity,
  independence (agent family), and the landed SHA transition. Criteria 2 and 10
  are additions, not just deletions. Approval authority is the Mission store
  review / Forgejo decision (`ADR 0053`, `ADR 0048`); verification authority is
  the integration gate result (`ADR 0041`).
- **Demotion mechanism:** `fmt.log.debug` already exists in
  `src/application/presentation/cli-format.ts` and is gated on `DEBUG`, so no
  new flag or dependency is needed for the diagnostics above.
- **Nothing in the inventory requires touching gate logic**, the
  `decideIntegration`/`close` path, or `px stats` — the mission's Restricted
  Areas hold, and no stop rule is triggered.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every integration line of the real recording is classified | `docs/assets/first-value-demo.cast` (integration phase, 59 output lines between the typed `px integrate` and the following prompt); inventory table above | PASS |
| Classification uses the five mission-declared classes | Mission checkpoint CP 1 in `missions/task-2479/MISSION.md`; `Class` column values decision/progress/diagnostic/analytics/anomaly | PASS |
| Each line is attributed to a real emitter in the tree | `src/adapters/cli/commands/integrate.ts`, `src/adapters/cli/commands/integrate-post.ts`, `src/adapters/config/repository-gates.ts`, `src/adapters/filesystem/mission-graphify.ts` | PASS |
| Analytics dumps to remove are identified in their emitting function | `recordPostIntegrationStats` in `src/adapters/cli/commands/integrate-post.ts`; existing coverage `test/integrate.test.ts` | PASS |
| Trust evidence still to be added is named with its authority | `ADR 0041` (integration pipeline gates), `ADR 0048` (fail-closed harness defense), `ADR 0053` (operational persistence and authority boundaries) | PASS |
| Demotion mechanism already exists; no new flag needed | `fmt.log.debug` in `src/application/presentation/cli-format.ts` (returns null unless `DEBUG` is set) | PASS |

Next action: implement CP-2 — replace the `printIntegrationPreflight` PASS/INFO cascade in `src/adapters/cli/commands/integrate.ts` with a `READY TO INTEGRATE` evidence view (Mission / Review / Reviewer / Independence / Verification / Target / Workspace), demoting inventory rows 3–7, 12, 14, 15 to `fmt.log.debug` while leaving every failure branch loud.
