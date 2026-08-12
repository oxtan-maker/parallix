# Mission: Re-review architecture ADRs against the landed ports-and-adapters tree (task-2332.18)

## Goal
Bring the active architecture decision records into agreement with the landed TASK-2332 ports-and-adapters architecture, while preserving ADRs as concise statements of current decisions rather than migration history.

## Why Now
TASK-2332 has landed the UI-neutral boundary, six canonical `src/` layer roots, executable dependency enforcement, application-owned command workflows, and cross-adapter rules. ADR 0051 still describes deleted command and entry-point files, and the implications discovered during landing are otherwise recoverable only from guard code and adapter documentation. Leaving that mismatch in place makes the ADR set an unreliable architecture authority.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: The backlog item identifies the owning ADRs, obsolete references, and the architectural decisions that require an explicit review; execution can begin without further product discovery.
- Main drivers: Correct ADR 0051's pre-migration model; audit ADRs 0037 and 0053 against the landed tree; replace brittle source line citations with file-and-symbol references; make implicit ownership and adapter-boundary rules explicit.

## Scope
- Audit `docs/adr/0051-ui-neutral-application-boundary.md` against the landed six-layer `src/` architecture, its enforced dependency direction, and application ownership of command workflows.
- Amend ADR 0051 in place to remove its four obsolete references to `lib/commands/active.ts`, `lib/commands/stats-backfill.ts`, `lib/tools/backlog.ts`, and root `px.ts`.
- Replace every ADR source reference that uses a line number or line range with a durable file-and-symbol reference.
- State the landed decisions about adapter mechanism use versus workflow ownership, cross-adapter dependencies through application-owned ports, and request translation ownership at the `src/interfaces/` boundary in the ADR that owns each decision.
- Review `docs/adr/0037-ai-workflow-coordination-architecture.md` and `docs/adr/0053-operational-persistence-and-authority-boundaries.md` for contradictions with the landed tree; amend each only where the active decision is inaccurate.
- Update `docs/adr/index.md` only if an ADR status changes, and record any implementation-versus-ADR contradiction as a finding with a separately raised follow-up task.

## Out of Scope
- Changing the six-layer tree, dependency guard, adapter implementations, command workflows, ports, or request-translation code.
- Rewriting ADRs into a migration narrative, adding dated update sections, or adding Supersedes/Superseded-by clauses.
- Changing ADRs outside 0037, 0051, and 0053 unless a cited reference in one of those ADRs requires a narrowly necessary correction.
- Fixing implementation behavior found to conflict with an ADR; that work belongs in a newly raised follow-up task.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- ADR 0051 names the six canonical `src/` layer roots, the enforced dependency direction, and application ownership of command workflows, without describing the deleted legacy command or root entry-point files as current architecture.
- ADR 0051 contains no references to `lib/commands/active.ts`, `lib/commands/stats-backfill.ts`, `lib/tools/backlog.ts`, or root `px.ts`.
- ADRs 0037, 0051, and 0053 contain no source reference with a line number or line range; each remaining source reference identifies a repository file and a relevant symbol.
- The owning ADRs explicitly distinguish adapter mechanism use from workflow ownership, require cross-adapter collaboration to route through an application-owned port, and assign request translation to the interfaces layer.
- ADRs 0037 and 0053 each have a recorded review outcome: an in-place amendment where contradicted by the landed architecture, or an explicit confirmation in the mission checkpoint evidence that they remain accurate.
- The amended ADRs contain current decisions only: no migration-history sections, dated update sections, or Supersedes/Superseded-by clauses are introduced.
- Every conclusion that the implementation is wrong rather than the ADR is captured in checkpoint evidence and has a separately raised follow-up task; no such conclusion is silently resolved by changing source code.
- `docs/adr/index.md` reflects every status change made by this mission, and `./scripts/verify-local.sh all` completes successfully on the final documentation tree.

## Risks and Assumptions
- Risk: The executable guard or adapter README may reveal an implementation that conflicts with an ADR rather than merely an outdated ADR. Assumption: execution will preserve the implementation and raise a follow-up task when that conclusion is reached.
- Risk: Replacing line citations can make a reference too vague. Assumption: each replacement can name a stable file and a concrete exported symbol, rule, or section.
- Risk: The three ADRs may express overlapping decisions. Assumption: the review will place each decision in its existing owning ADR and avoid duplicating competing policy.
- Risk: An ADR status change could require index maintenance. Assumption: the index changes only when an ADR's actual status changes.

## Checkpoints
- CP 1: Audit ADRs 0051, 0037, and 0053 against the landed architecture evidence. Create a decision/reference ledger identifying obsolete files, every line-based source citation, the owning ADR for each implicit decision, and any implementation-versus-ADR contradiction.
- CP 2: Amend the owning ADRs in place. Make ADR 0051 describe the landed boundary and remove its four deleted-file references; make only evidence-supported changes to ADRs 0037 and 0053; replace line-based citations with file-and-symbol references.
- CP 3: Reconcile the ADR index if a status changed, raise a follow-up task for each implementation defect finding, review the documents for forbidden historical accretion, and run the required verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Durable evidence first: cite exact ADR references (`ADR 0037`, `ADR 0051`, `ADR 0053`), affected documentation paths such as `docs/adr/index.md`, recognized repository commands such as `./scripts/verify-local.sh all`, and, if applicable, the exact title and path of a raised follow-up task. Exact test names and test file paths are also accepted when relevant. File:line references are accepted parenthetically when needed, but are discouraged because line numbers rot.
- A summary of work done.
- The exact heading `## Goal Check`.
- A 3-column pipe-delimited Markdown table with this exact header: `| Criterion | Evidence | Status |`.
- At least one durable, verifiable evidence row for every success criterion. For the ADR 0037 and 0053 review criterion, name the ADR and state either `amended` with its document path or `confirmed accurate` with the review evidence.
- Raw `stat`/`ls` output or generic prose alone is not enough: it may be supplemental, but must be paired with an accepted ADR reference, test name, test path, recognized repository command/path, or follow-up task reference.
- A non-generic `Next action:` line at the bottom that identifies the next audit, amendment, index update, follow-up-task, or verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| ADR 0051 describes the landed architecture | `ADR 0051`, `docs/adr/0051-ui-neutral-application-boundary.md` | PASS |
| Required verification ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify `src/`, `test/`, scripts, executable guard code, adapter code, command workflow code, or ports-and-adapters behavior in this mission.
- Do not remove, rename, or relocate ADR files; amend active decisions in their existing documents.
- Do not alter backlog-task ownership or the `assignee` field.
- Do not push the mission branch to `origin`; if a review handoff is later requested, use only the repository's approved review workflow.

## Stop Rules
- Stop and raise a separate follow-up task when repository evidence shows the landed implementation contradicts a still-valid architecture decision; do not change the implementation to make the ADR appear true.
- Stop before changing an ADR outside 0037, 0051, or 0053 unless the user explicitly expands the mission scope.
- Stop and seek direction if the evidence supports two incompatible owners for an implicit decision and the existing ADR set does not establish which ADR owns it.
- Stop before adding historical sections, dated update notes, or Supersedes/Superseded-by language; these are forbidden for this review-and-amend mission.
