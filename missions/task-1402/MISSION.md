# Mission: Keep the global `px` runner current with a repo-configurable post-integrate hook (task-1402)

## Goal

Add a generic, repo-configurable post-integrate hook surface to `px integrate`, then wire parallix itself to that hook so a successful integration can bump the package patch version and refresh the operator's globally installed `px` from the just-integrated checkout. Repos without a hook configured must continue to behave exactly as they do today.

## Why Now

parallix now changes often enough that the globally installed `px` runner drifts behind the source tree that missions are actively modifying. That creates an operator hazard: a mission can land code that assumes newer workflow behavior, while the next command still executes an older global runtime. The current integrate flow already owns the "successful closeout on the primary checkout" seam, but it has no repo-level extension point for post-success maintenance tasks. This mission closes that gap once, generically, and uses the new seam to keep parallix self-hosting installs current.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: existing `integrate` closeout seams for Variant A and Variant B, established repo override model in `workflow.config.json`, and focused test coverage already present around integrate closeout behavior

## Scope
- Add a repo-facing post-integrate hook contract to the workflow configuration surface:
  - extend `lib/core/product-config.ts` defaults/effective config handling so repos can declare a post-integrate command without breaking repos that omit it
  - extend `config/workflow.config.schema.json` and any related config/help output so the new hook is discoverable and validated as a string command
- Update `lib/commands/integrate.ts` so a configured post-integrate hook is considered only after a successful non-dry-run integrate path:
  - Variant A (`finalizeVariantACloseout`) success path
  - Variant B full squash/sync success path
  - resumed partial-success path where integrate detects an already-landed squash commit and finishes sync/cleanup
- Define the hook execution contract concretely:
  - run at most once per successful `px integrate` invocation
  - execute from the primary/base checkout, not the mission worktree
  - pass stable context to the hook via environment variables for at least slug, base worktree, base branch, and selected integrate variant
  - emit explicit diagnostics when the hook is invoked and when it fails
- Add focused regression coverage in `test/integrate.test.js` for:
  - hook executes once on successful Variant A closeout
  - hook executes once on successful Variant B or resumed success path
  - hook does not run on `--dry-run`, preflight failure, gate failure, or closeout/merge failure
  - hook failure surfaces as a distinct post-integrate failure instead of a generic merge/gate failure
- Add the parallix-specific hook implementation and wiring:
  - a checked-in script under `scripts/` that bumps the patch version in the package metadata and refreshes the global `px` install from the current checkout
  - `workflow.config.json` wired to that script through the new generic hook setting
- Update the operator-facing docs that explain the hook:
  - how any repo can opt into the generic post-integrate hook
  - how parallix uses it to keep the global `px` runner aligned with the integrated source tree
  - the exact operator-visible behavior after a successful integrate

## Out of Scope
- Changing command behavior for failed integrates, merge-conflict recovery, review submission, or rebase flows outside the new post-success hook seam.
- Publishing parallix to npm, changing package scope/name, or redesigning the broader distribution model from ADR 0044.
- Adding a pre-integrate, per-checkpoint, or per-review hook system. This mission is only about the post-success integrate seam.
- Updating arbitrary operator shell config, PATH setup, package-manager policy, or machine-wide install locations beyond the repo-owned hook command itself.
- Reworking `./scripts/verify-local.sh`, `config/integration-pipelines.json`, or the integration-gate planner.
- Implementing Windows-specific install/update flows unless the existing shell-script posture already supports them without extra branching.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- **SC1:** `workflow.config.json` may declare one repo-local post-integrate command, and the effective-config/schema path documents that command as optional. Repos with no hook configured still run `px integrate` without any post-integrate behavior change.
- **SC2:** A successful non-dry-run Variant A integrate invokes the configured hook exactly once from the base checkout after closeout success is established. The hook invocation receives environment variables identifying at least `task-1402`-style slug, base worktree path, base branch, and integrate variant.
- **SC3:** A successful non-dry-run Variant B integrate, including the "resume from existing squash commit" branch, invokes the configured hook exactly once and does not double-run it during cleanup or retry handling.
- **SC4:** The hook never runs for `px integrate <slug> --dry-run`, for preflight failures, for failed integration gates, or for failed closeout/squash/sync paths. Focused tests assert the zero-invocation outcome in each of those cases.
- **SC5:** When the configured hook exits non-zero, `px integrate` reports a distinct post-integrate-hook failure that includes the hook output and does not print the normal final success message.
- **SC6:** parallix wires the generic hook in `workflow.config.json` to a checked-in script under `scripts/` that bumps the patch version in package metadata and refreshes the global `px` install from the current checkout used for integration.
- **SC7:** The repo-specific hook behavior is documented in the operator-facing docs, including the generic configuration knob for other repos and the parallix-specific self-update behavior.
- **SC8:** `./scripts/verify-local.sh static-analysis` passes on the final tree, satisfying the required `lib/` integration gate, and `./scripts/verify-local.sh all` passes on the same tree.

## Risks and Assumptions
- Assumption: the correct generic abstraction is a single command-style hook, matching the existing `adapters.verification.command` pattern, rather than a broader hook registry.
- Risk: the integrate flow has three success shapes (Variant A, Variant B, resumed partial success). Hook insertion must avoid double invocation across those branches.
- Risk: if the hook runs after local merge/push state is already finalized, a hook failure cannot roll back the landed integration. The command must therefore surface the failure clearly without pretending nothing happened.
- Assumption: the operator intent is to refresh the global install from the just-integrated checkout. If literal `npm update -g` does not correctly target the local source tree, implementation may substitute the correct local-install command, but the resulting behavior must still be documented as "refresh global `px` from this checkout."
- Risk: version-bump automation will likely touch both `package.json` and `package-lock.json`; tests and docs must account for both files if the chosen implementation updates both.

## Checkpoints
- CP 1: Define the generic post-integrate hook contract in config/schema/defaults and pin it with focused config/integrate tests.
- CP 2: Wire the hook into the successful integrate paths for Variant A, Variant B, and resumed-success execution, with exact-once invocation coverage.
- CP 3: Add failure-path coverage proving the hook is skipped on dry-run and unsuccessful integrates, and that hook failures surface with distinct diagnostics.
- CP 4: Add the parallix-specific hook script plus `workflow.config.json` wiring to bump package patch version and refresh the global `px` install from the integrated checkout.
- CP 5: Update operator-facing docs and run the required verification gates.

## Gates
- [x] ./scripts/verify-local.sh static-analysis
- [x] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change the verification gate planner or its config semantics beyond whatever minimal config/schema extension is required to declare the new post-integrate hook.
- Do not modify `px review`, Forgejo sync semantics, or rebase/conflict recovery behavior except where integrate must call the new hook after success.
- Do not redesign package publishing, registry release automation, or the broader public-install story from ADR 0044.
- Do not introduce repo mutations from the generic hook path outside the configured hook command itself; repos without hook config must remain no-op.

## Stop Rules
- Stop if the hook cannot be inserted without breaking the existing "no config means current behavior" contract for other repos.
- Stop if the integrate success paths cannot guarantee exact-once hook execution across normal success and resumed partial-success flows.
- Stop if the intended "local install" command turns out not to be semantically local to the integrated checkout; resolve that command ambiguity before implementing the repo-specific hook.
- Stop if making the hook observable requires broad refactoring of integrate orchestration outside the closeout/success seam. In that case, document the architectural blocker instead of shipping a partial hook path.
