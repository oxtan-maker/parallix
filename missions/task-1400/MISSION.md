# Mission: Fix mistral-telemetry.ts CJS→ESM conversion gap (task-1400)

## Goal

Convert `lib/agents/mistral-telemetry.ts` from CJS syntax (`require()`, `module.exports`, `'use strict'`) to ESM imports/exports, matching the pattern used by all other telemetry modules (`claude-telemetry.ts`, `codex-telemetry.ts`, `opencode-telemetry.ts`, `limit-hit.ts`). This closes the last remaining CJS-syntax gap in the JS→TS conversion completed by task-1372.

## Why Now

Task-1372 converted `mistral-telemetry.js` → `mistral-telemetry.ts` but the conversion was incomplete: the file retained `require('fs')`, `require('os')`, `require('path')`, `'use strict'`, and `module.exports`. Every other `.ts` file in the codebase uses ESM `import`/`export`. This inconsistency is a regression — the file will fail under Node.js native TypeScript mode (strip-only) where `require` is not available without `createRequire`, and it violates the ESM-only convention established by the prior conversion missions.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: The fix is a mechanical, well-understood pattern already applied to 6+ sibling telemetry files.
- Main drivers: Single-file CJS→ESM conversion, zero behavioral change, existing tests cover parse/extract paths.

## Scope

- Convert `lib/agents/mistral-telemetry.ts`:
  - Replace `const fs = require('fs')` with `import fs from 'node:fs'`
  - Replace `const os = require('os')` with `import os from 'node:os'`
  - Replace `const path = require('path')` with `import path from 'node:path'`
  - Replace `'use strict';` directive (harmless but inconsistent in ESM)
  - Replace `module.exports = { parseMistralMeta, extractMistralTelemetry, getMistralProviderModel, DEFAULT_MISTRAL_LOG_DIR }` with named `export` statements for each symbol
- Run `./scripts/verify-local.sh all` to confirm no regressions
- No changes to logic, behavior, or public API

## Out of Scope

- The `'use strict';` directives in sibling files (`claude-telemetry.ts`, `codex-telemetry.ts`, `opencode-telemetry.ts`, `limit-hit.ts`, `stage-telemetry.ts`) — these are harmless in ES modules and out of scope for this mission
- The CJS compatibility shims (`if (typeof module !== 'undefined') { module.exports = ... }`) at the bottom of command files — these are intentional dual-mode support
- Any changes to `test/telemetry-stubs.test.js` — it uses CJS `require()` which is correct for Node.js test runner `.js` test files

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. **Zero CJS syntax remains in `lib/agents/mistral-telemetry.ts`:** `grep -c "require(" lib/agents/mistral-telemetry.ts` returns `0` and `grep -c "module\.exports" lib/agents/mistral-telemetry.ts` returns `0`.
2. **Named ESM exports present:** `lib/agents/mistral-telemetry.ts` contains `export function parseMistralMeta`, `export function extractMistralTelemetry`, `export function getMistralProviderModel`, and `export const DEFAULT_MISTRAL_LOG_DIR`.
3. **No import-side regressions:** `lib/agents/mistral.ts` line 25's comment reference to `mistral-telemetry.js` is updated to `mistral-telemetry.ts` (the import itself uses the `.js` extension which is correct for ESM in Node.js).
4. **Existing tests still pass:** `./scripts/verify-local.sh all` completes with static-analysis gate passing.
5. **No new `@ts-expect-error` or `@ts-nocheck` directives introduced** in any file touched by this mission.

## Risks and Assumptions

- **Risk:** The `'use strict';` removal is purely cosmetic and safe — ES modules are always strict mode by default. No behavioral impact.
- **Risk:** The `module.exports` → `export` conversion could affect consumers that rely on `require()` to load the module. Mitigation: the only consumer is `test/telemetry-stubs.test.js` which uses `require()` — Node.js test runner handles ESM `.ts` files via the `.js` extension mapping, so this is safe.
- **Assumption:** The telemetry parsing logic is unchanged; only the module syntax differs.
- **Assumption:** `lib/agents/mistral.ts` does not import from `mistral-telemetry.ts` directly (it references it only in a comment at line 25).

## Checkpoints

- CP 1: Convert `lib/agents/mistral-telemetry.ts` — replace all `require()` with `import from 'node:*'`, remove `'use strict'`, replace `module.exports` with named `export` statements. Preserve all function signatures, interfaces, and logic unchanged.
- CP 2: Verify — run `./scripts/verify-local.sh all`; confirm `grep -c "require(" lib/agents/mistral-telemetry.ts` returns 0 and `grep -c "module\.exports" lib/agents/mistral-telemetry.ts` returns 0. If any test fails, fix and re-run.

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do not modify any file outside `lib/agents/mistral-telemetry.ts` and `lib/agents/mistral.ts` (comment update only).
- Do not add `@ts-nocheck` or `@ts-expect-error` directives.
- Do not change the logic, behavior, or public API of `parseMistralMeta`, `extractMistralTelemetry`, `getMistralProviderModel`, or `DEFAULT_MISTRAL_LOG_DIR`.

## Stop Rules

- Stop if the conversion requires changes beyond syntax (logic, behavior, or API changes) — escalate for scope review.
- Stop if `./scripts/verify-local.sh all` reveals a regression that cannot be fixed by a syntax-only change.
- Stop if the fix would require modifying `test/telemetry-stubs.test.js` — the test file's CJS `require()` is correct for Node.js test runner and out of scope.
