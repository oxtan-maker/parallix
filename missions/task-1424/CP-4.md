# CP-4: Update publish/self-update documentation

## Summary

Updated `docs/authority-reference.md`'s "Public distribution" section (the
authoritative public distribution story referenced by ADR 0044) to describe the
new packaged-runtime freshness semantics, immediately after the existing
paragraph describing the checkout-side `npm pack`/`npm publish` fail-closed
behavior:

- States that the freshness check only runs against the checkout, not the
  installed package, and why (`package.json`'s `files` entry
  `!lib/**/*.ts` excludes `.ts` sources under `lib/` from the published
  tarball).
- Explains the root cause the exclusion avoids: tarball extraction assigns
  each file its own extraction-time mtime in directory-sorted order, and
  `<name>.ts` always sorts after `<name>.js`, so a shipped `.ts`/`.js` pair
  would otherwise always look stale on a fresh install.
- Clarifies the checkout-side guard is untouched and still fails closed before
  a stale checkout is ever packed.

No other operator-facing doc referenced the exact command sequence or
freshness semantics in a way this fix changes: `workflow.config.json` still
wires the hook to `./scripts/refresh-global-px.sh`, and the script's
documented sequence (bump → build → pack → install) is unchanged — only its
cleanup timing changed (trap-based instead of post-success-only), which is not
independently documented elsewhere.

## Goal Check

| Criterion | Evidence |
|---|---|
| Docs describe the actual supported flow after the fix | `docs/authority-reference.md` lines 343-357 (new paragraph after "npm pack and npm publish now fail closed...") |
| Docs reference the mechanism (files exclusion), not just the symptom | `docs/authority-reference.md` new paragraph cites `package.json`'s `files` entry `!lib/**/*.ts` |
| No other doc claims an unconditional/always-rebuilds success path that is now false | Confirmed via `grep -n -iE "refresh-global-px\|publish:guard\|build-freshness\|stale.build\|npm pack" docs/authority-reference.md` — only this section discusses the mechanism; no other doc file references `refresh-global-px.sh` or the freshness check |

Next action: CP-5 — run the mission regression test, the directly affected packaging/self-update tests, `./scripts/verify-local.sh static-analysis`, and `./scripts/verify-local.sh all`, and record final Goal Check evidence.
