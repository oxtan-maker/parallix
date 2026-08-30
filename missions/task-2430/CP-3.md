# CP-3: No adapter/network/UI in diff, verifier green, goal-check evidence

## Summary

Confirmed the mission diff is limited to the transport contract and its
tests, ran both verifiers to green on the final tree, refreshed the
knowledge graph, and completed the evidence table below.

Diff check against the mission baseline commit `ddf9191fa` (the backlog
"transition to active" commit, stated explicitly as a non-HEAD baseline):

```
git diff --name-status ddf9191fa..HEAD
A  docs/adr/0055-web-board-transport-contract.md
M  docs/adr/index.md
A  missions/task-2430/CP-1.md
A  missions/task-2430/CP-2.md
A  src/interfaces/web/transport.ts
A  test/web-transport.test.ts
```

- No changes to `src/interfaces/web/host.ts`, `security.ts`, any route,
  `src/adapters/`, the `web/` prototype, or `src/interfaces/tui/`
  (verified: `git diff --name-only ddf9191fa..HEAD -- <those paths>` is
  empty).
- No changes to lifecycle, attention ranking, liveness derivation, lane
  rules, capability registry, or action-eligibility code; the converter
  reuses `projectMissionActivity`, `isIntegratedCapability`, and
  `unavailableReason` unchanged.
- No new dependencies; `src/interfaces/web/transport.ts` imports only
  application read models and the capability-registry helpers.
- The backlog task file
  `backlog/tasks/task-2430 - Define-a-versioned-JSON-safe-web-board-transport-contract.md`
  is untouched (not in the diff); its status/labels/metadata are
  unchanged, and no `px active`/`px review`/`px integrate` lifecycle
  command was run by this mission.
- Static-analysis gate fixed one test-typecheck gap found during this
  checkpoint (branded `MissionId` casts and a narrowing gap in
  `test/web-transport.test.ts`); both gates re-ran green afterwards.

## Verifiers on the final tree

- `./scripts/verify-local.sh all` — PASS (exit 0): docs check clean,
  full unit suite `2239 tests / 2239 pass / 0 fail`, including all 16
  `test/web-transport.test.ts` tests; unit-test budget within the 1,000 ms
  per-test cap.
- `./scripts/verify-local.sh static-analysis` — PASS (exit 0): ESLint,
  `tsc` typecheck, test-hygiene, and test typecheck all clean.
- `graphify update .` — graph refreshed after the code change.

## Application fact → wire representation (final table)

