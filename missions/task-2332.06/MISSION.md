# Mission: Complete ports-and-adapters migration and certify the architecture (task-2332.06)

## Goal

Complete, rather than merely certify, the TASK-2332 architecture migration.
Re-home every production responsibility below `src/platform/` into the final
ports-and-adapters layers, delete `src/platform/`, and prove that the complete
production dependency graph has zero exceptions while preserving CLI behavior.

`platform` is not a layer. It must not survive as a legacy or infrastructure
exception bucket.

## Why Now

The preceding TASK-2332 missions established application ports, a composition
boundary, application use cases, and canonical inbound dispatch. They leave a
large runtime tree under `src/platform/runtime/` and assets under
`src/platform/assets/`. Certifying the current graph while that tree remains
would validate only a partial migration. This final wave must complete the move
so the directory structure, imports, and documentation all express the same
architecture.

## Refinement Signals

- Predicted NEL bucket: Epic (more than 600)
- Confidence: Medium
- Selection note: decompose only into checkpoints that preserve the final
  platform-free target; do not turn un-moved responsibilities into exclusions.
- Main drivers: re-homing the runtime, replacing imports and tests, splitting
  policy from infrastructure, then validating every lifecycle path.

## Final Architecture

| Responsibility | Final home |
|---|---|
| Business rules, aggregates, value objects, and pure policy | `src/domain/` |
| Use cases, orchestration, and dependency contracts | `src/application/` and `src/application/ports/` |
| Filesystem, Git, process, agent, Forgejo, Backlog, SQLite, configuration, and packaged-asset implementations | `src/adapters/` |
| CLI/TUI request translation, dispatch, and rendering | `src/interfaces/` |
| Concrete adapter assembly only | `src/composition/` |
| Bootstrap and process exit only | `src/entry/` |

The former `platform/runtime/lib` modules are all in scope: commands, review
workflow, agent launchers, Git/worktree/process utilities, configuration and
storage access, verification, architecture guards, and support utilities.
`platform/assets` is also in scope: packaged runtime assets are outbound
adapters. Split modules as needed so application policy has no direct Node,
filesystem, process, Git, or provider dependency.

## Scope

- Inventory every production module below `src/platform/`, assign it to one of
  the final homes above, and move it. No module may be retained because it is
  old, convenient, difficult, or called infrastructure.
- Move inbound command handling and rendering to `src/interfaces/`; move command
  behavior and orchestration to application use cases; define required outbound
  contracts in `src/application/ports/`.
- Move concrete Git, worktree, filesystem, process, configuration, agent,
  provider, persistence, Backlog, Forgejo, verification, and packaged-asset
  implementations to `src/adapters/`.
- Keep composition limited to wiring concrete adapters to application ports, and
  keep `src/entry/` limited to startup and process exit.
- Delete `src/platform/`, all imports of it, its dependency allowlist, and all
  transitional re-exports and compatibility façades that preserve old paths.
- Update production tests and build/package configuration for the final paths;
  add focused boundary coverage where needed to make the complete-tree rules
  executable.
- Remove migration task IDs, checkpoint labels, and obsolete migration comments
  from production source.
- Update ADR/readme material and layer README files after consulting
  `docs/doc-standards.md` before editing any root or `docs/` Markdown file.
- Validate `draft`, `active`, retry/failover, review, integrate, statistics,
  CLI board, and TUI board end to end.

## Out of Scope

- New user-facing workflow features or intentional changes to command text,
  JSON output, exit codes, or lifecycle semantics.
- Changes to persistence data formats or migration semantics unless required to
  replace a direct infrastructure dependency with an existing or new port.
- Retaining a `platform` directory, compatibility façade, or allowlist entry as
  a workaround. Those are explicitly forbidden, not deferred work.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Every criterion has objective
> evidence. For this migration, a passing subset scan is insufficient: checks
> must cover every production source file.

- SC1: `src/platform/` does not exist in the final production tree.
- SC2: No production source, production build configuration, package manifest,
  or runtime import refers to `src/platform/`.
- SC3: Every former platform module is re-homed under `src/domain/`,
  `src/application/`, `src/application/ports/`, `src/adapters/`,
  `src/interfaces/`, `src/composition/`, or `src/entry/`; the migration inventory
  records its old path, final path, and responsibility.
