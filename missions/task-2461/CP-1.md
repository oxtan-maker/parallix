# CP-1: Research and ADR

## Summary

Read the four files the mission names (`src/adapters/agents/claude.ts`,
`src/adapters/agents/claude-telemetry.ts`, `src/adapters/process/spawn-tee.ts`,
`src/adapters/agents/pi.ts`) and evaluated the three option classes in the
backlog task's priority order. No production code changed in this checkpoint.

Findings that drive the rest of the mission:

- `spawnAndTee` writes each stdout chunk to `stdoutTail` **first**, then to
  `stdoutSink`. `stdoutSink` is already a public option, so a renderer attached
  there is downstream of telemetry by construction (mission criterion 5).
- The `stdio: 'inherit'` risk in the mission's Risks section is resolved:
  `spawnAndTee` spreads `spawnOptions` and then overrides
  `stdio: ['inherit', 'pipe', 'pipe']` on the `childProcess.spawn` call, so the
  override wins and stdout is pipeable. The stop rule about `inherit` reaching
  the spawn does **not** apply.
- Registry facts gathered for the matrix: `@anthropic-ai/claude-agent-sdk`
  v0.3.263, licence `SEE LICENSE IN README.md`, ~5.0 MB unpacked, no runtime
  deps; `ai` v7.0.93, Apache-2.0, ~7.0 MB unpacked; `@earendil-works/pi-coding-agent`
  v0.85.1, MIT, ~21.9 MB unpacked.
- Decision: hand-rolled, dependency-free renderer on the `stdoutSink` seam.
  Both library options replace the Claude CLI launch (out of scope) and neither
  ships a terminal renderer, so the formatting work is identical either way.

`docs/adr/0056-claude-stream-json-output-rendering.md` records this with a
decision matrix in ADR 0042's column shape
(`Option | Summary | Benefits | Risks / Costs | Fit to constraints | Decision`),
scoring all three option classes with exactly one **Accept** (Option C), and
states explicitly that no runtime dependency is added.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| ADR exists under `docs/adr/` scoring all three researched options with exactly one Accept | `ADR 0056` (`docs/adr/0056-claude-stream-json-output-rendering.md`), "Decision matrix" section — rows A (generalized agent library), B (Claude/Anthropic SDK), C (hand-rolled, **Accept**) | PASS |
| Decision matrix uses ADR 0042's column shape | `ADR 0042` and `ADR 0056` both use `Option \| Summary \| Benefits \| Risks / Costs \| Fit to constraints \| Decision` | PASS |
| ADR states whether a runtime dependency is added | `ADR 0056`, "Decision" section: "**This decision adds no runtime dependency.** `package.json` is unchanged." | PASS |
| ADR is registered in the index | `docs/adr/index.md` line for `docs/adr/0056-claude-stream-json-output-rendering.md`; verify with `grep -n 0056 docs/adr/index.md` | PASS |
| Colour approach inherited rather than re-decided | `ADR 0042` (`util.styleText` for batch/headless output), linked from `ADR 0056` "Links" | PASS |
| Renderer seam keeps the telemetry tail untouched | `src/adapters/process/spawn-tee.ts` — the `child.stdout` `'data'` handler calls `stdoutTail.push(chunk)` before `stdoutSink.write(chunk)`; consumed by `extractClaudeTelemetryFromStdout` in `test/claude.test.ts` | PASS |
| `stdio: 'inherit'` stop rule does not apply | `src/adapters/process/spawn-tee.ts` — `childProcess.spawn` is called with `{ ...spawnOptions, env, stdio: ['inherit','pipe','pipe'] }`, so the literal overrides the spread invocation option | PASS |
| No production code changed in CP-1 | Checkpoint diff touches only `docs/adr/0056-claude-stream-json-output-rendering.md`, `docs/adr/index.md`, `missions/task-2461/CP-1.md` | PASS |

Next action: CP-2 — create `src/adapters/agents/claude-stream-render.ts` with the JSONL line splitter (chunk-boundary safe) and the event normalizer for both envelope shapes, plus `test/task-2461-claude-stream-render.test.ts` covering parsing, byte-split chunk boundaries, and malformed input (mission criteria 6 and 7).
