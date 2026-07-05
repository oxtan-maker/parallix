# CP-2: Spend Aggregation Contract

## Work Done

Confirmed the spend aggregation contract is defined in code comments and implemented in the helper functions. The contract specifies:

### Metric Families (per `classifyAgentSpendFamily` at `lib/commands/stats.ts:949`)

| Agent Family | Stored Field | Display Unit |
|---|---|---|
| Codex / OpenAI-backed | `openai_usage_after` | percentage (e.g. `20%`) |
| Claude / Anthropic | `cost_usd` | dollars (e.g. `$1`) |
| Mistral | `cost_usd` | dollars (e.g. `$1`) |
| Custom / local-model / unrecognized | `duration_minutes` | minutes (e.g. `5m`) |

### Stage Alias (per `AGENT_SPEND_STAGE_COLUMNS` at `lib/commands/stats.ts:930`)

| Stored Stage | Display Column |
|---|---|
| `draft` | `draft` |
| `active` | `execute` |
| `review` | `review` |
| `follow-up` | `follow-up` |
| `default` | `default` |

### Cell Formatting (per `formatAgentSpendCell` at `lib/commands/stats.ts:1016`)

- Empty state (total = 0): renders `—`
- Usage cell: `<value>% (<share>%)` — e.g. `20% (20%)`
- Cost cell: `$<rounded> (<share>%)` — e.g. `$1 (10%)`
- Duration cell: `<value>m (<share>%)` — e.g. `5m (10%)`

### Tests (in `test/stats.test.js`)

Six tests at lines 490-563 cover the contract:
- Column layout verification (line 490)
- Codex aggregation from `openai_usage_after` with stage `active` → `execute` (line 500)
- Claude aggregation from `cost_usd` (line 515)
- Custom aggregation from `duration_minutes` (line 528)
- Model-name grouping parity with "Agent performance this week" (line 541)
- Empty-state rendering for zero spend (line 555)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Codex/OpenAI uses `openai_usage_after` | `lib/commands/stats.ts:996` — `family === 'usage'` branch reads `openai_usage_after` |
| Claude uses `cost_usd` | `lib/commands/stats.ts:997` — `family === 'cost'` branch reads `cost_usd` |
| Custom/local uses `duration_minutes` | `lib/commands/stats.ts:998` — default branch reads `duration_minutes` |
| Stage `active` displayed as `execute` | `lib/commands/stats.ts:932` — `{ stage: 'active', label: 'execute' }` |
| Contract tested for all three families | `test/stats.test.js:500`, `test/stats.test.js:515`, `test/stats.test.js:528` |

## Next action: CP-3 — Implement the current-week spend table
