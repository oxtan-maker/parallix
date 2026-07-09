Summary of work done

Removed the merged-PR fast path from `px integrate`, normalized merged Forgejo PRs into a failing preflight state with explicit recovery commands, deleted the obsolete Variant A helper/export surface, updated hook/docs wording, and converted the integration tests to the single local-authority Variant B model.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Merged PRs fail preflight with operator recovery guidance | `lib/commands/integrate.ts:1024`, `lib/commands/integrate.ts:1181`, `test/task-2204-integrate-no-variant-a.test.js:127` | PASS |
| Integration control flow now uses only the local squash-merge path | `lib/commands/integrate.ts:633`, `lib/commands/integrate.ts:695`, `rg 'finalizeVariantACloseout|context\.pr\.merged' lib/commands/integrate.ts` | PASS |
| Review status no longer accepts a merged PR as sufficient for integration | `lib/commands/integrate.ts:990`, `lib/commands/integrate.ts:1016`, `test/integrate.test.js:999` | PASS |
| Post-integrate hook contract removed `variant-a` | `lib/core/post-integrate-hook.ts:47`, `test/post-integrate-hook.test.js:46`, `docs/authority-reference.md:206` | PASS |
| ADR and operator docs describe Variant B as the only landing path | `docs/adr/0045-parallax-branch-model.md:51`, `docs/adr/0045-parallax-branch-model.md:74`, `docs/authority-reference.md:191` | PASS |
| Existing integration tests were converted to the merged-PR failure model | `test/task-1109.test.js:225`, `test/task-1109.test.js:292`, `"integrate rejects a Forgejo PR that is already merged"` | PASS |

Next action: run `graphify update .`, then execute the mission gates including `./scripts/verify-local.sh all` and capture the final checkpoint evidence.
