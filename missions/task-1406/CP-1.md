# CP-1: Verify Current Behavior

## Summary

Confirmed that current mistral stats rows show zero/dash values for token metrics and cost. The backlog task description captures the observed behavior from `px stats task-1403`:

```
Phase      Provider   Model                              Implementer  Input   Output  Cached  Tool calls  Duration (min)  Usage %  Cost ($)
execute    mistral    mistral                            mistral      0       0       0       0           22              —        0
```

The root cause: `lib/agents/mistral.ts` never called `extractMistralTelemetry` from `lib/agents/mistral-telemetry.ts`, so `result.telemetry` was always `undefined`. The `telemetryToStatsFields` function in `lib/commands/stats.ts:1692-1710` defaults all fields to 0 when telemetry is null.

No live stats CSV was found on disk, but the task description provides the exact output confirming the bug.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Mistral row shows `0` for input_tokens | Backlog task description, line 17: `mistral ... 0 0 0 0` | Confirmed |
| Mistral row shows `—` for Usage % | Backlog task description, line 17: trailing dash | Confirmed |
| Mistral row shows `0` for Cost ($) | Backlog task description, line 17: trailing `0` | Confirmed |
| `result.telemetry` is undefined in mistral.ts | `lib/agents/mistral.ts:76-81` — no telemetry extraction call | Confirmed |
| `extractMistralTelemetry` exists but unused | `lib/agents/mistral-telemetry.ts:101` — defined, never imported by mistral.ts | Confirmed |

## Next action

Proceed to CP-2: identify exact field mapping requirements between mistral-telemetry output shape and `telemetryToStatsFields` input expectations.
