# Mission: <Title> (task-2538)

## Goal
Stop Parallix from flickering the `vibe` (mistral family) agent between **blocked** and **unblocked** every hour while the account is genuinely rate-limited for the rest of the month.

Concretely: when the limit-hit classifier (`detectLimitHit` in `src/application/services/agent-limit.ts`) sees a `vibe`/`mistral` rate-limit or quota failure with **no parseable reset time**, the persisted `AgentBlock` must be an `until` block whose `untilMs` is the **end of the current UTC month** (unblocked automatically on the first instant of the next month), not the current 1-hour `DEFAULT_FALLBACK_HOURS` fallback.

## Why Now
Vibe reports `Agent vibe failed to complete (exit 1 (Error: Rate limits exceeded. Please wait a moment before trying again.))`. The current classifier has no reset-time signal for that message, so it writes the `DEFAULT_FALLBACK_HOURS = 1` hour fallback block. Because a monthly quota does not clear in an hour, vibe gets re-blocked an hour later, then re-unblocked, an hour later, an hour later — for essentially the whole month. That churn makes the board show vibe as intermittently available and wastes review/execute cycles re-picking a family that is hard-blocked until month-end. The fix collapses that hourly flicker into a single durable month-long block.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: user-reported flicker; single-service behavioral change in the shared limit-hit classifier; no new dependencies or persistence schema change.

## Scope
- `src/application/services/agent-limit.ts` — `detectLimitHit`: for `agent === 'vibe'` (and the mistral family that owns vibe), when a limit-hit pattern matches and **no** reset time parses, compute `untilMs` as the end of the current UTC month instead of `now + DEFAULT_FALLBACK_HOURS * 60 * 60 * 1000`.
- The block `reason`/`source` must record that the block is month-end (e.g. `source: 'month-end'`, `reason: 'parsed: <pattern>'` or a month-end marker) so operators can distinguish it from the 1-hour fallback.
- The existing `qwen` transient-reroute exception and the `sigint` short-block path are untouched.
- Tests: add cases in `test/limit-hit.test.ts` (unit, `detectLimitHit` returns a block whose `until` lands in the next UTC month for a vibe rate-limit message with no reset time) and, where the end-to-end block-persistence path is covered, `test/agents-limit-hit.test.ts`.
- Docs: update any workflow/behavior note that describes vibe limit-block duration.

## Out of Scope
- Any change to claude, codex, qwen, or generic `custom` family block durations.
- Changing the limit-hit **pattern set** (`PATTERN_SETS`) — the vibe `rate limit exceeded` / `quota exceeded` patterns already match; only the *duration* of the resulting block changes.
- Adding a config knob, feature flag, or new persistence schema. The `AgentBlock.kind === 'until'` / `untilMs` model already supports a month-end timestamp.
- Any web-board / Ink-TUI rendering of the block; the projection (`src/application/projections/agent-status.ts`) already reads `untilMs` and will reflect the new value automatically.
- Re-basing or touching anything outside the agent-limit classifier, its callers, its tests, and behavior-notes docs.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no unmetriced adjectives.

1. A vibe/`mistral` limit-hit message with **no** reset time produces a `detectLimitHit` result whose `until` string resolves to a date/time in the **next** UTC month (never the current month), and the block `source` marks it as a month-end block.
2. The block `untilMs` computed by the classifier falls within the window `(now, endOfCurrentUTCMonth]` for a representative "now" across month boundaries (e.g. now = 2026-09-18T14:00Z → until lands in October; now = 2026-09-30T23:59Z → until lands in October, not November).
3. A vibe message that **does** contain a parseable reset time earlier than month-end still honors that parsed time (month-end logic only applies when no reset time is present).
4. claude, codex, qwen, and `custom` block behavior is unchanged: their fallback remains `now + DEFAULT_FALLBACK_HOURS`, and the qwen transient-reroute exception still returns `{ reroute: true }`.
5. `test/limit-hit.test.ts` includes a failing-at-parent-commit test that asserts the vibe month-end block and passes after the fix; it is registered in `test/lib/test-categories.ts` under the unit tier.
6. `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` both pass on the final tree.
7. No `.only` and no bare `.skip` are introduced anywhere in the test tree.