| Application fact | Wire representation | Covering test in `test/web-transport.test.ts` |
|---|---|---|
| `blockedForMs === Infinity` | `{ "kind": "indefinite" }` — never wire `null`, never an unknown duration | `indefinite agent block projects to a dedicated indefinite wire representation, never null` |
| `blockedForMs` finite | `{ "kind": "finite", "ms": <n> }` | same test |
| `runningSessions` absent / `null` / `0` / `n` | key omitted / `null` / `0` / `n` — four distinct wire states | `running sessions distinguish unobserved, observed-none, and a positive count`; `unattributed running sessions keep the same three-state encoding` |
| work freshness `live` / `unverified` / `stale` | `activity.work.certainty` `live` / `unknown` / `stale` (certainty `live` only on kind `working`) | `mission work activity preserves live, unconfirmed, stale, blocked, and idle liveness` |
| no work + blocking reason / no work | `{ kind: 'blocked', reason }` / `{ kind: 'idle' }` | same test |
| `liveSession` absent / `null` / session | coordinator `{ state: 'unknown' }` / `{ state: 'stopped' }` / `{ state: 'live', family }` | `coordinator evidence distinguishes unknown, stopped, and live` |
| kind not integrated | action `{ state: 'unavailable', reason }` — server-owned registry reason | `action DTO distinguishes an unavailable action from an ineligible action` |
| integrated, lane-ineligible | action `{ state: 'ineligible', reason }` — server-owned lane reason | same test |
| integrated, eligible | action `{ state: 'enabled', reason: null }` + exact display text | `enabled action DTO carries null reason and exact display text`; `attention action keeps the server-owned display text and state` |
| optional absent vs nullable `null` | key omitted vs `null`, preserved through the round trip | `snapshot DTO round-trips through JSON.stringify and JSON.parse without losing shape`; `progress event DTO is versioned and validated` |
| `ApplicationOutcome.error` / unsafe `value` | `{ kind, message }` only; `Error`/`Set`/`Map`/function/`Symbol`/`BigInt`/non-finite/`undefined`-dependent value rejects the result | `command result wire error carries kind and message only, never a stack`; `command result conversion rejects an arbitrary thrown object as value`; `command result conversion rejects non-finite values and keeps safe ones` |
| unknown projection version / unsupported transport version | converter throws `unsupported-projection-version`; validator returns explicit `incompatible-client` state | `unsupported projection version is rejected before conversion`; `unsupported transport version is rejected as an incompatible client` |
| whole snapshot | JSON-safe: objects, arrays, strings, booleans, finite numbers, `null` only; `JSON.stringify`/`JSON.parse` round trip deep-equal | `snapshot DTO round-trips through JSON.stringify and JSON.parse without losing shape` |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 JSON-safe versioned snapshot | `test/web-transport.test.ts` — test `"snapshot DTO round-trips through JSON.stringify and JSON.parse without losing shape"` (round trip + recursive walker asserting only finite JSON types); `npm test` runs it in the default suite | PASS |
| SC2 indefinite block is a dedicated wire representation, never `null` | `test/web-transport.test.ts` — test `"indefinite agent block projects to a dedicated indefinite wire representation, never null"`; mapping table row 1 | PASS |
| SC3 unknown/unobserved vs observed-none vs 0, and live/unconfirmed/stale/blocked/idle liveness | `test/web-transport.test.ts` — tests `"running sessions distinguish unobserved, observed-none, and a positive count"`, `"unattributed running sessions keep the same three-state encoding"`, `"mission work activity preserves live, unconfirmed, stale, blocked, and idle liveness"`, `"coordinator evidence distinguishes unknown, stopped, and live"` | PASS |
| SC4 server-owned action DTO: typed kind, exact display, enabled state, unavailable reason; no client-side capability/lane evaluation | `test/web-transport.test.ts` — tests `"action DTO distinguishes an unavailable action from an ineligible action"`, `"enabled action DTO carries null reason and exact display text"`, `"attention action keeps the server-owned display text and state"`; registry reused from `src/application/controller/board-command.ts`, unchanged | PASS |
| SC5 versioned/validated command-result + progress; no stack traces or thrown objects; explicit incompatible-client state | `test/web-transport.test.ts` — tests `"command result conversion rejects an arbitrary thrown object as value"`, `"command result conversion rejects non-finite values and keeps safe ones"`, `"command result wire error carries kind and message only, never a stack"`, `"unsupported transport version is rejected as an incompatible client"`, `"progress event DTO is versioned and validated"` | PASS |
| SC6 pure conversion, focused unit tests, no HTTP server/adapter/route/UI added | `test/web-transport.test.ts` — test `"conversion is pure: the source projection is not mutated and the output is deterministic"`; `git diff --name-status ddf9191fa..HEAD` (baseline `ddf9191fa`) shows only `src/interfaces/web/transport.ts`, `test/web-transport.test.ts`, ADR 0055 + index, and checkpoint docs — no host/route/adapter/React file touched | PASS |
| SC7 `./scripts/verify-local.sh all` succeeds on the completed mission tree | `./scripts/verify-local.sh all` exit 0 on this tree (2239/2239 tests pass); `./scripts/verify-local.sh static-analysis` exit 0 (ESLint, tsc, test-hygiene, test typecheck) | PASS |
| Durable contract rationale recorded | ADR 0055 (`docs/adr/0055-web-board-transport-contract.md`), indexed in `docs/adr/index.md`; `./scripts/verify-local.sh docs` passes | PASS |
| Backlog task preserved, lifecycle metadata untouched | `backlog/tasks/task-2430 - Define-a-versioned-JSON-safe-web-board-transport-contract.md` absent from `git diff --name-only ddf9191fa..HEAD`; no `px active`/`px review`/`px integrate` invoked | PASS |

Next action: mission complete — all checkpoints committed, all mission-declared gates pass; Parallix may transition TASK-2430 for review (the `review` remote push and integration are owned by Parallix, not this mission).
