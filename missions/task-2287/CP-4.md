# CP 4 — install, support documentation, and scoped withdrawal

## Summary

Validated a clean Linux x64 archive extraction by running its executable with
an empty `PATH`, then uninstalled it by removing the extracted directory. The
record confirms that npm remains independent and preserved. Native support
documentation names only Linux x64; all other candidate targets remain absent
because no native evidence record exists.

Conducted a target-scoped withdrawal exercise in an isolated release catalog.
It removed the Linux x64 archive and its support row while retaining the npm
fallback. There are no other currently proven native targets to preserve; the
withdrawal helper’s regression test additionally proves preservation of a
second target when one exists.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Clean Linux x64 archive install and removal-based uninstall passed | `release-evidence/linux-x64/install-uninstall.json:4`; `scripts/validate-native-release.js:18` | PASS |
| Documentation lists only the native target with a record and preserves the npm fallback | `docs/native-release-evidence.md:28`; `docs/native-release-evidence.md:33` | PASS |
| Withdrawal removes exactly one target archive and preserves other targets plus npm fallback | "task-2287 target withdrawal removes exactly one archive and preserves other targets plus npm fallback"; `scripts/withdraw-native-release.js:9` | PASS |
| Executed withdrawal exercise preserves npm when Linux x64 is the sole proven target | `release-evidence/linux-x64/withdrawal-exercise.json:5`; "task-2287 withdrawal exercise records npm preservation when only one target is proven" | PASS |

Next action: run the mission integration gate and update the repository knowledge graph before handing off the committed checkpoint set.
