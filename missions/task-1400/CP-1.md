# CP-1: Convert mistral-telemetry.ts to ESM

## Summary

Converted `lib/agents/mistral-telemetry.ts` from CJS to ESM syntax:

- Replaced `'use strict'; const fs = require('fs'); const os = require('os'); const path = require('path');` with `import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';` (`lib/agents/mistral-telemetry.ts:1-3`).
- Added `export` to `DEFAULT_MISTRAL_LOG_DIR` (`lib/agents/mistral-telemetry.ts:27`), `parseMistralMeta` (`lib/agents/mistral-telemetry.ts:65`), `extractMistralTelemetry` (`lib/agents/mistral-telemetry.ts:101`), and `getMistralProviderModel` (`lib/agents/mistral-telemetry.ts:157`).
- Removed the trailing `module.exports = { ... }` block.
- Updated the stale comment reference in `lib/agents/mistral.ts:25` from `mistral-telemetry.js` to `mistral-telemetry.ts`.
- No logic, function signatures, or interfaces were changed.

## Goal Check

| Criterion | Evidence | Result |
|---|---|---|
| Zero `require(` in target file | `grep -c "require(" lib/agents/mistral-telemetry.ts` → `0` | PASS |
| Zero `module.exports` in target file | `grep -c "module\.exports" lib/agents/mistral-telemetry.ts` → `0` | PASS |
| Named ESM exports present | `lib/agents/mistral-telemetry.ts:27,65,101,157` (`export const DEFAULT_MISTRAL_LOG_DIR`, `export function parseMistralMeta`, `export function extractMistralTelemetry`, `export function getMistralProviderModel`) | PASS |
| Comment reference updated | `lib/agents/mistral.ts:25` now reads `mistral-telemetry.ts` | PASS |
| Existing tests still pass | `node --test test/telemetry-stubs.test.js` → `tests 13, pass 13, fail 0` (e.g. `parseMistralMeta extracts telemetry from meta.json stats`, `extractMistralTelemetry parses the most recent session meta.json`, `getMistralProviderModel returns correct fallback identity`) | PASS |

Next action: Run CP-2 — full `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` verification pass.
