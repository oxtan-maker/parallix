# CP-3: Handoff NEL capture wired

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| SC4: Actual NEL computed from merge diff at handoff | `lib/commands/handoff.js:224` Step 1.7 calls `captureNelAtHandoff(slug, { rootDir, missionDir, log, error })` which computes `nels.computeNELRecord("${primaryBranch}..HEAD", { cwd: rootDir })` at `lib/commands/handoff.js:290` | PASS |
| SC4: Per-mission record persisted with (predicted bucket, actual NEL, actual bucket, review rounds) | `lib/commands/handoff.js:304-311` writes `nel-record.json` with `slug`, `predictedBucket`, `actualNel`, `actualBucket`, `reviewRounds`, `capturedAt` | PASS |
| SC4: Record survives in repository | `nel-record.json` written to mission directory via `fs.writeFileSync` | PASS |
| SC5: No enforcement, gate, block, or review escalation logic | `lib/commands/handoff.js:280-283` NEL capture is purely observational; no `if NEL > threshold then block/escalate` branches exist | PASS |
| SC5: Verified by code scan | `lib/commands/handoff.js:278-318` `captureNelAtHandoff` function contains no conditional gates, blocks, or escalations | PASS |
| SC3: NEL function excludes all required paths | `lib/core/nels.js:22-31` defines 9 exclusion patterns; `test/nels.test.js` validates all | PASS |
| Handoff NEL capture test coverage | `test/handoff.test.js:919:1` `captureNelAtHandoff writes nel-record.json with predicted bucket, actual NEL, actual bucket, review rounds`; `test/handoff.test.js:960:1` `captureNelAtHandoff reads predicted bucket from MISSION.md Refinement Signals` | PASS |

Next action: CP-4 — Update ADR 0032 and ADR 0036 to replace "% usage" with NEL bucket terminology.
