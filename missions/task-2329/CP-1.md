# CP-1: Characterization Tests

## Summary
Added focused characterization/rendering tests covering all 8 design-derived TUI capabilities before any feature implementation. Each test documents the current behavior that will change after implementation.

### Data Gaps and Reuse Paths Confirmed

| Capability | Current Path | Required Reuse | Data Gap |
|---|---|---|---|
| SC1 Agent strip | `BoardMetrics.agentAvailability` → `FlowPanel` READ section only | New `AgentStrip` component in `shell.tsx` (justified: shell.tsx > 300 lines) | Session count requires card-agent aggregation (display-only, no new projection) |
| SC2 On-card actions | `MissionCard.commands[]` → `ActionBar` only | Add inline buttons to `MissionCard`, dispatch through `BoardCommandController` | None — `commands` array already projected |
| SC3 WIP limits | `WipCountMetric` has `lane` + `count` only | Add optional `wipLimit?: number` to `WipCountMetric` | No configuration file; use constant until `BoardPreferences` ready |
| SC4 Median cycle | `BoardMetrics.medianCycleTimeByState` → `FlowPanel` only | Pass to `LaneColumn` props, render in header | None — data already flows through projection |
| SC5 Label badge | `MissionCard.labels[]` carried but not rendered | Render `labels[0]` as bordered badge in card header | None — labels already projected |
| SC6 Keyboard shortcuts | `KeyHandler` handles arrows/WASD/f/?/Tab/Enter | Add Ctrl+D/A/R/I handlers, dispatch through `BoardCommandController` | None — `INTEGRATED_CAPABILITIES` maps commands |
| SC7 Shipped collapse | Done lane always full-width | Add `shippedCollapsed` state to `BoardShell`, toggle done lane width | None — layout toggle only |
| SC8 Review details | `MissionCard.flags` + `pullRequest` carried but not displayed | Parse `flags` for review round/blocking findings, render on card | Review round and blocking findings are in `flags` strings, not typed fields |

### New File Justification
- `agent-strip.tsx`: `shell.tsx` is 553 lines (> 300 line threshold). Agent strip has a distinct lifecycle (session aggregation from cards) separate from shell chrome. This satisfies the new-file guardrail.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 agent strip characterization | `test/tui-characterization-cp1.test.ts:61` "BoardShell does NOT render an agent strip between top bar and board" | PASS |
| SC2 on-card actions characterization | `test/tui-characterization-cp1.test.ts:106` "MissionCard does NOT render inline action buttons" | PASS |
| SC3 WIP limits characterization | `test/tui-characterization-cp1.test.ts:153` "LaneColumn renders count only, no WIP limit" | PASS |
| SC4 median cycle characterization | `test/tui-characterization-cp1.test.ts:179` "LaneColumn does NOT render median cycle time in header" | PASS |
| SC5 label badge characterization | `test/tui-characterization-cp1.test.ts:133` "MissionCard does NOT render labels from MissionCard.labels" | PASS |
| SC6 keyboard shortcuts characterization | `test/tui-characterization-cp1.test.ts:207` "navigationKeyForInput does not map Ctrl+D, Ctrl+A, Ctrl+R, or Ctrl+I" | PASS |
| SC7 shipped collapse characterization | `test/tui-characterization-cp1.test.ts:234` "BoardShell does NOT have a shippedCollapsed state" | PASS |
| SC8 review details characterization | `test/tui-characterization-cp1.test.ts:257` "MissionCard does NOT render review round or blocking findings" | PASS |
| SC9 test-before-implementation | `test/tui-characterization-cp1.test.ts:301` "every success criterion has a characterization test in this file" | PASS |
| SC10 TUI file guardrails | `test/tui-characterization-cp1.test.ts:318` "no TUI module exceeds 300 lines except shell.tsx" | PASS |

Next action: Implement agent strip component (SC1) in `src/interfaces/tui/agent-strip.tsx` and integrate into `shell.tsx` between top bar and board area.
