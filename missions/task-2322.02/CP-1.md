# CP-1: Trace consumers to domain information

## Summary

Traced the six consumer families named in the mission (launch, retry, failover,
usage/statistics, review, UI/board) to the domain information each one actually
reads, and expressed the result as checked TypeScript rather than prose.

Work done:

- Added `src/application/consumer-domain-requirements.ts`: 22 traced consumer
  entries, each with the consumer family, a repo-relative `file:line` citation
  into checked production source, a source **anchor** substring, the domain
  concepts it reads, the information it requires, and how far its notion of
  "this particular launch" travels (`perLaunchIdentity`).
- Made the concept names type-checked rather than stringly-typed:
  `DomainConceptName` is `keyof DomainConceptTypes`, a witness interface built
  from the real imported `src/domain` types
  (`src/application/consumer-domain-requirements.ts:29`). Renaming or deleting a
  domain type breaks `tsc` here.
- Recorded the CP 1 branch decision as checked data
  (`PER_LAUNCH_IDENTITY_DECISION`, `src/application/consumer-domain-requirements.ts:386`)
  so CP 3 cannot switch branches silently.
- Added `test/domain-consumer-requirements.test.ts`: 11 tests asserting family
  coverage, that every named concept is exported by `src/domain`, that every
  cited file exists, that every cited line still contains its anchor (a
  drift-detecting improvement on plain file-existence checking), and that the
  recorded decision matches its own evidence.

The module is data and types only: no IO, no runtime behavior, and no
production command imports it. No launch, retry, failover, review, or
statistics behavior changed.

### Attempt branch decision

**Attempt is NOT required; CP 3 implements the not-required branch** (an
architecture test that blocks Attempt-shaped types, tables, and records under
`src/domain`, `src/application`, and `src/adapters`).

Consumer evidence:

- `src/platform/runtime/lib/agents/agents.ts:198` — retry/failover bookkeeping
  (`tried`, `agentErrors`, `launched`, `iteration`) are local variables of one
  `startAgent` call. They are never persisted and never re-read, so no consumer
  can ask "which attempt was that".
- `src/platform/runtime/lib/agents/agents.ts:502` — a successful launch writes
  **one replaceable** `SessionMarker` per (mission, role); it does not append a
  launch history row.
- `src/domain/session.ts:30` — `shouldResume` compares only mission, role, and
  agent family, so a failover to another family discards prior-launch state
  rather than tracking it.
- `src/platform/runtime/lib/agents/agent-config.ts:159` — the durable
  consequence of a limit hit or crash is an `AgentBlock` keyed by agent family
  alone, with no launch, mission, or session key.
- `src/platform/runtime/lib/commands/stats.ts:108` and `:441` — measurement rows
  carry no launch or attempt column and are grouped by `(repo, mission)`.
- `src/platform/runtime/lib/review/review-loop.ts:63` — the one durable
  per-launch value in the tree is `stageLaunchFingerprint`, an opaque
  de-duplication token kept in review-state metadata and capped at the last 20
  per stage window. Nothing resolves it back to a launch; it is technical
  persistence metadata (idempotent record identity), not an entity with
  identity, lifecycle, or relationships. CP 2 records it on the explicit
  technical-persistence-metadata list.

No consumer demanded identity or lifecycle that `Mission`, `SessionMarker`,
`AgentRunMeasurement`, `AgentBlock`, or `Review` does not already carry, so the
mission's stop rule for an ambiguous Attempt case was not triggered.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A checked consumer-requirement mapping covers all six consumer families | `src/application/consumer-domain-requirements.ts:103`, `"SC2: the mapping covers exactly the six declared families"` | PASS |
| Each family names domain concepts among the nine ADR 0053 concepts | `"SC2: all nine ADR 0053 domain concepts are read by a traced consumer"` in `test/domain-consumer-requirements.test.ts` | PASS |
| A test fails if a family is missing | `"SC2: every consumer family has at least one traced consumer"` | PASS |
| A test fails if an entry names a concept that does not exist in `src/domain` | `"SC2: every concept named by a consumer is exported by src/domain"`; type-level witness at `src/application/consumer-domain-requirements.ts:29` | PASS |
| Every consumer entry cites a `file:line` in checked production source and a test asserts the file exists | `"SC3: every consumer fileLocation resolves to an existing file"` (same pattern as `"SC6: inventory fileLocation references resolve to existing files"` in `test/persistence-inventory-guardrail.test.ts`) | PASS |
| Citations cannot silently drift off their line | `"SC3: every consumer citation points at a line containing its anchor"`, `"SC3 detector bites: a wrong line number is reported as drift"` | PASS |
| The `Attempt` branch decision is explicit and evidence-backed | `PER_LAUNCH_IDENTITY_DECISION` at `src/application/consumer-domain-requirements.ts:386`; `"SC4: the Attempt branch decision cites existing consumer entries"`, `"SC4: no consumer requires durable per-launch identity while Attempt is excluded"` | PASS |
| No launch/retry/failover/review/statistics behavior changed | New files only: `src/application/consumer-domain-requirements.ts`, `test/domain-consumer-requirements.test.ts`; confirm with `git diff --stat main...HEAD` | PASS |
| CP 1 tests run without Forgejo, an agent launch, or a CLI subprocess | `test/domain-consumer-requirements.test.ts` reads source with `node:fs` only; `npm test -- test/domain-consumer-requirements.test.ts` | PASS |
| Typecheck and lint clean on the new files | `npm run typecheck`, `npx eslint src/application/consumer-domain-requirements.ts test/domain-consumer-requirements.test.ts` | PASS |

Next action: implement CP 2 — add `src/application/persistence-domain-map.ts`
resolving each of the 41 `database-owned-domain-state` entries in
`ADR0053_PERSISTENCE_INVENTORY` to either a named `src/domain` type plus its
invariant or the explicit technical-persistence-metadata list (which must
include the `ui-prefs-sqlite-*`, `artifacts-sqlite-importer-read`,
`artifacts-sqlite-migration-read`, and `stageLaunchFingerprint` items), and add
the enumerating test that fails on an unresolved, doubly-resolved, or
unknown-type entry.
