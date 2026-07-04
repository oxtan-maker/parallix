# CP-4: Add detectLimitHit guard for status === undefined

## Work Done

Modified `detectLimitHit` in `lib/agents/limit-hit.ts` and `lib/agents/limit-hit.js` to remove `typeof status === 'undefined'` from the `launcherFailed` condition. When `status === undefined` (legacy caller path that doesn't pass exit metadata), the detector now returns `null` instead of triggering limit-hit detection. This prevents false-positive blocks from callers that haven't been updated to pass exit status.

Changed from:
```typescript
const launcherFailed =
    error !== null && error !== undefined ||
    signal !== null && signal !== undefined ||
    (typeof status === 'number' && status !== 0) ||
    typeof status === 'undefined';
```

To:
```typescript
const launcherFailed =
    error !== null && error !== undefined ||
    signal !== null && signal !== undefined ||
    (typeof status === 'number' && status !== 0);
```

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | TypeScript guard removed | `lib/agents/limit-hit.ts:208-210` — `launcherFailed` no longer includes `typeof status === 'undefined'` |
| 2 | JS guard removed | `lib/agents/limit-hit.js:224-226` — `launcherFailed` no longer includes `typeof status === 'undefined'` |
| 3 | Comment updated to reflect change | `lib/agents/limit-hit.ts:204-206` — comment now says "return null to avoid false-positive limit-hit blocks from legacy callers" |

## Next action

CP-5: Add regression tests in `test/agents-limit-hit.test.js` for all new non-blocking pattern categories.
