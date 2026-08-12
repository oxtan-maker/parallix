# Mission: Retire the adapter workflow-sequencing fan-out heuristic (task-2332.16)

## Goal
Remove the `adapter-owned-workflow-sequencing` rule and its
`multiIntegrationFanOutThreshold` count threshold from
`src/adapters/architecture/boundary-guards.ts`, delete the skipped tree-wide
assertion in `test/dependency-graph.test.ts`, and rewrite the affected sections
of `src/adapters/README.md` so the documentation states the truth: the tree is
*not* guarded against adapter-owned workflow sequencing, the outstanding debt is
named and attributed to parent TASK-2332, and the reason the count heuristic was
retired is recorded. After the mission, every rule the architecture guard still
declares must assert zero violations against the production tree, and each
remaining rule must be proven to bite by a hermetic fixture that turns red when
the rule is mutated off.

The mission takes the "retire the rule" branch of the backlog task's fork, not
the "restate and enforce it tree-wide" branch. Re-homing 23 production modules
out of `src/adapters/` is parent-mission work; shipping a guard that is
permanently `test.skip` is a false claim of protection, and removing the claim is
the change that can land honestly inside one mission.

## Why Now
TASK-2332.08 introduced the rule with its production assertion already deferred
to TASK-2332.15. TASK-2332.15 merged and the deferral did not resolve: the rule
still reports 23 production modules, including host-mechanism packages (`git`,
`forgejo`, `verification`, `agents`) that legitimately import three siblings, so
`test.skip('production tree has no adapter-owned workflow sequencing', ...)` in
`test/dependency-graph.test.ts` is still skipped. Two missions have now shipped
`src/adapters/README.md` text asserting that an adapter wiring three or more
sibling packages "fails wherever it sits in the tree" while nothing in CI fails.
Each further mission that reads that README inherits the false claim, and each
one that touches the guard has to re-litigate whether the skip is legitimate.
Closing it now stops a third mission from deferring it again.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: deletion of one guard function, one exported constant, and one
  union member in `src/adapters/architecture/boundary-guards.ts`; deletion of the
  SC3 fixture block plus two production-tree tests in
  `test/dependency-graph.test.ts`; rewrite of three `src/adapters/README.md`
  sections (cross-adapter constraints, enforced-rules table, known outstanding
  debt); mutation-check pass over the four surviving rules.

## Scope
- Delete `multiIntegrationFanOutThreshold`, `findWorkflowOwnershipViolations`,
  and the `'adapter-owned-workflow-sequencing'` member of `ResponsibilityRule`
  from `src/adapters/architecture/boundary-guards.ts`, including its call from
  the `findResponsibilityViolations` aggregate.
- Delete from `test/dependency-graph.test.ts`: the SC3 fixture helper
  `withWorkflowFixture` and its three fixture tests, the skipped
  `'production tree has no adapter-owned workflow sequencing'` test, and
  `'workflow-ownership rule runs against the production tree and reports
  actionable diagnostics'`; drop the now-unused imports.
- Rewrite `src/adapters/README.md`: remove the paragraph claiming a 3-package
  fan-out "fails wherever it sits in the tree", remove the
  `adapter-owned-workflow-sequencing` row and the sample diagnostic block from
  the enforced-rules section, and rewrite "Known outstanding debt" to state that
  multi-integration sequencing under `src/adapters/cli/commands/` and several
  mechanism packages is unguarded, that the count heuristic was retired because a
  fan-out count cannot separate a mechanism using three siblings from a workflow
  sequencer, and that re-homing is tracked by parent TASK-2332.
- Confirm by mutation that each of the four surviving rules
  (`unclassified-production-module`, `cross-adapter-dependency-not-named`,
  `hidden-service-location`, `complete-graph-outside-composition`) still has at
  least one hermetic fixture that turns red when that rule is disabled; add a
  fixture for any rule that has none.
- Update the acceptance-criteria checkboxes in
  `backlog/tasks/task-2332.16 - Replace-the-adapter-workflow-sequencing-fan-out-heuristic-with-an-enforceable-ownership-rule.md`.

## Out of Scope
- Re-homing any production module out of `src/adapters/` into
  `src/application/`, including `src/adapters/cli/commands/integrate.ts` and
  `src/adapters/cli/commands/handoff.ts`.
