# CP-2: Build Pipeline Updated

## Work Done

Updated `build:cjs` in `package.json` to add a post-TS compilation shebang restoration step. The new script:

1. Runs `tsc --rootDir . --outDir . --module CommonJS --moduleResolution Node --esModuleInterop` (existing)
2. Checks if `px.js` line 1 starts with `#!`; if not, inserts `#!/usr/bin/env node` at the top via `sed -i '1i#!/usr/bin/env node'`
3. Makes `px.js` executable via `chmod +x px.js`

The shebang check (`grep -q '^#!'`) ensures idempotency — if TypeScript preserved the shebang from `px.ts`, `sed` is skipped. If TS stripped it, `sed` restores it.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| build:cjs updated | `package.json:51` — `"build:cjs": "tsc ... && { head -1 px.js | grep -q '^#!' || sed -i '1i#!/usr/bin/env node' px.js; } && chmod +x px.js"` |
| Shebang restoration conditional | `package.json:51` — `head -1 px.js \| grep -q '^#!' \|\| sed -i '1i#!/usr/bin/env node' px.js` |
| Executable permission set | `package.json:51` — `chmod +x px.js` |
| Clean build produces shebang | `head -1 px.js` → `#!/usr/bin/env node` after `npm run build:cjs` |
| px.js is executable | `ls -la px.js` → `-rwxrwxr-x` |

## Next action
Proceed to CP-3: Full verification — run build, test shebang, run shell-init, and confirm reproduction test passes.
