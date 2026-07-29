# CP-2: Close the inventory-to-domain mapping

## Summary

Resolved every `ADR0053_PERSISTENCE_INVENTORY` entry classified
`database-owned-domain-state` — 41 of them — to exactly one of a named
`src/domain` type with its governing invariant, or an item on an explicit
technical-persistence-metadata list, and added the enumerating test that fails
on an unresolved, doubly-resolved, or unknown-type entry.

Work done:

- Added `src/application/persistence-domain-map.ts`:
  - `DOMAIN_CONCEPT_INVARIANTS` (`:42`) — one invariant per domain concept, each
    citing the `file:line` plus anchor where the invalid state is rejected (for
    example `Mission` → `src/domain/mission.ts:94`, "cannot close before
    integration reports `done`").
  - `TECHNICAL_PERSISTENCE_METADATA` (`:142`) — the four durable values that are
    deliberately not domain entities: SQLite migration ledger identity, import
    source/digest identity, the review-loop stage-launch de-duplication
    fingerprint, and the opaque UI-preferences key/value store. Each states why
    it carries no domain identity, lifecycle, or invariant.
  - `DATABASE_OWNED_STATE_RESOLUTIONS` (`:210`) — 41 resolutions, kept as a
    **list** rather than a record so a double resolution is representable and
    therefore detectable, instead of being silently collapsed by object keys.
- Added `test/persistence-domain-mapping.test.ts` (17 tests). The join between
  the inventory and the resolution list lives in the test because ADR 0051
  forbids `src/application` from importing the runtime module that owns the
  inventory.

### Resolution outcomes worth calling out

- **`ui-prefs-sqlite-read` / `ui-prefs-sqlite-write`** are classified
  `database-owned-domain-state` in the inventory but have no domain type, and
  should not get one: `src/adapters/sqlite/ui-preferences-repository.ts:15` is
  an opaque `(key, value, updatedAt)` store with no validation, no relationship
  to `Mission`, and no production consumer outside its own adapter. Recorded as
  `opaque-operator-setting` technical metadata. The mission stop rule ("matches
  neither a domain type nor technical persistence metadata") was therefore not
  triggered; the inventory classification is left untouched per the restricted
  areas.
- **`artifacts-sqlite-importer-read` / `artifacts-sqlite-migration-read`** are
  schema and import identity — precisely the "migration IDs/checksums and
  idempotent import identities" that ADR 0053 already calls authoritative
  *internal metadata*.
- **`stage-launch-fingerprint`** is on the technical list even though it is not
  its own inventory entry (it lives inside review-state metadata, covered by
  `review-write-review-state` → `Review`). Listing it explicitly is what stops a
  later persistence mission from reading that durable per-launch token as
  evidence that an `Attempt` entity exists.

No inventory entry, production command, or persistence behavior was modified.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every `database-owned-domain-state` entry resolves to a domain type with an invariant or to the technical-persistence-metadata list | `src/application/persistence-domain-map.ts:210`; `"SC1: every database-owned-domain-state entry has a resolution"` | PASS |
| No entry resolves to both / twice | `"SC1: no database-owned-domain-state entry resolves more than once"`, `"SC1 detector bites: a doubly-resolved entry is representable and detected"` | PASS |
| A test fails on an unknown-type entry | `"SC1: every domain-type resolution names a concept exported by src/domain"`, `"SC1 detector bites: an unknown domain type would be rejected"` | PASS |
| The mapping is total against the inventory, not a subset | `"SC1: the resolution list and the database-owned inventory have the same size"`, `"SC1: no resolution names an inventory entry that does not exist or is not database-owned"` | PASS |
| Each named domain type carries a stated invariant with a live source citation | `src/application/persistence-domain-map.ts:42`; `"SC1: every domain-type resolution has a stated invariant"`, `"SC1: every invariant citation points at a line containing its anchor"` | PASS |
| Technical metadata is an explicit, justified list rather than a fallback | `src/application/persistence-domain-map.ts:142`; `"SC1: every technical-metadata item states why it is not a domain entity"`, `"SC1: every technical-metadata citation points at a line containing its anchor"` | PASS |
| Resolution does not contradict the inventory's own concept | `"SC1: a domain-type resolution agrees with the inventory concept it resolves"` | PASS |
| Expressed as checked TypeScript in `src/application`, not documentation | `src/application/persistence-domain-map.ts:1`, typechecked by `npm run typecheck` | PASS |
| CP 2 tests avoid Forgejo, agent launches, and CLI subprocesses | `test/persistence-domain-mapping.test.ts` uses `node:fs` reads only; `npm test -- test/persistence-domain-mapping.test.ts` | PASS |
| Lint and typecheck clean on the new files | `npx eslint src/application/persistence-domain-map.ts test/persistence-domain-mapping.test.ts`, `npm run typecheck` | PASS |
| No SQL, migration, or adapter file added | No file under `src/adapters/sqlite` touched; confirm with `git diff --stat main...HEAD` | PASS |

Next action: implement CP 3 — add the architecture test blocking Attempt-shaped
types, tables, and records under `src/domain`, `src/application`, and
`src/adapters` (with a fixture proving it rejects a real Attempt declaration and
accepts today's tree), amend the `Attempt` row at
`docs/adr/0053-operational-persistence-and-authority-boundaries.md:89` and
`src/domain/README.md:256` to name the locking test, note the outcome on the
2322-wave backlog tasks, and run `./scripts/verify-local.sh all`.
