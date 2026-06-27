# CP-1: verification.js → verification.ts

## Work Done

Converted `lib/core/verification.js` (166 lines) to `lib/core/verification.ts` (200 lines) with full ESM/TypeScript conversion:

- Replaced `const { git, run } = require('./git')` with `import { git, run } from './git.js'`
- Replaced `const { loadAdapterConfig } = require('./product-config')` with `import { loadAdapterConfig } from './product-config.js'`
- Replaced `const fs = require('fs')` with `import * as fs from 'node:fs'`
- Replaced dynamic `require('./fmt')` calls with static `import { log } from './fmt.js'`
- Replaced dual export pattern (`module.exports = runWorkflow` + `module.exports.X = X`) with `export default function runWorkflow(...)` + named `export const`/`export function` statements
- Added TypeScript interfaces: `GitFn`, `VerificationAdapterConfig`, `VerificationProof`, `PublishedTreeStateOk`, `PublishedTreeStateFail`, `PublishedTreeState`
- Preserved all JSDoc @param/@returns annotations
- Preserved injectable-dependency pattern (gitRunner, runFn parameters)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Zero require() in .ts file | `grep -rc 'require(' lib/core/verification.ts` → 0 matches |
| Zero module.exports in .ts file | `grep -rc 'module.exports' lib/core/verification.ts` → 0 matches |
| tsc --noEmit clean | `npx tsc --noEmit` → zero errors |
| All 8 verification tests pass | `node --test test/verification.test.js` → 8 pass, 0 fail |
| Test: resolveVerificationAdapter defaults | `test/verification.test.js:39` → ✔ resolveVerificationAdapter defaults to no validation (no command) |
| Test: formatVerificationCommand unconfigured | `test/verification.test.js:47` → ✔ formatVerificationCommand returns the no-gate notice when unconfigured |
| Test: formatVerificationCommand area substitution | `test/verification.test.js:53` → ✔ formatVerificationCommand substitutes the configured area placeholder |
| Test: runVerificationGate no-op pass | `test/verification.test.js:88` → ✔ runVerificationGate is a no-op pass when no command is configured |
| Test: runVerificationGate executes command | `test/verification.test.js:108` → ✔ runVerificationGate executes the configured command via bash |
| Test: readPublishedTreeState | `test/verification.test.js:139` → ✔ readPublishedTreeState uses the git-style runner by default |
| Test: captureVerifiedTreeProof | `test/verification.test.js:164` → ✔ captureVerifiedTreeProof uses the git-style runner by default |
| TypeScript interfaces defined | `lib/core/verification.ts:24` GitFn, `lib/core/verification.ts:26` VerificationAdapterConfig, `lib/core/verification.ts:31` VerificationProof, `lib/core/verification.ts:40-52` PublishedTreeState |

## Next action
Convert `lib/core/mission-utils.js` to `lib/core/mission-utils.ts` (checkpoint CP-2).
