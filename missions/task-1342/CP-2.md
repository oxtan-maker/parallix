# CP-2: Regression test reproduction

## Goal Check

| Criterion | Status | Notes |
|-----------|--------|-------|
| Weekly count mismatch reproduced in test | PASS | Test at `test/stats.test.js:1435` creates 35 missions (3 user_value, 12 ai_sdlc, 20 unclassified) and verifies `# missions` equals `15` (not `35`) |
| Mixed-agent phase telemetry reproduced in test | PASS | Test at `test/stats.test.js:1488` simulates Claude implementer with OpenAI provider bleed and verifies Usage % shows `—` |
| Invalid classification strings handled | PASS | Test at `test/stats.test.js:1469` verifies `USER_VALUE` normalizes to `user_value` and counts correctly |
| Claude implementer Usage % display verified | PASS | Test at `test/stats.test.js:1529` asserts `—` for claude implementer regardless of provider column |
| `npm test` passes with no new failures | PASS | 1618 pass, 0 fail, 22 skipped (pre-existing) |

## Changes Made

### lib/commands/stats.js
- **Line 556-557**: Changed `userValue`/`aiSdlc` filters to use `normalizeClassification()` instead of raw `===` comparison, so `USER_VALUE` → `user_value` is counted correctly
- **Line 558-561**: Changed `total` to count only missions with valid classifications (`normalizeClassification !== null`) instead of `uniqueMissions.length`, so unclassified/null missions are excluded from the headline total
- **Lines 854-860**: Added claude implementer guard in Usage % display - checks `implementer_agent`/`implementer` for `'claude'` first, returns `—` regardless of what the `provider` column says (fixes telemetry bleed from other agents)

### test/stats.test.js
- **Lines 1440-1458**: Fixed test data dates to all fall within the current week (`20 + i` / `20 + (i % 5)` instead of `18 - i` / `18 - (i % 7)`) so all 35 missions are in the current week window
- **Line 1551**: Fixed array indexing - added `.filter(Boolean)` to split result so trailing whitespace empty string doesn't shift the Usage % column index

## Evidence

Before fix:
```
Current week (2026-06-18 → 2026-06-24)
# missions  # user value missions  # AI SDLC missions  
35          3                      12                  
```
(total = 35, but classified = 3 + 12 = 15 → mismatch)

After fix:
```
Current week (2026-06-18 → 2026-06-24)
# missions  # user value missions  # AI SDLC missions  
15          3                      12                  
```
(total = 15 = userValue + aiSdlc → reconciled)

Before fix (mixed-agent):
```
execute    openai    gpt-5.4  claude       5000   100     4000    10   5   0   0
```
(Claude shown with Usage % = 0 despite having no OpenAI rate-limit data)

After fix (mixed-agent):
```
execute    openai    gpt-5.4  claude       5000   100     4000    10   5   —   0
```
(Claude implementer shows `—` for Usage % regardless of contaminated provider column)
