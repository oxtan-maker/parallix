# CP-2: Add 'lib' to knownAreas in integrate.js

## Work Done

Added `'lib'` to the `knownAreas` array in `lib/commands/integrate.js:272` so that file changes under `lib/` are detected as belonging to the `lib` area.

Changed line 272 from:
```js
const knownAreas = ['server', 'auth-server', 'web-client', 'docs', 'workflow', 'android', 'kubernetes'];
```
to:
```js
const knownAreas = ['lib', 'server', 'auth-server', 'web-client', 'docs', 'workflow', 'android', 'kubernetes'];
```

Verified that `parseFilesToAreas('lib/commands/integrate.js\nserver/src/main.java')` returns `['lib', 'server']`.

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `parseFilesToAreas` detects 'lib' area | Node test: `parseFilesToAreas('lib/commands/integrate.js')` → `['lib', ...]` |
| 2 | `knownAreas` array updated | `lib/commands/integrate.js:272` — `'lib'` is first element |

## Next action
Create `config/integration-pipelines.json` with the `lib` gate entry (CP-3).
