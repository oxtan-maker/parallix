# CP-3 — Installed tarball proof

## Summary

Updated both named package integration tests for the `dist/` artifact. The
publish/reinstall successor now packs and installs into a temporary npm prefix,
asserts the installed package contains `dist/px.js` and its map while excluding
sibling runtime, source, tests, mission/backlog, and development paths, then
runs `px --version`, `px status`, and `px stats` from a temporary directory
outside the checkout. It verifies the version report identifies the installed
`dist/px.js` path.

The persistent-data successor now imports the installed `dist/lib` modules and
executes `dist/px.js`, retaining its proof that PARALLIX_HOME state survives a
global tarball reinstall. Both focused integration tests passed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Installed executable resolves to dist/px.js | `test/task-1424-post-integrate-publish-reinstall.test.js:83`, `test/task-1424-post-integrate-publish-reinstall.test.js:97`; "installed dist-layout tarball runs read-only commands outside the checkout" | PASS |
| Installed tarball excludes source, tests, development config, and operator state | `test/task-1424-post-integrate-publish-reinstall.test.js:85`; "installed dist-layout tarball runs read-only commands outside the checkout" | PASS |
| Representative read-only commands run outside the checkout | `test/task-1424-post-integrate-publish-reinstall.test.js:101`; "installed dist-layout tarball runs read-only commands outside the checkout" | PASS |
| Persistent-data package behavior uses the dist runtime | `test/package-persistent-data.test.js:80`; "global tarball reinstall preserves PARALLIX_HOME stats and agent blocklist" | PASS |
| Source maps are present in an installed tarball | `test/task-1424-post-integrate-publish-reinstall.test.js:84`; `test/package-persistent-data.test.js:82` | PASS |
| Source-checkout sibling build remains the development/test runtime | `package.json:54`; `npm run build:cjs` | PASS |

Next action: update the MINOR changelog and authoritative installation instructions, then run the mission’s full verification gate on the final tree.
