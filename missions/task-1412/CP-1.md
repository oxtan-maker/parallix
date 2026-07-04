# CP-1: Audit NON_BLOCKING_LAUNCH_ERROR_PATTERNS gaps

## Work Done

Audited existing `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `lib/agents/agents.ts:113-137` against observed mistral/codex failure modes from the debug log showing `"reason": "exit 1"` for both agent families.

### Existing patterns (covered)

| Category | Patterns | Coverage |
|----------|----------|----------|
| Model errors | invalid/unknown/unsupported model, model identifier invalid, model not found | Covers misconfigured model IDs |
| Auth errors | auth, unauthorized, forbidden, api key | Covers credential failures |
| CLI flags | unknown option, unsupported flag/option | Covers bad invocation flags |
| File system | read-only file system, home/bootstrap errors, permission denied | Covers HOME dir issues |
| WebSocket | failed to connect to websocket, connection refused, ECONNREFUSED, os error 1 | Covers WS failures |
| Provider reachability | provider endpoints unreachable, reachability, endpoint unreachable | Covers provider downtime |
| Generic OS | os error \d+ | Covers generic OS errors |

### Gaps identified (caused "exit 1" blocks)

| Gap | Observed symptom | Missing pattern | New pattern added in CP-2 |
|-----|-----------------|-----------------|--------------------------|
| Timeout errors | Agent exits with timeout after waiting for provider | No timeout pattern | `(d)` timeout, timed out, deadline exceeded, request timed out |
| Sandbox violations | Codex sandbox policy blocks execution | No sandbox pattern | `(e)` sandbox violation, sandbox denied, tool call denied, action denied, approval denied |
| Broad connectivity | EPIPE, ENOTFOUND, socket hang up, etc. | Only ECONNREFUSED covered | `(f)` EPIPE, ETIMEDOUT, ENETUNREACH, ENOTFOUND, EAI_AGAIN, socket hang up, fetch failed, service unavailable, gateway timeout, overloaded, temporarily unavailable, please try again, retry after |
| Prompt rejection | Provider rejects prompt content | No content policy pattern | `(g)` prompt rejected, prompt blocked, content policy, content filter, safety filter |
| Argument errors | Invalid CLI arguments passed to agent | No argument pattern | `(h)` invalid argument, invalid option, invalid parameter, missing required, argument error |
| Resource exhaustion | Agent runs out of memory/context | No resource pattern | `(i)` out of memory/OOM, memory limit, context window exceeded, token limit exceeded |

### Inline comments added

Category labels `(d)` through `(i)` were added as inline comments adjacent to the pattern array in `lib/agents/agents.ts:138-179`, mapping each gap to its new pattern group.

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Audit mapped each observed failure to a missing pattern | `missions/task-1412/CP-1.md:30-35` — table mapping 6 gaps to specific new patterns |
| 2 | Inline comments added adjacent to pattern array | `lib/agents/agents.ts:138-179` — category labels `(d)` through `(i)` |
| 3 | Audit informed CP-2 pattern additions | `missions/task-1412/CP-2.md` — all 6 categories from CP-1 audit implemented |

## Next action

CP-2: Add new non-blocking patterns to NON_BLOCKING_LAUNCH_ERROR_PATTERNS covering all identified gaps.
