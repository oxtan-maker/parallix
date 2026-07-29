# CP-4: Remove duplicated persistence resolutions

## Summary

Removed the copied inventory-entry-to-domain-concept table from
`persistence-domain-map`. The executable ADR 0053 inventory already owns each
entry's id and concept, so the persistence check now resolves those concepts
through the same checked catalog used by consumer requirements. Only the four
entries that are deliberately technical persistence metadata remain explicit
exceptions.

The consumer and persistence maps remain separate because they prove different
facts: current consumers justify which domain information is needed, while the
persistence map attaches invariants or technical-metadata decisions to the
inventory. No hygiene code changed; the reported annotated-skip failure was the
real `/tmp` inode guard, and it passed after the external inode cleanup.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every database-owned inventory entry resolves to a domain invariant or explicit technical metadata | `src/application/persistence-domain-map.ts:45`, `src/application/persistence-domain-map.ts:202`, `src/application/persistence-domain-map.ts:219`; `"SC1: every database-owned-domain-state entry has a resolution"` | PASS |
| Persistence does not duplicate the executable inventory's domain entry mappings | `src/application/consumer-domain-requirements.ts:50`, `src/application/persistence-domain-map.ts:195`; `"SC1: technical resolutions do not shadow checked domain concepts"` | PASS |
| All six consumer families and all nine checked concepts remain covered | `src/application/consumer-domain-requirements.ts:62`; `"SC2: the mapping covers exactly the six declared families"`, `"SC2: all nine ADR 0053 domain concepts are read by a traced consumer"` | PASS |
| Consumer citations still resolve and detect source drift | `test/domain-consumer-requirements.test.ts`; `"SC3: every consumer citation points at a line containing its anchor"` | PASS |
| The excluded `Attempt` decision remains locked | `test/domain-attempt-guard.test.ts:115`; `"SC4: no Attempt-shaped type, table, or record under src/domain, src/application, or src/adapters"` | PASS |
| No schema, migration, import, command cutover, or runtime behavior was added | `git diff --stat`; changed implementation files are limited to the two checked maps and their focused tests | PASS |
| Focused domain tests pass without Forgejo, agents, or expensive subprocesses | `./node_modules/.bin/tsx --test test/domain-consumer-requirements.test.ts test/persistence-domain-mapping.test.ts test/domain-attempt-guard.test.ts` — 37 passing tests | PASS |
| Static analysis and hygiene pass | `./scripts/verify-local.sh static-analysis` — ESLint, production typecheck, hygiene, and test typecheck passed | PASS |
| Final repository verification passes | `./scripts/verify-local.sh all` — 1,484 tests passed | PASS |
| Code graph reflects the final source | `graphify update .` — 14,059 nodes and 15,923 edges | PASS |

Next action: return TASK-2322.02 to review/ready-for-integration with the
deduplicated checked mapping as the input to TASK-2322.03.
