# CP-1 — TypeScript test-authoring boundary

## Summary

Confirmed that prerequisite missions TASK-2224 and TASK-2227 are present in the
reachable history (`3e9db86b` and `7adb1164`). The existing check-only test
project already enables checked JavaScript, but its `include` list selects only
`test/**/*.js`. The default runner likewise discovers only `.test.js` files.

The phase boundary is therefore limited to adding `test/**/*.ts` to
`tsconfig.test.json` and teaching `test/run-default-tests.js` to discover
`.test.ts` files and preload the installed `tsx` loader when one is selected.
The selected representative is a new, root-level mock-only Node test that will
assert calls made to a typed in-memory reporter. It needs no production import,
network access, Forgejo access, child process, or suite conversion.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Test typecheck configuration includes the selected TypeScript source without dropping JavaScript sources | `tsconfig.test.json:12` currently scopes the required include boundary; CP-2 will extend it with `test/**/*.ts` | PENDING |
| Normal test command discovers the TypeScript test and existing JavaScript tests | `test/run-default-tests.js:39` currently filters root test files; `package.json:56` defines `npm test` | PENDING |
| Static analysis passes after the toolchain change | `./scripts/verify-local.sh static-analysis` | PENDING |
| A committed `.ts` test contains a named assertion and is executed by the normal suite | `test/` is the selected test directory; the planned test uses Node's test API as in `test/telemetry-stubs.test.js:67` | PENDING |
| No focused or bare skipped declarations are introduced | `scripts/test-hygiene.sh` | PENDING |
| The phase implementation can be reverted without unrelated changes | `missions/task-2229/CP-1.md` records the phase-owned boundary; the implementation commit will contain only runner/config/test paths | PENDING |

Next action: extend the two identified discovery/typecheck boundaries and add the isolated typed reporter test as `test/typescript-test-authoring.test.ts`.
