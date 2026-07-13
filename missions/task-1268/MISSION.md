# Mission: Shift-left verification gate before each review round (task-1268)

## Goal

Require a successful verification gate before every review round, use the
changed-file area to scope that gate, and return failed gates to the
implementer without spending a reviewer cycle.

## Scope

- Run the pre-review gate on every review-loop iteration.
- Resolve a single-area diff to that area and a mixed-area diff to the strict
  `all` area.
- Auto-bounce a failed gate with its captured output and stop the current
  review invocation for the implementer to fix it.
- Remove the checkpoint `--no-gate` bypass.

## Success Criteria

- SC1: A gate is run once before every launched reviewer round.
- SC2: Single-area diffs use that area; mixed-area diffs use `all`.
- SC3: A failed gate transitions work back to the implementer and does not
  launch a reviewer.
- SC4: Checkpoints cannot skip a failed verification gate with `--no-gate`.
- SC5: The relevant verification suites pass, except for documented baseline
  failures reproduced unchanged on `main`.

## Restricted Areas

- Do not alter integration gate planning in `lib/commands/integrate.ts`.
- Do not alter `config/integration-pipelines.json` or `docs/adr/`.

## Gates

- `./scripts/verify-local.sh static-analysis`
- `./scripts/verify-local.sh all`
