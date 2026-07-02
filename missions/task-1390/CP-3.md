# CP-3: Fix Verified

## Work Done

Verified the complete fix after the build pipeline update:

1. **Shebang present**: `npm run build:cjs` produces `px.js` starting with `#!/usr/bin/env node`
2. **Shell-init works**: `node px.js shell-init bash` exits 0 and output contains `px() {`
3. **Reproduction test green**: `test/task-1390-shell-init-shebang.test.js` passes (2/2)
4. **npm pack includes px.js**: Tarball contains `px.js` with shebang intact after extraction

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `px.js` begins with shebang after build | `px.js:1` — `head -c 22 px.js` → `#!/usr/bin/env node` |
| `node px.js shell-init bash` exits 0 with `px() {` | `px.js:1` — `node px.js shell-init bash` output line 5: `px() {` |
| Reproduction test passes | `test/task-1390-shell-init-shebang.test.js:29` — "px.js has shebang for direct execution (task-1390)" ✔ |
| Reproduction test: shell-init output valid | `test/task-1390-shell-init-shebang.test.js:40` — "px.js shell-init bash produces valid shell function (task-1390)" ✔ |
| npm pack includes px.js with shebang | `npm pack --dry-run` → `px.js` in tarball; extracted `package/px.js` line 1: `#!/usr/bin/env node` |

## Next action
Proceed to CP-4: Regression check — verify all existing `test/px-shell-init.test.js` tests still pass.
