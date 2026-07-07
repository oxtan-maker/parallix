# CP-2: Minimal correction point identified

## Summary

Root cause traced (with the CP-1 reproduction) to the tarball round-trip itself,
not to a stale checkout: `npm pack`/`npm install -g` extraction writes each file
with its own extraction-time mtime, in directory-sorted order. Because
`<name>.ts` always sorts after `<name>.js` for every guarded pair under
`lib/commands/`, every pair is extracted `.js` then `.ts` a few milliseconds
apart, so the `.ts` sibling always ends up looking newer than the `.js` it was
compiled from — deterministically, on every install, regardless of actual build
freshness.

Three candidate fix points were considered per the mission's Risk/Assumption
list:

1. **Runtime freshness heuristic** (e.g. compare content hashes instead of
   mtimes, or add a grace window). Rejected: still runs the same check against
   files that were never meant to be compared post-install, and a grace window
   is a heuristic band-aid, not a correctness fix.
2. **Self-update script sequencing** (e.g. `touch` the `.js` files after
   install). Rejected: this is exactly the ad hoc repair the mission's success
   criteria calls out for removal (already present as a test helper in
   `test/package-persistent-data.test.js` prior to this mission), and it would
   need to run on every future install forever.
3. **Package/install artifact normalization — stop shipping `.ts` sources under
   `lib/` in the published tarball.** Selected. The compiled `.js` is already
   canonical for an installed package; the `.ts` source is not needed at
   runtime and its presence is the only reason the mtime comparison can ever
   fire post-install. Removing it from the package removes the comparison
   targets, so `findStaleBuildArtifacts`'s existing `!fs.existsSync(tsPath)`
   skip branch (`lib/core/build-freshness.ts:36`) naturally makes every pair
   pass for an installed package, with no change to the comparison logic
   itself.

This preserves the checkout-side guard (used by `npm run prepack`/
`publish:guard` against the full source tree, and by `px integrate`'s
verification capture) exactly as-is — it still fails closed on a genuinely
stale checkout before that checkout is ever packed. Only the packaged/installed
surface is narrowed, and the narrowing is documented in-code
(`lib/core/build-freshness.ts:88-99`) and in
`docs/authority-reference.md` (Public distribution section) per the mission's
"explicit, documented rationale tied to packaged-runtime semantics"
requirement.

## Goal Check

| Criterion | Evidence |
|---|---|
| Minimal correction point identified without broadening scope | `package.json:44-45` — added `"!lib/**/*.ts"` immediately after the existing `"lib/"` files entry; no change to `lib/commands/*.ts` command logic |
| Checkout-side stale-build guard preserved | `lib/core/build-freshness.ts` comparison logic (`findStaleBuildArtifacts`, lines 32-51) is unchanged; `test/task-1417-stale-publish-build-check.test.js` (`prepublishOnly fails closed when a guarded compiled file is stale`, `prepublishOnly still passes when guarded compiled files are fresh`) still pass |
| Fix targets the actual root cause (tarball extraction ordering), not a symptom | Verified empirically in CP-1: packing/installing the checkout with the fix applied produces zero `.ts` files under the installed `lib/commands/` (`npm pack --dry-run` shows 0 matches for `\.ts$` after the `files` change) |

Next action: Implement CP-3 — apply the packaging fix (already validated here), update `test/package-persistent-data.test.js`'s ad hoc `utimes` helper into a negative-control assertion, and add tarball cleanup to `scripts/refresh-global-px.sh`.
