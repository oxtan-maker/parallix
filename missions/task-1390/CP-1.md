# CP-1: Reproduction Test

## Work Done

Verified the reproduction test at `test/task-1390-shell-init-shebang.test.js` exists and is correctly structured. The test contains two assertions:

1. **Shebang check**: Reads `px.js` and asserts the first line equals `#!/usr/bin/env node`
2. **Shell-init check**: Runs `node px.js shell-init bash` and asserts exit code 0, output contains `px() {`, `command px`, and `PIPESTATUS`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Test file exists | `test/task-1390-shell-init-shebang.test.js:29` — `test('px.js has shebang for direct execution (task-1390)'` |
| Test checks shebang | `test/task-1390-shell-init-shebang.test.js:33` — `assert.equal(firstLine, '#!/usr/bin/env node'` |
| Test checks shell-init output | `test/task-1390-shell-init-shebang.test.js:40` — `test('px.js shell-init bash produces valid shell function (task-1390)'` |
| Test verifies px() function header | `test/task-1390-shell-init-shebang.test.js:47-49` — `output.includes('px() {')` |
| Test verifies command px reference | `test/task-1390-shell-init-shebang.test.js:51-53` — `output.includes('command px')` |
| Test verifies PIPESTATUS | `test/task-1390-shell-init-shebang.test.js:55-57` — `output.includes('PIPESTATUS')` |
| Test passes after clean build | `npm run build:cjs && node --test test/task-1390-shell-init-shebang.test.js` → 2 pass, 0 fail |

## Next action
Proceed to CP-2: Update `build:cjs` script in `package.json` to add a post-tsc shebang restoration step for `px.js`.
