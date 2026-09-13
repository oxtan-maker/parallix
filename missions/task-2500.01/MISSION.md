# Mission: Model repository integration mode as a first-class configuration (task-2500.01)

## Goal
Introduce an explicit, repository-level integration **strategy** so Parallix no longer implicitly assumes `px integrate` always performs the final merge into the primary branch. Model three modes behind an abstraction:

- `local` — GitHub-unaware / local-first. Parallix owns integration into the configured primary branch. **Default; behaviourally identical to current `px integrate`.**
- `github-publish` — fast single-developer. Parallix integrates locally; GitHub independently verifies the exact resulting commit; verified commits publish to protected `origin/main` in order. `px integrate` pins the same SHA it produced.
- `github-pr` — collaborative. Parallix completes and reviews a mission branch, pushes it, GitHub/PR owns final integration. `px integrate` must NOT locally merge into remote primary.

Expose the strategy as `{ "integration": { "mode": "local" } }` in the repo-override config, following existing conventions (`config/workflow.config.schema.json`, `src/adapters/config/product-config.ts`, `config/state-map.json`). Absent mode ⇒ `local`. Unknown/invalid mode ⇒ **fail closed** with an actionable configuration error.

## Why Now
`px integrate` currently encodes exactly one behaviour (local squash/merge into the primary branch) with no escape hatch. That conflates two authorities that must stay separate — **review approval ≠ integration into primary** — and blocks two real deployment shapes (verified single-developer publish, and PR-owned collaborative integration). Missions 2 and 3 build on this abstraction; Mission 1 is the shared foundation. Establishing it first prevents every downstream mission from re-deriving the merge authority question.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: foundational workflow/payload mission; scope bounded to config + dispatch abstraction, no GitHub network calls in `local`.
- Main drivers: base TASK-2500; enables github-publish/github-pr modes; separation of review vs. merge authority.

## Scope
- Add `integration.mode` to the optional repo-override config: schema (`config/workflow.config.schema.json`), default config (`src/adapters/config/product-config.ts`), and validation so absent ⇒ `local`, unknown ⇒ fail-closed actionable error.
- Allowed values: `local`, `github-publish`, `github-pr`. Validate against this set; reject anything else with a message that names the invalid value and the allowed set.
- Introduce a **strategy/capability boundary** (application-layer port + dispatcher) for the operations: `prepare integration`, `run required local gates`, `produce integration candidate`, `submit for external verification`, `publish`, `observe external integration`, `close mission`. Not every mode implements every operation; unimplemented operations fail closed with a clear error.
- Domain/application layer expresses integration **state and required evidence** (e.g. "external integration observed", "verified SHA") without importing GitHub/Forgejo API types. The `local` mode path never touches GitHub.
- Keep `local` behaviourally identical to current workflow: same merge path, same gates, same board lane transitions (`review → integration → done`).
- CLI/status surfaces (`px status`, `px config`, `px diff` where relevant) surface the active integration mode.
- Docs: explain the three modes, their use cases, and the authority separation.

## Out of Scope
- No GitHub/Forgejo integration implementation for `github-publish` or `github-pr` beyond the abstraction seam and fail-closed stubs. External providers stay **observed** (future adapters), not called.
- No changes to existing gate machinery, rebase logic, or the squash/merge mechanics used by `local`.
- No new network credentials, remotes, or publishing pipelines.
- Missions 2, 3 (build on this abstraction) and Mission 4 (parallel) are out of scope; do not extend the abstraction to cover their payloads.
- No default config change that alters `local` behaviour for existing repositories.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no unattached subjective adjectives.

