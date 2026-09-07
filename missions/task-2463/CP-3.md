# CP 3 — Implement first-run detection, filtering, write, and `px config --write`

## Work done

Implemented the feature and wired it end to end.

**New module** `src/adapters/agents/first-run-config.ts`:
- `ensureFirstRunAgentConfig({ rootDir, worktree })` — first-run autodetection.
  Returns early (`written: false`) if a working-tree `config/agents.json`
  exists (idempotent, user edits win); otherwise probes every
  `WORKFLOW_AGENT_NAMES` family once via the existing `workflowLauncherStatus`
  seam, filters each `steps.{draft,active,review}.eligible` to only supported
  families, and writes the working-tree file preserving `_comment`,
  `_weights_comment`, per-step `selection`/`weights`, and `overrides`.
- The base is read from the bundled default via `runtimeAssetStore` (the full
  list, ADR 0044), never from the working-tree copy being written.
- `custom` is judged against its configured runner through
  `resolveCustomRunner` inside `workflowLauncherStatus` (ADR 0050).

**`px config --write`** (`src/adapters/cli/commands/config.ts`): new write path
that requires a repository root (`hasGitRepository`, exits non-zero otherwise)
and regenerates/refreshes the working-tree config. The read-only default path
is unchanged (still prints the effective config).

**Workflow-command entry hook** (`src/composition/create-cli.ts`): `draft`,
`active`, `review` prime first-run detection once at entry, strictly gated on
"no working-tree file exists" and wrapped so a probe failure degrades to the
shipped default. Never runs per-selection/per-render.

## Verification

- `test/first-run-config-autodetect.test.ts` — 7/7 pass:
  `node --experimental-test-module-mocks --import tsx --test test/first-run-config-autodetect.test.ts`
- `test/config-command.test.ts` — 5/5 pass (incl. new `--write` repo-root guard):
  `node --experimental-test-module-mocks --import tsx --test test/config-command.test.ts`
- `test/agents.test.ts` — 105 pass / 1 skip (selection behavior unchanged):
  `node --experimental-test-module-mocks --import tsx --test test/agents.test.ts`
- `test/domain-agent-selection.test.ts` — 5/5 pass.
- `test/application-boundaries.test.ts` + `application-contracts` + `application-services` + `agent-config-resolver` — 22/22 pass.
- Written config preserves `_comment`/`_weights_comment` and per-step `selection`; feeds `readAgentConfig`/`eligibleAgentsForStep`.
- `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED (ESLint, tsc, test-hygiene, test typecheck).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Fresh tree gets filtered `config/agents.json` (draft/active/review) | `test/first-run-config-autodetect.test.ts` "writes a filtered config on first run containing only available families" | PASS |
| Absent family excluded; present family included | `test/first-run-config-autodetect.test.ts` "absent family never appears in any eligible array; present family does" | PASS |
| Pre-existing file untouched on rerun | `test/first-run-config-autodetect.test.ts` "leaves a pre-existing working-tree config byte-for-byte on a second run" | PASS |
| `custom` judged against its runner | `test/first-run-config-autodetect.test.ts` "judges the custom family against its configured runner" | PASS |
| Written config feeds readAgentConfig/eligibleAgentsForStep | `test/first-run-config-autodetect.test.ts` "written config feeds readAgentConfig and eligibleAgentsForStep" | PASS |
| selectAgent selection unchanged | `test/agents.test.ts` (105 pass), `test/domain-agent-selection.test.ts` (5 pass) | PASS |
| `px config` non-zero when not a repo root; read-only prints config | `test/config-command.test.ts` "config --write exits non-zero when the working directory is not a repository root" | PASS |
| No new lint/typecheck regressions | `./scripts/verify-local.sh static-analysis` | PASS |

## Next action
Run the full integration gate `./scripts/verify-local.sh all` and close CP 4.
