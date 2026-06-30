# CP 3: Convert px.js → px.ts (root CLI entry point)

## Work Done

Converted root `px.js` (234 lines) to `px.ts` (255 lines) with ES module imports/exports.

### Key decisions:
- Converted CommonJS `require`/`module.exports` to ES `import`/`export`
- Used `import * as fmt from './lib/core/fmt.js'` for namespace import
- Used `import { createEvent } from './lib/review/review-events.js'` for named import
- Used `import * as workflow from './index.js'` for namespace import of root index
- Used `import packageJson from './package.json'` for JSON import (requires `resolveJsonModule`)
- Used `import missionStart = require('./lib/commands/mission-start.js')` for CJS module with `@ts-expect-error`
- Preserved shebang line (`#!/usr/bin/env node`)
- Preserved all 6 exported members: `formatVersionInfo`, `parseArgs`, `parseReviewEventArgs`, `run`, `shellInit`, `versionInfo`
- Added TypeScript interfaces: `ParsedArgs`, `VersionInfo`, `ReviewEventParsed`, `RunOptions`
- Added explicit type annotations on function parameters and return types
- Handled `string | null` → `string` narrowing for `eventArgs.type`, `eventArgs.actor`, `eventArgs.timestamp`
- Handled `result.path` null check before `path.relative()` call
- Used type assertion for `exitFn` to satisfy `(code?: number) => never` signature from `workflow.main`

### Evidence:
- `px.ts` created (255 lines), `px.js` removed
- `npx tsc --noEmit` with extended include and `resolveJsonModule` reports **zero errors**

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| px.ts compiles with project tsconfig (extended) | `npx tsc --noEmit --project tsconfig.test.json` — zero errors |
| All original exports preserved | 6 named exports match 6 entries in original `module.exports` |
| Shebang preserved | Line 1: `#!/usr/bin/env node` |
| JSON import supported | `import packageJson from './package.json'` with `resolveJsonModule: true` |
| No behavior change | Logic identical to original; only type annotations and import syntax changed |

## Next action
Update `tsconfig.json` to include root `.ts` files and enable `resolveJsonModule` (CP 4).
