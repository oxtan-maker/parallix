# CP 3 — Linux x64 archive and supply-chain audit

## Summary

Created the target-specific archive `parallix-v1.4.45-linux-x64.tar.gz` from
the Linux x64 SEA payload and wrote its audit record. The archive audit
requires the executable, LICENSE, NOTICES, checksum manifest, CycloneDX SBOM,
build metadata, signature-status record, and installation instructions. It
rejects source checkouts, tests, node_modules, secrets, and operator state.

The archive has a verified SHA-256 digest. Its embedded executable is
explicitly unsigned, which is permitted evidence for this non-public release
exercise; no production signing credential was used.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Linux x64 archive uses the ADR 0044 target-specific executable name | `release-evidence/linux-x64/archive-audit.json:3`; `scripts/package-native-release.js:17` | PASS |
| Audit requires executable, license/notices, checksums, SBOM, metadata, signature status, and install instructions | `scripts/package-native-release.js:13`; "task-2287 native archive audit accepts declared release materials with verified checksums" | PASS |
| Archive audit rejects tests, operator state, secrets, and undeclared runtime dependencies | `scripts/package-native-release.js:75`; "task-2287 native archive audit rejects operator state and undeclared test material" | PASS |
| Native record supplies source commit, pinned runtime, and explicit unsigned status | `release-evidence/linux-x64/native-evidence.json:9`; `release-evidence/linux-x64/native-evidence.json:33` | PASS |

Next action: validate clean Linux x64 archive installation and uninstall, document the sole proven target plus npm fallback, and exercise target-scoped withdrawal.
