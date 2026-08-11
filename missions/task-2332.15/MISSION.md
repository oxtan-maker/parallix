# Mission: Finish CLI interface migration and certify command ownership (task-2332.15)

## Goal
Move the six remaining command interfaces (active, setup, verify, config, diff, resolve-conflict) from `src/adapters/cli/commands/` into `src/interfaces/cli/`, delete all migration-specific compatibility facades and transitional re-exports, update application and CLI documentation to cross-reference ADR 0051, and pass the full verification surface. Leave the tree ready for TASK-2332.08 responsibility-guard certification.

## Why Now
TASK-2332.09 through TASK-2332.14 completed orchestration-heavy command re-homing. The six remaining commands are already compliant — their application-layer dependencies are extracted through ports. This is the final TASK-2332 convergence step before TASK-2332.08 certifies the responsibility guard against the completed tree.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: interface files for 6 commands, facade deletion, create-cli.ts import updates, README edits. Pattern established by prior 8-command migration (checkpoint, draft, handoff, integrate, rebase, review, runtime, status already in `src/interfaces/cli/`).

## Scope
- Create interface files under `src/interfaces/cli/` for: active, setup, verify, config, diff, resolve-conflict. Each file owns CLI parsing, typed request/response types, and result rendering (exit-code mapping).
- Update `src/composition/create-cli.ts` imports so the six commands reference `src/interfaces/cli/` paths.
- Delete any migration-specific compatibility facade or transitional re-export in `src/adapters/cli/commands/`, `src/interfaces/cli/`, and `src/application/` modules.
- Update `src/application/README.md` and `src/interfaces/README.md` to describe responsibilities and cross-reference ADR 0051.
- Run `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` on the final tree.

## Out of Scope
- TASK-2332.08 responsibility-guard certification (follows this task).
- Modifying adapter implementations in `src/adapters/cli/commands/` beyond facade/re-export deletion.
- Adding new application-layer ports or use cases.
- SQLite authority cutover (ADR 0053).
- Web board or Ink UI implementation.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `src/interfaces/cli/` contains files `active.ts`, `setup.ts`, `verify.ts`, `config.ts`, `diff.ts`, `resolve-conflict.ts` — each exports a parsing function and a render function for its command's CLI request/response cycle.
- SC2: `src/composition/create-cli.ts` imports the six commands from `../interfaces/cli/` paths, not `../adapters/cli/commands/` paths.
- SC3: No file under `src/adapters/cli/commands/`, `src/interfaces/cli/`, or `src/application/` contains a migration-specific compatibility facade or transitional re-export (identified by comments containing "migration", "facade", "transitional", or bare `export { X } from` statements that solely forward an export from one layer to another).
- SC4: `src/application/README.md` describes application-layer responsibilities and contains a reference to ADR 0051.
- SC5: `src/interfaces/README.md` describes interface-layer responsibilities and contains a reference to ADR 0051.
- SC6: `./scripts/verify-local.sh all` exits 0 on the final tree.
- SC7: `./scripts/verify-local.sh static-analysis` exits 0 on the final tree (ESLint + tsc --checkJs + test-hygiene).
- SC8: No workflow command or migration facade remains outside its declared owner — every command in `src/composition/create-cli.ts` resolves to a module in its canonical layer (`src/interfaces/cli/` for interface contracts, `src/adapters/cli/commands/` for adapter implementations).

## Risks and Assumptions
- The six commands' application-layer dependencies are fully extracted through ports (assumed from TASK-2332.09–.14 completion). If a command still imports application services directly in its interface portion, the interface file must parse/render only and delegate to the adapter.
- Migration facades are limited to comment-annotated patterns ("architecture migration", "facade", "transitional re-export") in the three target directories. Unannotated facades may exist but are low risk given the established migration pattern.
- Dependencies TASK-2332.09 through TASK-2332.14 are integrated. If any is still in-flight, this task blocks.
- `test/dependency-graph.test.ts` layer rules already permit `src/interfaces/` → `src/application/` → `src/domain/`. No layer rule changes needed.

## Checkpoints
- CP 1: Inventory six command interfaces and their current adapter imports. Document which parsing/rendering logic each command exports. Verify no hidden coupling beyond the established pattern.
- CP 2: Create `src/interfaces/cli/active.ts`, `setup.ts`, `verify.ts`, `config.ts`, `diff.ts`, `resolve-conflict.ts`. Move parsing and rendering functions. Update `src/composition/create-cli.ts` imports. Run `./scripts/verify-local.sh all`.
- CP 3: Delete migration facades and transitional re-exports across `src/adapters/cli/commands/`, `src/interfaces/cli/`, and `src/application/`. Update `src/application/README.md` and `src/interfaces/README.md` with ADR 0051 cross-reference. Run `./scripts/verify-local.sh static-analysis`. Final Goal Check table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/interfaces/cli/active.ts:24` (must point to an existing file and line)
  2. **Test names** — e.g., `"dependency graph validates interfaces layer imports without unallowlisted violations"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/dependency-graph.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `./scripts/verify-local.sh static-analysis` ``, `` `node --test test/dependency-graph.test.ts` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| `active.ts` interface file created with parse and render exports | `src/interfaces/cli/active.ts:15`, `src/interfaces/cli/active.ts:42` | PASS |
| `create-cli.ts` imports active from interfaces/cli | `src/composition/create-cli.ts:11` | PASS |
| Migration facades deleted from adapters/cli/commands | `src/adapters/cli/commands/active.ts` (no facade comments remain) | PASS |
| Application README references ADR 0051 | `src/application/README.md:8` | PASS |
| Verification gate passes | `` `./scripts/verify-local.sh all` `` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `src/application/` services and ports — do not modify use-case logic, port contracts, or service implementations. Only edit `src/application/README.md`.
- Adapter implementations in `src/adapters/cli/commands/` — do not change command behavior or orchestration logic. Only delete facade files and transitional re-exports.
- `test/dependency-graph.test.ts` — do not modify layer rules.
- `src/domain/` — out of scope.

## Stop Rules
- Stop if a command's interface cannot be cleanly separated from its adapter (parsing/rendering entangled with orchestration). Investigate coupling before proceeding.
- Stop if `./scripts/verify-local.sh all` fails after interface files are created — fix import wiring before continuing to facade deletion.
- Stop if TASK-2332.09–.14 dependencies are not all integrated. Block until resolved.
- Do not start TASK-2332.08 responsibility-guard work in this mission.
