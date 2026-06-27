# CP-3: Add/update tests for mission-phase telemetry output

## Work Done

Updated `test/integrate.test.js`:

### Existing test updates (added `data: { rows: [] }` to mock returns)

1. **Line 383-396** (existing test "logs the persisted stats row including pr_fix_rounds"): Added `data: { rows: [] }` to `recordIntegrationStatsFn` return value; added assertion for `\|\[INFO\] Mission telemetry by phase: task-2000\|`
2. **Line 421-437** (existing test "records an unknown classification row"): Added `data: { rows: [] }` to mock return
3. **Line 469-482** (existing test "routes stats through PARALLIX_HOME"): Added `data: { rows: [] }` to mock return

### New tests added (after line 506)

4. **"recordPostIntegrationStats prints mission-phase telemetry after weekly stats"** (new): Mocks `recordIntegrationStatsFn` with `data: { rows: [{ mission: 'task-3000', stage: 'draft', ... }, { mission: 'task-3000', stage: 'execute', ... }] }` and asserts:
   - `\|\[INFO\] Workflow stats updated:\|` present
   - `weekly report` present
   - `\|\[INFO\] Mission telemetry by phase: task-3000\|` present
   - `draft` and `execute` phase labels present in output

5. **"recordPostIntegrationStats handles empty mission-phase rows gracefully"** (new): Mocks with `data: { rows: [] }` and asserts:
   - `\|\[INFO\] Workflow stats updated:\|` present
   - `weekly report` present
   - `\|\[INFO\] Mission telemetry by phase: task-4000\|` present
   - `No telemetry rows recorded for mission "task-4000"` present

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Test verifies mission-phase output with rows | `test/integrate.test.js:508-547` — "prints mission-phase telemetry after weekly stats" |
| 2 | Test verifies empty rows handled gracefully | `test/integrate.test.js:549-580` — "handles empty mission-phase rows gracefully" |
| 3 | Empty rows assertion checks for no-crash message | `test/integrate.test.js:577` — `assert.match(combined, /No telemetry rows recorded for mission "task-4000"/)` |
| 4 | Existing tests updated with `data.rows` | `test/integrate.test.js:394` — `data: { rows: [] }`; `test/integrate.test.js:436` — same; `test/integrate.test.js:481` — same |
| 5 | Test assertions use real output patterns | `test/integrate.test.js:543-546` — checks `weekly report`, `[INFO] Mission telemetry`, `draft`, `execute` |

## Next action

Run `npm test` in CP-4 to verify all tests pass end-to-end.
