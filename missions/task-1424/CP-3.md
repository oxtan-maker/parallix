# CP-3: Implement packaged-runtime/self-update fix

## Summary

Implemented the fix identified in CP-2 and updated the tests that encoded the
broken/ad hoc behavior:

- `package.json:44-45` — added `"!lib/**/*.ts"` to the `files` array immediately
  after `"lib/"`, so the published tarball no longer ships TypeScript sources
  under `lib/`. Confirmed with `npm pack --dry-run`: 65 `.ts` files were shipped
  before the change, 0 after.
- `lib/core/build-freshness.ts:88-99` — documented, in the `assertBuildFreshness`
  docstring, why the check is checkout-only by design and what would otherwise
  false-positive (the tarball-extraction ordering issue found in CP-1).
- `test/package-persistent-data.test.js` — removed the ad hoc `fs.utimesSync`
  repair of installed `.js` files (previously needed to make the guard pass
  after install) and replaced it with a negative-control assertion that
  `lib/commands/` in the installed tree contains no `.ts` files at all.
- `test/refresh-global-px-script.test.js` — added an assertion that the script
  contains a trap-based tarball cleanup.
- `scripts/refresh-global-px.sh:33-34` — replaced the single `rm -f
  "${TARBALL}"` that ran only after a successful `npm install -g` with
  `trap 'rm -f "${TARBALL}"' EXIT` right after the tarball is created, so the
  tarball is removed whether the script succeeds or a later step
  (`npm install -g`, or anything after) fails and exits under `set -euo
  pipefail`.

## Goal Check

| Criterion | Evidence |
|---|---|
| Packaged install no longer requires ad hoc `utimes`/touch repair | `test/package-persistent-data.test.js` — old `fs.utimesSync` block removed, replaced by assertion `assert.ok(!entry.endsWith('.ts'), ...)` over the installed `lib/commands/` directory; test `global tarball reinstall preserves PARALLIX_HOME stats and agent blocklist` passes |
| CP-1 regression test passes on the fixed tree | `node --require ./test/bootstrap-parallix-home.js --test test/task-1424-post-integrate-publish-reinstall.test.js` → `✔ installed tarball runtime does not trip the stale-build guard on a fresh, correctly-built checkout` |
| Checkout-side guard still fails closed on genuinely stale compiled output | `test/task-1417-stale-publish-build-check.test.js` → `✔ prepublishOnly fails closed when a guarded compiled file is stale`, `✔ prepublishOnly still passes when guarded compiled files are fresh` (both pass unchanged) |
| Tarball cleaned up on success and failure | `scripts/refresh-global-px.sh:34` (`trap 'rm -f "${TARBALL}"' EXIT`); `test/refresh-global-px-script.test.js` → `✔ scripts/refresh-global-px.sh cleans up the packed tarball on both success and failure` |
| Script still bumps version, builds, packs, reinstalls | `test/refresh-global-px-script.test.js` → `✔ scripts/refresh-global-px.sh bumps the patch version and reinstalls from a packed tarball of this checkout` (unchanged assertions still pass against the edited script) |

Next action: CP-4 — update operator-facing docs to describe the packaged-runtime freshness narrowing (already drafted into `docs/authority-reference.md` alongside this fix); confirm no further doc drift remains, then move to CP-5 final verification.
