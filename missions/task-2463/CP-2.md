# CP 2 — Failing reproduction / behavior test

## Work done

Authored `test/first-run-config-autodetect.test.ts` locking the first-run write
contract before the fix. It fails today (module `first-run-config.js` does not
exist → `ERR_MODULE_NOT_FOUND`), which is the required red state.

Tests the contract:
- writes a filtered `config/agents.json` on first run with only available
  families across `draft`/`active`/`review` (`writes a filtered config on first run containing only available families`)
- absent families never appear; present ones do
  (`absent family never appears in any eligible array; present family does`)
- `custom` is judged against its configured runner via `workflow.config.json`
  (`judges the custom family against its configured runner`,
  `keeps custom in eligible when its configured runner is available`)
- a pre-existing working-tree file is left byte-for-byte on a second run
  (`leaves a pre-existing working-tree config byte-for-byte on a second run`)
- the written file feeds `readAgentConfig`/`eligibleAgentsForStep` without the
  `_comment`/`_weights_comment` keys breaking parsing
  (`written config feeds readAgentConfig and eligibleAgentsForStep`)
- idempotency guard returns `written: false` when a file already exists
  (`writeAutodetectedAgentConfig returns written=false when a working-tree file already exists`)

Availability is injected through the existing seam
(`setCommandPathProbe` / `setLauncherHealthProbe` in
`src/adapters/agents/launcher-selection.js`) so no real agent CLI is spawned.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| First-run write contract is specified and red | `test/first-run-config-autodetect.test.ts` (ERR_MODULE_NOT_FOUND pre-fix) | PASS |
| Idempotency / no-overwrite contract specified | `test/first-run-config-autodetect.test.ts` "leaves a pre-existing working-tree config byte-for-byte" | PASS |
| Availability seam used (no real CLI) | `setLauncherHealthProbe`/`setCommandPathProbe` in `src/adapters/agents/launcher-selection.js` | PASS |

## Next action
Implement `src/adapters/agents/first-run-config.ts` and wire `px config --write` (CP 3).
