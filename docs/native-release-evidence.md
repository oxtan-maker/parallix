# Native executable release evidence

Native executables are supported only when their own runner has produced an
evidence record. The initial ADR 0044 candidates are Linux x64, Linux arm64,
macOS x64, macOS arm64, and Windows x64; no cross-built output is a support
claim.

## Record native evidence

On a candidate's native runner, with a Node 25 or 26 SEA toolchain:

```sh
node scripts/native-release-evidence.js --verify
```

The command builds the SEA, runs the complete TASK-2286 shipped-artifact suite,
and writes `release-evidence/<native-target>/native-evidence.json`. The record
contains the runner platform/architecture, source commit, pinned runtime,
commands, executable digest, signature status, and the six exercised surfaces.
Do not copy a record to a different target.

A target is omitted from native support documentation when it has no record or
when either command fails. The npm package remains the supported fallback; see
ADR 0044 for its separate runtime floor and distribution boundary.

## Currently supported native target

Linux x64 is the only currently supported native executable target. Its native
record is `release-evidence/linux-x64/native-evidence.json`; the other ADR 0044
candidates have no native-runner record and are not supported. Install the
Linux x64 archive by extracting `parallix-v<version>-linux-x64.tar.gz`, adding
the extracted directory to `PATH`, and running `px --version`. Uninstall by
removing that extracted directory. Use the npm bundle when native Linux x64 is
not applicable.
