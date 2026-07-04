# CP-2: Add new non-blocking patterns

## Work Done

Added 36 new regex patterns to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in both `lib/agents/agents.js` and `lib/agents/agents.ts`, organized into 6 new categories (d) through (i):

- **(d) Timeout errors** (4 patterns): `timeout`, `timed out`, `deadline exceeded`, `request timed out`
- **(e) Sandbox/permission-denial non-auth** (5 patterns): `sandbox violation`, `sandbox denied`, `tool call denied`, `action denied`, `approval denied`
- **(f) Provider connectivity** (14 patterns): `EPIPE`, `ETIMEDOUT`, `ENETUNREACH`, `ENOTFOUND`, `EAI_AGAIN`, `socket hang up`, `fetch failed`, `service unavailable`, `gateway timeout`, `overloaded`, `temporarily unavailable`, `please try again`, `retry after`
- **(g) Prompt rejection** (5 patterns): `prompt rejected`, `prompt blocked`, `content policy`, `content filter`, `safety filter`
- **(h) Invocation argument errors** (5 patterns): `invalid argument`, `invalid option`, `invalid parameter`, `missing required`, `argument error`
- **(i) Resource exhaustion** (4 patterns): `out of memory/OOM`, `memory limit`, `context window exceeded`, `token limit exceeded`

Both files edited identically to keep source and compiled output in sync.

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Timeout patterns added to agents.js | `lib/agents/agents.js:138-141` — `/\btimeout\b/i`, `/\btimed\s+out\b/i`, `/\bdeadline\s+exceeded\b/i`, `/\brequest\s+timed\s+out\b/i` |
| 2 | Sandbox patterns added to agents.js | `lib/agents/agents.js:142-146` — `/\bsandbox\s+violation\b/i`, `/\bsandbox\s+denied\b/i`, `/\btool\s+call\s+denied\b/i`, `/\baction\s+denied\b/i`, `/\bapproval\s+denied\b/i` |
| 3 | Connectivity patterns added to agents.js | `lib/agents/agents.js:147-161` — 14 new connectivity patterns |
| 4 | Prompt rejection patterns added to agents.js | `lib/agents/agents.js:162-166` — `/\bprompt\s+rejected\b/i`, `/\bprompt\s+blocked\b/i`, `/\bcontent\s+policy\b/i`, `/\bcontent\s+filter\b/i`, `/\bsafety\s+filter\b/i` |
| 5 | Argument error patterns added to agents.js | `lib/agents/agents.js:167-171` — `/\binvalid\s+argument\b/i`, `/\binvalid\s+option\b/i`, `/\binvalid\s+parameter\b/i`, `/\bmissing\s+required\b/i`, `/\bargument\s+error\b/i` |
| 6 | Resource exhaustion patterns added to agents.js | `lib/agents/agents.js:172-175` — `/\b(out of memory|OOM)\b/i`, `/\bmemory\s+limit\b/i`, `/\bcontext\s+window\s+exceeded\b/i`, `/\btoken\s+limit\s+exceeded\b/i` |
| 7 | TypeScript source synced | `lib/agents/agents.ts:138-175` — identical pattern additions |

## Next action

CP-3: Improve the fallback block reason in agents.js launch-failure path (line ~852) to include first line of stderr as a snippet.