## Risks and Assumptions
- **UTC vs local month.** Block duration is defined as the end of the *current UTC month*. Assumption: Parallix stores/compares block timestamps in UTC (`untilMs` is epoch ms). Risk if any caller interprets the formatted `until` string in local time for unblock decisions — must confirm the unblock path compares `untilMs` (it does, via `blockedForMs` in `src/domain/agents.ts`).
- **First-of-month edge.** At `00:00:00` on the first of a month the block must flip to the *next* month's end, not the current (just-started) month. The end-of-month computation must be `> now`-guarded so a block written at month rollover does not read as already-expired.
- **Existing fallback tests.** `test/limit-hit.test.ts` has fallback-source assertions (e.g. `result.source === 'fallback'`) that will need updating to `source === 'month-end'` for the vibe/mistral case — leaving them stale would fail the suite.
- **Assumption:** the intended product behavior is "vibe is monthly-quota-blocked", so month-end is the correct horizon; an hourly quota is out of scope and explicitly excluded per Out of Scope.
- **Scope creep risk:** implementer may be tempted to add a per-family config flag. Rejected — no config for a value that never changes (see Out of Scope).

## Checkpoints
- CP 1: Reproduce and confirm the current 1-hour-fallback behavior for a vibe rate-limit message (no reset time) at the parent commit; lock it with a failing unit test in `test/limit-hit.test.ts`.
- CP 2: Implement the month-end block in `detectLimitHit` for the vibe/mistral family and update the affected fallback-source test assertions.
- CP 3: Verify full suite green; run the integration gate; document the behavior change.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/limit-hit.test.ts` ``, `` `./scripts/verify-local.sh all` ``, `` `./scripts/verify-local.sh static-analysis` ``
  2. **Test names** — must match a real test name in the repo, e.g. the new vibe month-end assertion in `test/limit-hit.test.ts`
  3. **Test file paths** — e.g., `test/limit-hit.test.ts`, `test/agents-limit-hit.test.ts` (must be existing test files)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`) and `ADR 0039`
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Concretely: a bare `ls test/` or `node -e "..."` snippet is **not** sufficient proof on its own — it must be accompanied by the exact test name, test file path, or a recognized repo command that re-runs it.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Vibe month-end block behavior is covered by a unit test | `test/limit-hit.test.ts`, `"detectLimitHit blocks vibe for end of UTC month when no reset time parses"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- `src/domain/agents.ts` `selectableAgents`/`blockedForMs` read-only (do not change selection semantics).
- The `PATTERN_SETS` definition in `src/application/services/agent-limit.ts` (do not add/remove patterns).
- claude/codex/qwen/custom block logic and the qwen `reroute` exception.
- Any SQLite blocklist adapter, `AgentBlockService`, or the `untilMs`/`AgentBlock` type shape in `src/domain/agents.ts`.
- Web-board / TUI projection files (`src/application/projections/agent-status.ts`, `mission-board.ts`, `board.ts`).
- Anything under `docs/adr/` other than referencing existing ADRs (do not author new ADRs for this change).

## Stop Rules
- Stop before writing any fix until the reproduction test in `test/limit-hit.test.ts` is red at the parent commit (this is a behavior regression; do not green the suite by weakening the assertion).
- Do not generalize the month-end logic beyond the vibe/mistral family; claude/codex/qwen/custom keep the 1-hour fallback.
- Do not add config, feature flags, new dependencies, or persistence schema changes.
- Do not touch files outside the Scope list; if the fix appears to require it, stop and re-scope rather than expanding silently.
- Do not run anything beyond the two gates above (`./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`); do not run the integration-suite, E2E, or mutation tiers.
- Do not transition the task; the harness moves it to `ready` after a clean draft.
