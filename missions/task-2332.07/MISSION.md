# Mission: Re-home the integrate workflow behind an application use case (task-2332.07)

## Goal

Establish the first production-ready command-ownership wave: keep `integrate`
argument parsing, help, output mapping, and rendering in `src/interfaces/cli/`;
move its complete workflow policy and sequencing into `src/application/` over
application-owned ports; leave concrete Git, Backlog, Forgejo, verification,
filesystem, process, and agent mechanisms in adapters supplied explicitly by
composition. Preserve the public integrate contract.

## Why Now

The previous task definition combined eight workflow-heavy commands and six
interface migrations. That is a multi-wave effort under ADR 0036, not one
mission: the existing `integrate` command alone coordinates verification,
conflict recovery, hook retry, lifecycle transitions, Forgejo sync, and
worktree cleanup. This wave provides the extraction pattern and an integrated,
fully functional integrate path before the dependent handoff, draft, stats,
rebase, status/checkpoint, review, and final-interface waves begin.

## Scope

- Inventory all registered commands and shared command modules, recording their
  current owners and wiring.
- Extract the complete `integrate` workflow from
  `src/adapters/cli/commands/integrate.ts` into an application use case and
  focused application ports.
- Keep the public integrate CLI boundary in `src/interfaces/cli/`.
- Update `src/composition/create-cli.ts` so it explicitly supplies concrete
  ports to the integrate use case.
- Add hermetic mocked-port unit tests and retain characterization coverage for
  the CLI contract.

## Out of Scope

- Handoff workflow extraction: TASK-2332.09.
- Draft workflow extraction: TASK-2332.10.
- Stats workflow extraction: TASK-2332.11.
- Rebase workflow extraction: TASK-2332.12.
- Status and checkpoint workflow extraction: TASK-2332.13.
- Review workflow extraction: TASK-2332.14.
- Remaining compliant CLI interfaces, compatibility cleanup, documentation,
  and cross-workflow verification: TASK-2332.15.
- Final responsibility-guard certification: TASK-2332.08 (after TASK-2332.15).
- New user-facing behavior, persistence-format changes, or new adapter
  implementations.

## Success Criteria

- SC1: CP-1 inventories every registered CLI command and the three shared
  command modules with inbound interface, current application owner, adapters,
  and composition wiring.
- SC2: `src/adapters/cli/commands/integrate.ts` delegates to one application
  use case and no longer sequences multiple adapter packages.
- SC3: The integrate application use case owns preflight, verification,
  conflict, retry, hook, lifecycle, Forgejo-sync, and cleanup decisions through
  application-owned ports; it imports no concrete adapter module.
- SC4: Integrate parsing, request translation, help, rendering, and exit-code
  mapping live under `src/interfaces/cli/`.
- SC5: Composition explicitly supplies the integrate ports; neither interfaces
  nor application code instantiate or locate adapters.
- SC6: Fast mocked-port tests cover successful integration, preflight failure,
  conflict, hook retry, and gate failure without real Forgejo, agent CLIs, or
  recursive workflow commands.
- SC7: Existing integrate text, JSON shape, exit codes, and lifecycle behavior
  remain compatible, proved by focused characterization tests and the required
  verification gates.

## Checkpoints

- CP 1: Record the command ownership inventory and the exact integrate
  extraction boundary.
- CP 2: Extract integrate sequencing into application-owned ports/use case,
  migrate its CLI boundary and composition wiring, add fast tests, and run the
  required gates.

## Checkpoint Documentation Requirements

Every checkpoint document must include a summary, a `## Goal Check` heading, a
three-column `Criterion | Evidence | Status` table with verifiable file, test,
ADR, or command references, and a non-generic `Next action:` line.

## Gates

- `./scripts/verify-local.sh static-analysis`
- `./scripts/verify-local.sh all`

## Stop Rules

- Stop if moving integrate sequencing requires an application import of a
  concrete adapter; define a focused port and wire it from composition instead.
- Stop if a public integrate text, JSON, or exit-code characterization changes;
  restore compatibility before continuing.
- Stop if hermetic unit tests invoke Forgejo, an agent CLI, or a recursive
  workflow command.
- Do not begin a later TASK-2332 child until this wave is reviewed and
  integrated.
