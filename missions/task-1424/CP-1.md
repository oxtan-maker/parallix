# CP-1: Red reproduction test

## Summary

Added `test/task-1424-post-integrate-publish-reinstall.test.js`, a deterministic
reproduction of the packaged-runtime stale-build false positive described in the
backlog report. The test:

1. Asserts the source checkout's own `build-freshness.js` guard passes on the
   current tree (proves the checkout itself is not stale before packing).
2. Runs the real `npm pack` on the checkout (same primitive
   `scripts/refresh-global-px.sh` uses).
3. Runs `npm install -g --prefix <tmp>` of the produced tarball (same primitive the
   script uses).
4. Loads the **installed** package's own `lib/core/build-freshness.js` and calls
   `assertBuildFreshness()` against the **installed** tree, exactly as
   `npm run publish:guard` (`prepack`) does.
5. Asserts the installed runtime (`px --version`) actually runs.

Root cause confirmed empirically: `npm pack`/`npm install -g` extraction assigns
each file its own extraction-time mtime (tar entries are not written with
preserved source mtimes in this path), and files are extracted in directory-sorted
order. Since `<name>.ts` sorts after `<name>.js` for every compiled pair under
`lib/commands/`, every pair is extracted `.js` then `.ts`, so the `.ts` sibling
*always* ends up with a later mtime than the `.js` it was compiled from — even
though the `.js` is perfectly fresh. This reproduces on every run, matching the
backlog report, and is a property of the tarball/install round-trip, not of a
stale checkout.

## Goal Check

| Criterion | Evidence |
|---|---|
| Reproduction test exists at the mission-declared path | `test/task-1424-post-integrate-publish-reinstall.test.js` |
| Test fails on pre-fix tree with a stale-build signal | Running `node --require ./test/bootstrap-parallix-home.js --test test/task-1424-post-integrate-publish-reinstall.test.js` fails with `AssertionError` and stderr `[parallix] Stale build detected...` for every `lib/commands/*.js`/`*.ts` pair, e.g. `lib/commands/stats.js (mtime ... < .../stats.ts mtime ...)` — matches the exact failure signature from the backlog task description |
| Failure proves an installed-package/runtime problem, not a stale checkout | Test's first assertion (`checkoutGuard`, test file lines 33-40) independently confirms the source checkout itself passes `assertBuildFreshness` before any packing occurs; the failure only appears after `npm pack` + `npm install -g` (test file lines 66-96) |
| Test models the real self-update primitives | Test calls `npm pack` and `npm install -g` directly, the same two primitives invoked by `scripts/refresh-global-px.sh:32-36` |

Test run command and result:
```
$ node --require ./test/bootstrap-parallix-home.js --test test/task-1424-post-integrate-publish-reinstall.test.js
✖ installed tarball runtime does not trip the stale-build guard on a fresh, correctly-built checkout
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

Next action: Implement CP-2/CP-3 — the minimal fix is to stop shipping `.ts` sources under `lib/` in the published npm package (they are not needed at runtime; the compiled `.js` is canonical for installed packages), which removes the comparison targets that produce the false positive while leaving the checkout-side guard (used by `prepack`/`publish:guard` against the full source tree) untouched.