- Designing or landing a replacement structural ownership invariant (cli-package
  dependence, integration-versus-mechanism classification, collaborator
  construction). Any such rule belongs to a follow-up under parent TASK-2332,
  after the modules it would flag are re-homed.
- Editing `adapterPackageDependencies` or any other cross-adapter dependency
  rule; the named-edge ratchet stays exactly as it is.
- Editing any file under `docs/adr/`.
- Behaviour changes to any adapter, command, or workflow the guard scans.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `grep -rn "multiIntegrationFanOutThreshold\|findWorkflowOwnershipViolations\|adapter-owned-workflow-sequencing" src test` returns no match (matches under `missions/` are historical checkpoint records and are permitted).
- SC2: The `ResponsibilityRule` union in `src/adapters/architecture/boundary-guards.ts` declares exactly these four members: `'unclassified-production-module'`, `'cross-adapter-dependency-not-named'`, `'hidden-service-location'`, `'complete-graph-outside-composition'`.
- SC3: `test/dependency-graph.test.ts` contains no `test.skip`, no `describe.skip`, no `it.skip`, no `.only`, and `npm test -- test/dependency-graph.test.ts` reports zero failures and zero skipped tests.
- SC4: These production-tree assertions survive unchanged and pass: `"production tree has no unnamed cross-adapter dependency"`, `"production tree has no hidden service location"`, and the existing unclassified-module production assertion in `test/dependency-graph.test.ts`.
- SC5: These fixtures survive and pass, proving the four retained rules still bite: `"responsibility scan reports a new unclassified production module with its path and expected owner"`, `"responsibility scan reports a loose module at the src root as unclassified"`, `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"`, `"cross-adapter rules name every adapter package and grant no wildcard"`, `"responsibility guard fails hidden service location in an adapter module"`, `"responsibility guard fails complete-graph construction outside the composition root"`.
- SC6: For each of the four retained rules, CP-2 records a mutation check — the rule's detection disabled in a scratch edit, the named fixture observed red, the edit reverted — with the failing assertion quoted.
- SC7: `src/adapters/README.md` contains no occurrence of `multiIntegrationFanOutThreshold`, no `adapter-owned-workflow-sequencing` row in the enforced-rules table, and no sentence claiming that an adapter wiring three or more sibling packages fails.
- SC8: `src/adapters/README.md` "Known outstanding debt" names `src/adapters/cli/commands/` as unguarded multi-integration sequencing, states that the count threshold was retired because a fan-out count cannot distinguish a mechanism from a workflow sequencer, and attributes re-homing to TASK-2332.
- SC9: No allowlist, grandfather list, path exemption, skip annotation, or per-file exception is introduced anywhere in `src/adapters/architecture/boundary-guards.ts` or `test/dependency-graph.test.ts`.
- SC10: `./scripts/verify-local.sh all` passes on the final tree with the run's summary line captured in the final checkpoint.

## Risks and Assumptions
- Risk: deleting the rule reads as weakening enforcement. Mitigation — SC7/SC8
  require the README to state the tree is unguarded on this axis and to name the
  owner of the remaining work, so the repo claims strictly less than it enforces
  instead of more.
- Risk: `findResponsibilityViolations` or the aggregate-scan tests silently
  depend on the removed rule's output ordering. Assumption verified by SC3 —
  `"aggregate responsibility scan reports every failing rule for one fixture
  tree"` asserts a sorted rule list that already excludes the workflow rule, so
  it should pass unchanged; if it does not, fix the test's expectation, not the
  guard's behaviour.
- Risk: TypeScript exhaustiveness switches elsewhere narrow on
  `ResponsibilityRule`. Assumption — the only consumers are
  `formatResponsibilityViolation` and the tests; the implementer must confirm
  with a repo-wide grep before deleting the union member.
- Assumption: no dependent mission or script imports
  `findWorkflowOwnershipViolations` from
  `src/adapters/architecture/boundary-guards.ts`; the pre-draft grep found
  consumers only in `test/dependency-graph.test.ts` and in historical
  `missions/task-2332.08/CP-*.md` documents, which must not be edited.
