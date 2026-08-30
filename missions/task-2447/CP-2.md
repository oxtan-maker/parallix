# CP 2 — Transport extension

## Summary

Extended the versioned web transport with the three server-owned card facts, projected one-to-one from `MissionCard`:

- `src/interfaces/web/transport.ts`
  - New wire DTOs `WebPullRequestReference` (six keys, `url` nullable) and `WebReviewRoundSummary` (nine keys).
  - `WebMissionCard` gains `pullRequest` (object or `null`), `reviewApproved` (boolean), and `reviewHistory` (array).
  - `toWebMissionCard` projects all three; every existing field (`checkpoint`, `checkpointDescription`, `nextActionText`, `gate`, `reviewRound`, `reviewPhase`, `reviewDisposition`, …) is unchanged.
  - `checkMissionCard` makes the three keys required and fail-closed: `pullRequest` must be `null` or an object with exactly its six keys and `kind === 'pull-request'`; each `reviewHistory` entry must have exactly its nine keys with a finite `number`. Unexpected keys, wrong types, wrong `kind` tag, and non-finite `number` all produce `invalid-payload` with the field path in `problems`.
  - `WEB_TRANSPORT_VERSION` bumped `1 → 2`; `SUPPORTED_WEB_TRANSPORT_VERSIONS` is `[2]`. A repo-wide grep found no hard-coded v1 wire literal anywhere — `src/interfaces/web/host.ts`, `src/interfaces/web/stream.ts`, and the host/stream tests all reference the constant dynamically, so the bump is mechanical.
- `test/web-transport.test.ts` — five new tests (SC1–SC4) covering round trips for present/absent PR reference, per-field `reviewHistory` round trip including a `disposition: null` round, validator acceptance of the extended payload plus four malformed-card-facts rejections, and `incompatible-client` (not `invalid-payload`) for `transportVersion: 1` on all three validators.

The CP 1 reproduction test is now green. Exact green run:

```text
$ npm test -- test/task-2447-repro.test.ts
✔ wire board card carries pullRequest, reviewApproved, and reviewHistory from the MissionCard (2.44349ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

Focused verification on this tree: `npm test -- test/web-transport.test.ts test/task-2447-repro.test.ts` → 22 pass / 0 fail; `npm test -- test/web-host.integration.test.ts test/web-stream.test.ts` → 36 pass / 0 fail (unmodified); `npm run typecheck` and the test-project tsc clean; ESLint clean on the changed files.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: round trip carries `pullRequest` (present deep-equal, absent `null`); checkpoint and current-round fields unchanged | `test/web-transport.test.ts`, `"snapshot card DTO carries pullRequest, reviewApproved, and reviewHistory through a JSON round trip"`, `"snapshot card DTO keeps pullRequest null when the card has no pull-request reference"` | PASS |
| SC2: `reviewApproved` boolean-equal; `reviewHistory` length and every per-round field equal, incl. `disposition: null` round with non-empty finding/pushback/fix lists | `test/web-transport.test.ts`, `"snapshot card DTO round-trips reviewApproved and every per-round reviewHistory field"` | PASS |
| SC3: validator accepts extended payload; `invalid-payload` with field path for unexpected `pullRequest` key, wrong `kind`, non-finite `reviewHistory[0].number`, non-boolean `reviewApproved` | `test/web-transport.test.ts`, `"snapshot validation accepts the extended card and fails closed on malformed card facts"` | PASS |
| SC4: `WEB_TRANSPORT_VERSION` is 2; v1 rejected as `incompatible-client` by all three validators | `test/web-transport.test.ts`, `"transport version 2 rejects v1 payloads as incompatible clients, not invalid payloads"`; `test/web-host.integration.test.ts` and `test/web-stream.test.ts` pass unmodified (36 pass / 0 fail) | PASS |
| SC7 (green half): reproduction test green after the fix | `test/task-2447-repro.test.ts`, `npm test -- test/task-2447-repro.test.ts` → `pass 1` / `fail 0` (exact output above); red output recorded in `CP-1.md` | PASS |

Next action: add the presentational card component `web/src/mission-card.tsx` (checkpoint indicator, PR line, review round meter — rendered only from received wire DTO fields) and the `renderToString` render tests for full-facts and absent-facts cards, then run `./scripts/verify-local.sh all`.
