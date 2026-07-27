# CP 1 — Graphify exclusion inventory and focused fixture

Confirmed that Graphify reads repository `.graphifyignore` patterns during input discovery, before extraction creates graph nodes. Selected the narrow generated-document patterns `missions/**/MISSION.md` and `missions/**/CP-*.md`; this leaves non-document files beneath `missions/` available to the graph. Added a focused fixture with an excluded mission document plus TypeScript source files that retain an import relationship.

The focused test was run before configuration was added and failed only on the expected excluded-document assertion; the retained-source and relationship assertions are ready for the green phase.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Graphify uses an input-time exclusion mechanism | `.graphifyignore:1`, `test/task-2270-graphify-exclusion.test.js:13` | PASS |
| Configuration is limited to generated mission documents | `missions/task-2270/MISSION.md:24` | PLANNED |
| Focused coverage distinguishes excluded content from retained source relationships | `test/task-2270-graphify-exclusion.test.js:13`, `test/fixtures/task-2270-graphify-exclusion/src/consumer.ts:1` | PASS (red until CP 2) |
| Focused validation and repository gate pass | `npm test -- test/task-2270-graphify-exclusion.test.js`, `./scripts/verify-local.sh all` | PENDING |
| Configuration behavior is documented | `docs/operator-setup.md` | PENDING |

Next action: add the two mission-document patterns to `.graphifyignore`, document their effect, and rerun the focused Graphify fixture to establish the green result.