- SC4: Application code imports only domain code and application-owned ports;
  it contains no direct Node, filesystem, process, Git, agent-provider, Forgejo,
  Backlog, SQLite, or asset implementation dependency.
- SC5: Concrete implementations of those infrastructure concerns are adapters
  and satisfy application-owned ports.
- SC6: Only composition imports both concrete adapters and application code;
  composition performs wiring and no workflow policy.
- SC7: CLI and TUI are inbound adapters that invoke application capabilities;
  neither imports command implementation modules from a legacy runtime path.
- SC8: The dependency allowlist is deleted, the complete production-tree
  dependency check has zero exceptions and zero violations, and a regression
  test fails if a prohibited edge or a new `src/platform/` path is introduced.
- SC9: Transitional re-exports and compatibility façades are removed; no
  production source retains an alternate legacy import path.
- SC10: No TASK/checkpoint migration labels remain in production source, and
  architecture comments agree with actual imports.
- SC11: Architecture ADRs and directory READMEs describe the final platform-free
  layout and match the executable graph.
- SC12: Existing CLI behavior is preserved for command text, JSON, and exit
  codes across `draft`, `active`, retry/failover, review, integrate, statistics,
  CLI board, and TUI board.
- SC13: `./scripts/verify-local.sh static-analysis` and the full integration
  gate pass; no focused or unannotated skipped tests are introduced.

## Risks and Assumptions

- **Risk:** The runtime has mixed policy and I/O. **Mitigation:** characterize
  behavior first, extract application ports before moving the concrete code, and
  keep unit tests mocked so they do not start real Forgejo, agents, or costly CLI
  commands.
- **Risk:** Path-sensitive tests, bundling, and dynamic imports break during
  moves. **Mitigation:** update them in the same checkpoint as each move and run
  the relevant focused suite before proceeding.
- **Risk:** A compatibility shim looks useful after callers move. **Mitigation:**
  update all callers; no shim may survive merely to avoid path changes.
- **Assumption:** Existing lifecycle behavior is the authority. This mission
  changes ownership and dependency direction, not observable workflow behavior.
- **Assumption:** New ports may be introduced whenever necessary to remove a
  direct dependency; adapter code may not be promoted into application merely to
  avoid creating a port.

## Checkpoints

- CP 1: Produce and commit the complete platform-module inventory and target
  mapping. Establish/extend full-tree boundary tests that reject `src/platform/`
  and prohibited layer edges. Move architecture guards into their final layer.
- CP 2: Re-home core utilities, configuration, filesystem, Git, worktree,
  process, verification, storage, and packaged assets behind adapters and ports.
  Update composition and focused tests.
- CP 3: Re-home agent/provider and review workflow code. Extract policy to
  application/domain and place concrete launcher/provider work in adapters.
  Verify active, failover, review, and statistics flows with mocks.
- CP 4: Re-home command surfaces and remaining runtime modules into interfaces,
  application, adapters, composition, and entry. Update CLI/TUI tests, build
  configuration, and all imports.
- CP 5: Delete `src/platform/`, allowlists, transitional re-exports, and obsolete
  migration labels. Update documentation and directory READMEs.
- CP 6: Run final complete-tree boundary checks, static analysis, integration
  gates, and all representative flows. Produce the final Goal Check evidence.

### Checkpoint Documentation Requirements

Every checkpoint document (`CP-N.md`) MUST include a summary, a `## Goal Check`
section, a three-column `Criterion | Evidence | Status` table, one verifiable
file:line, test-name, test-path, ADR, or recognized-command reference per
criterion, and a non-generic `Next action:` line. The final checkpoint must cite
the platform-module inventory and proof of the complete production-tree scan.

## Gates

- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas

- Do not alter externally observable CLI behavior without an explicit approved
  follow-up mission.
- Do not bypass architecture checks, weaken tests, add allowlist entries, add
  compatibility façades, or retain `src/platform/`.
- Do not make unit tests invoke real Forgejo, real coding agents, or expensive
  CLI processes; mock those dependencies at their ports.

## Stop Rules

- Stop and repair the current extraction if a full-tree boundary check finds a
  prohibited edge, a `src/platform/` reference, or an unmapped former platform
  module.
- Stop and repair the current checkpoint if focused behavior tests, static
  analysis, or the relevant flow suite fails.
- Do not proceed to certification while any compatibility path, allowlist entry,
  or platform directory remains.