- Assumption: the mission worktree needs `npm install` before
  `./scripts/verify-local.sh all` can run.

## Checkpoints
- CP 1: Remove the rule. Delete `multiIntegrationFanOutThreshold`,
  `findWorkflowOwnershipViolations`, the union member, and the aggregate call
  site in `src/adapters/architecture/boundary-guards.ts`; delete the SC3 block,
  the skipped production test, and the production-diagnostics test in
  `test/dependency-graph.test.ts`; drop dead imports. Document SC1, SC2, SC3, SC9
  with `npm test -- test/dependency-graph.test.ts`.
- CP 2: Prove the survivors bite. For each of the four retained rules, disable
  its detection in a scratch edit, run
  `npm test -- test/dependency-graph.test.ts`, record the fixture that went red
  and the quoted failing assertion, then revert. Add a fixture for any rule with
  no red fixture. Document SC4, SC5, SC6.
- CP 3: Tell the truth in the docs. Rewrite the cross-adapter-constraints
  paragraph, the enforced-rules table, and "Known outstanding debt" in
  `src/adapters/README.md`. Document SC7, SC8.
- CP 4: Final gate. Run `./scripts/verify-local.sh all`, tick the acceptance
  criteria in the backlog task file, and produce the full Goal Check table
  covering SC1–SC10.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/dependency-graph.test.ts` ``, `` `./scripts/verify-local.sh all` ``, or `` `git grep -n multiIntegrationFanOutThreshold src test` ``
  2. **Test names** — e.g., `"production tree has no unnamed cross-adapter dependency"` or `"responsibility guard fails hidden service location in an adapter module"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/dependency-graph.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. "I checked and the constant is gone" or a bare `ls src/adapters/architecture/` is not evidence for SC1 — pair it with the `git grep` command above and its empty output, plus the test file path.
- For SC6 specifically, each mutation-check row must name the rule mutated, the exact fixture test name that turned red, and quote the failing assertion line; a claim that "the fixtures still cover it" without a red observation fails the criterion.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — no reference to the retired rule remains in src or test | `git grep -n "multiIntegrationFanOutThreshold\|findWorkflowOwnershipViolations\|adapter-owned-workflow-sequencing" src test` returns no lines; `src/adapters/architecture/boundary-guards.ts`, `test/dependency-graph.test.ts` | PASS |
| SC5 — cross-adapter rule still bites | `"cross-adapter guard rejects a prohibited direct import between unnamed adapter packages"` in `test/dependency-graph.test.ts` passes under `npm test -- test/dependency-graph.test.ts` | PASS |
| SC10 — verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `npm test -- test/dependency-graph.test.ts`
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `docs/adr/` — no ADR may be created, edited, or superseded by this mission.
- `adapterPackageDependencies` and every other rule in
  `src/adapters/architecture/boundary-guards.ts` besides the workflow-sequencing
  rule being retired.
- All of `src/adapters/` except `src/adapters/architecture/boundary-guards.ts`
  and `src/adapters/README.md`; in particular
  `src/adapters/cli/commands/integrate.ts` and
  `src/adapters/cli/commands/handoff.ts` must not be touched.
- `missions/task-2332.08/` and every other prior mission's checkpoint documents.
- No allowlist, grandfather list, path exemption, skip annotation, or `.only`
  may be added to `test/dependency-graph.test.ts`.

## Stop Rules
- Stop and report if removing `'adapter-owned-workflow-sequencing'` from the
  `ResponsibilityRule` union breaks a consumer outside
  `src/adapters/architecture/boundary-guards.ts` and
  `test/dependency-graph.test.ts` — that consumer changes the scope decision.
- Stop and report if any of the four retained rules has no fixture that can be
  turned red by mutating it off and writing one requires editing production code
  outside the two in-scope files.
- Stop and report if `./scripts/verify-local.sh all` fails for a reason not
  traceable to this mission's diff (compare against the mission's parent commit
  before claiming baseline red).
- Stop if the work starts to require re-homing a production module out of
  `src/adapters/`; that is parent TASK-2332 scope, not this mission.
- Do not resolve any tree-wide guard failure by adding an exemption, a skip, or a
  threshold bump; retiring the rule outright is the only sanctioned relaxation.