1. A repository with no `integration.mode` configured parses and behaves as `local`; `integrate.test.ts` and `integrate-guard.test.ts` pass unchanged (no fixture edits beyond intentional config additions).
2. All three modes (`local`, `github-publish`, `github-pr`) parse and validate through the repository configuration; a test asserts each mode resolves to its strategy and that the schema enum accepts exactly these three values.
3. An unknown/invalid `integration.mode` value fails closed: the config load throws an actionable error naming the invalid value and the allowed set `{ local, github-publish, github-pr }`; a test asserts the error message and non-zero exit.
4. Integration-mode dispatch sits behind an explicit application-layer abstraction (a capability port + dispatcher), not scattered `if (mode === ...)` branches in `src/adapters/cli/commands/integrate.ts`; `application-contracts.test.ts` / `dependency-graph.test.ts` confirm no domain→GitHub API dependency for the state model.
5. A test proves `local` retains current integration semantics: same merge path and same board lane transition (`review → integration → done`) as the pre-mission baseline.
6. A test proves every mode other than the one under test fails closed on an operation it does not implement (e.g. `github-pr` refuses a local primary merge; `local` refuses to submit-for-external-verification).
7. `px config` and `px status` print the active integration mode; a test asserts the mode string appears in their output for a configured mode.
8. Docs (`docs/` or repo README) explain the three modes, intended use cases, and the "review approved ≠ integrated into primary" authority separation; `./scripts/verify-local.sh docs` passes.

## Risks and Assumptions
- **Assumption:** `local` must remain byte-for-byte behaviourally identical; any regression in the existing merge/gate path fails Success Criterion 1/5.
- **Risk:** Spreading mode conditionals into `integrate.ts` violates Success Criterion 4 and the mission's core constraint. Mitigate with the capability boundary from the start.
- **Risk:** The default-config merge (`product-config.ts`) is loaded broadly; a schema/validation mistake could break every config-dependent command. Validate the default path early with `config-command.test.ts`.
- **Assumption:** External evidence for `github-publish`/`github-pr` is observed (future), not self-asserted — the domain must model evidence as data, not as a local boolean.
- **Risk:** `local` stays first-class without GitHub config/credentials/network; ensure the `local` path has zero GitHub imports.
- **Assumption:** Missions 2/3 expect the strategy abstraction to expose the seven operations listed; scope the seam to those names.

## Checkpoints
- CP 1: Config schema + defaults + validation for `integration.mode` (absent ⇒ local; unknown ⇒ fail closed). First-class config, no GitHub dependency.
- CP 2: Application-layer strategy/capability boundary + dispatcher for the seven integration operations; `local` routes to the existing merge path unchanged.
- CP 3: Mode-specific fail-closed behaviour + board/lane semantics; CLI/status surfaces the active mode.
- CP 4: Docs + full verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/integrate.test.ts` ``, `` `px config ``, `` `./scripts/verify-local.sh all` ``
  2. **Test names** — must match a test name in the repo
  3. **Test file paths** — e.g., `test/integrate.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0041` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. **A raw `ls`/`stat` listing or a prose sentence like "the config now supports modes" is NOT sufficient evidence on its own** — pair any shell output with a recognized command, test name, test path, or ADR reference.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Absent mode defaults to `local` | `test/integrate.test.ts`, `` `npm test -- test/integrate.test.ts` `` | PASS |
| Invalid mode fails closed | `test/config-command.test.ts`, `` `npm test -- test/config-command.test.ts` `` | PASS |
| Dispatch behind abstraction, no domain→GitHub dep | `test/application-contracts.test.ts`, `ADR 0041` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do NOT modify the merge/rebase/squash mechanics used by the `local` path except to route them through the new capability boundary without changing behaviour.
- Do NOT add GitHub/Forgejo API callers, network calls, or credential handling anywhere in the `local` path.
- Do NOT change the lifecycle gate machinery (`adapters.gates.preIntegration`, `config/integration-pipelines.json` gate sequence) or the state-map transitions.
- Do NOT alter tests outside the mission, except intentional fixture/config updates required by the new `integration` config key (Success Criterion 1).
- Do NOT implement `github-publish`/`github-pr` provider behaviour; only the abstraction seam and fail-closed stubs.

## Stop Rules
- Stop if making `local` behaviourally identical requires any change to the existing merge or gate path beyond routing through the new abstraction.
- Stop if dispatch begins to require scattered `if (mode === ...)` in `integrate.ts`; re-centralize in the capability boundary.
- Stop before any GitHub/Forgejo network call or credential plumbing; that is out of scope for this mission.
- Stop after the single `./scripts/verify-local.sh all` gate passes; do not run additional test suites or phases.
- Do not transition the backlog task to `ready`; the harness does that after a clean draft.
