# Checkpoint 7 — Operator status command

## Summary
Wired an operator status command for github-publish mode. The application-owned
`GithubPublishStatusUseCase.execute` returns local head, published head,
awaiting-verification, verified-but-blocked, and failed-verification lists; when
the mode is disabled (default) it reports `enabled: false` and does no git work,
leaving `px status` and the squash-merge path unchanged. Composition
`createGithubPublishStatusUseCase` binds the git-adapter port and product-config
resolver; the CLI factory `createGithubPublishStatusCommand` renders the result.
The command is registered in `KNOWN_COMMANDS`, `READ_ONLY_COMMANDS`, and help.

Delivered:
- `src/application/github-publish/status.ts` — `computeGithubPublishStatus`.
- `src/application/github-publish/status-command-use-case.ts` —
  `GithubPublishStatusUseCase`, `GithubPublishStatusResult`.
- `src/composition/github-publish-status.ts` — `createGithubPublishStatusUseCase`.
- `src/interfaces/cli/github-publish-status.ts` — `createGithubPublishStatusCommand`,
  `renderGithubPublishStatus`.
- `src/composition/create-cli.ts`, `src/interfaces/cli/runtime.ts` — command
  registration + help text.
- `src/application/ports/github-publish.ts` — `GithubPublishConfig` port.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Status exposes head/awaiting/blocked/failed | `test/github-publish.test.ts`, `"status reports awaiting, verified-blocked, and failed"` | PASS |
| Status use case (application-owned) | `src/application/github-publish/status-command-use-case.ts`, `GithubPublishStatusUseCase.execute` | PASS |
| Command registered + wired | `src/interfaces/cli/runtime.ts` `KNOWN_COMMANDS` `github-publish-status`; `src/composition/create-cli.ts` registry | PASS |
| No-op when disabled (default path untouched) | `src/application/github-publish/status-command-use-case.ts` `config.enabled` guard | PASS |
| Verified-but-blocked computed correctly | `src/application/github-publish/status.ts`, `computeGithubPublishStatus` `verifiedBlocked` | PASS |

## Next action
Run the final integration gate and finalize CP-8 (CP-8).
