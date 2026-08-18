---
id: TASK-2381
title: Exclude build/sea from npm tarball so package-content audit passes
status: refined
assignee: [claude]
created_date: '2026-08-18 04:55'
labels:
  - release
  - build
  - npm
  - user_value
  - bug
dependencies: []
references:
  - scripts/package-content-audit.ts
  - scripts/build-canonical-bundle.ts
  - scripts/build-sea.ts
  - scripts/package-native-release.ts
  - package.json
priority: high
ordinal: 100917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`npm publish` fails in `prepublishOnly` -> `test:package-content` with 34 violations, all of the form:

```
checksum manifest does not cover published file: build/sea/px
checksum manifest does not cover published file: build/sea/manifest.sha256
... (every file under build/sea/)
```

Root cause: two scripts disagree about ownership of `build/sea/`.

- `scripts/build-sea.ts` writes the SEA payload into `build/sea/` (a platform-specific native binary plus its own copies of the assets, prompts, migrations, LICENSE, NOTICES, package.json, manifest.sha256).
- `scripts/build-canonical-bundle.ts:209` builds `build/manifest.sha256` from a staging directory that deliberately does not own `build/sea` (see the comments at lines 72-93: "build/sea is not ours"), so the checksum manifest never covers those files.
- `package.json` `files` lists `build/`, so `npm pack` sweeps the whole published `build/` tree including `build/sea/`.
- `scripts/package-content-audit.ts` `checksumViolations()` requires every packed `build/**` file to appear in the manifest, so every SEA file is a violation.

`build/sea/` is gitignored, so this only reproduces on a machine that has run the SEA build; CI publishing from a clean tree would not hit it, which is why it slipped through.

The SEA binary must not ship inside the npm tarball anyway: it is a ~100MB platform-specific executable, and it is already released separately via `scripts/package-native-release.ts`. The fix is to exclude it from the package, not to add it to the checksum manifest.

Suggested minimal fix:
1. Add a negated pattern to `package.json` `files` (e.g. `"!build/sea"`) so `npm pack` never picks up the SEA payload.
2. Add `build/sea/` to `FORBIDDEN_PREFIXES` in `scripts/package-content-audit.ts` so the exclusion is enforced by the audit rather than depending on packing behaviour alone, giving a clear "forbidden package file" message if it ever regresses.

Verification requires a checkout where `build/sea/` exists (run `tsx scripts/build-sea.ts` first, or stage a dummy file under `build/sea/`), otherwise the failure is not reproducible.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `npm run test:package-content` passes in a working tree where `build/sea/` is populated by `tsx scripts/build-sea.ts`
- [ ] #2 `npm pack --dry-run --json` lists no path under `build/sea/`
- [ ] #3 The package-content audit fails with a clear `forbidden package file: build/sea/...` violation if `build/sea` is ever reintroduced into the packed file list
- [ ] #4 `npm publish --dry-run` completes `prepublishOnly` without package-content violations
- [ ] #5 Native SEA release path (`scripts/package-native-release.ts`) still finds and tars `build/sea/` unchanged
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
