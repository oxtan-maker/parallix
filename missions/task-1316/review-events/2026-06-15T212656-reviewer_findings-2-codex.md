---
event_type: reviewer_findings
timestamp: 2026-06-15T21:26:56.256Z
round: 2
phase: reviewing
actor: codex
slug: task-1316
---

# Review Findings: task-1316 attempt 2

## 1. High: `npm test` fails because the new export timeout tests are cancelled

The new timeout path in `captureOpencodeExport` schedules the hard timeout and immediately calls `timer.unref()` (`lib/agents/opencode-export.js:73-78`). In the unit tests, the injected fake child is only an `EventEmitter`, so there is no ref'ed child-process handle keeping Node alive. The test runner drains the event loop before the unref'ed timer can fire, leaving the awaited Promise pending and cancelling the test.

Evidence:
- `node --test test/opencode-export.test.js test/opencode-launcher-telemetry.test.js test/opencode-telemetry.test.js test/telemetry-stubs.test.js` exits non-zero.
- Cancelled tests include `captureOpencodeExport times out and kills a non-exiting export child` at `test/opencode-export.test.js:30` and `startOpencodeAgent does not hang when the real export capture times out` at `test/opencode-launcher-telemetry.test.js:54`.
- Full `npm test` also exits non-zero with `pass 1526`, `fail 0`, `cancelled 7`, `skipped 22`.

This fails mission success criterion 1 and criterion 7. Keep the timeout test deterministic, for example by not unref'ing injectable-test timers, by making timer unref configurable, or by making the fake child hold a real ref'ed handle until killed.

## 2. Medium: CP-4 Goal Check still cites stale and incorrect evidence

`missions/task-1316/CP-4.md` prose says the round-1 findings were fixed with `captureOpencodeExport`, durable fixture tests, and `toolCalls: 59` (`missions/task-1316/CP-4.md:31-63`). But the actual Goal Check table still cites `/tmp/opencode-export.json` and the removed `maxTailBytes` implementation (`missions/task-1316/CP-4.md:91-98`), including `toolCalls: 0` earlier in the document (`missions/task-1316/CP-4.md:11-20`).

The review contract explicitly requires the final checkpoint document to contain a Goal Check table citing real evidence such as file:line and test names. This table currently contradicts the implementation and does not cite the new test evidence it claims in prose.

## 3. Medium: unrelated workflow configuration was changed

The diff removes `adapters.agents.models.codex = "gpt-5.4"` from `workflow.config.json` even though the mission scope is limited to opencode telemetry extraction and launcher/stat verification. This changes reviewer/agent model routing behavior outside the stated telemetry work and is not explained by the mission.

Unless this was an intentional separate workflow change with its own mission, restore it or document why it belongs to task-1316.

## 4. Workflow inconsistency: required commands/guidance are still unavailable

The requested root `AGENTS.md` is absent. The exact required command `px review task-1316 --verify` is also unavailable on `PATH`; I ran the repository-local equivalent `node px.js review task-1316 --verify`. That verifier started `npm test`, reached the same cancelled-test state, and then remained alive for more than two minutes until its process tree was terminated. The mission's original gate `./scripts/verify-local.sh docs` is still referenced in `MISSION.md`, but `scripts/verify-local.sh` does not exist; `workflow.config.json` now uses `npm test` instead.

Per the review instructions, these workflow inconsistencies are reported rather than repaired.

---
`[workflow-round:2, workflow-phase:reviewing]`