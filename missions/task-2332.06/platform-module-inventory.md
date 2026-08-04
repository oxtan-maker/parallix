# Platform module inventory

This is the CP-1 ownership ledger for every production file that existed below
`src/platform/` at mission start.  The final paths are intentionally concrete:
later checkpoints move each source to the recorded destination rather than
creating a legacy compatibility route.

| Former path | Final path | Responsibility |
|---|---|---|
| `src/platform/assets/asset-store.ts` | `src/adapters/assets/asset-store.ts` | Packaged asset filesystem adapter |
| `src/platform/assets/runtime-assets.ts` | `src/adapters/assets/runtime-assets.ts` | Packaged runtime asset adapter |
| `src/platform/runtime/index.ts` | `src/interfaces/cli/runtime.ts` | CLI request dispatch and rendering |
| `src/platform/runtime/px.ts` | `src/composition/create-cli.ts` + `src/entry/px.ts` | CLI composition and minimal process bootstrap |
| `src/platform/runtime/lib/adapters/execute-mission-adapters.ts` | `src/adapters/mission/execute-mission-adapters.ts` | Mission port implementations |
| `src/platform/runtime/lib/adapters/legacy-stats-backfill-adapter.ts` | `src/adapters/mission/stats-backfill-adapter.ts` | Statistics port implementation |
| `src/platform/runtime/lib/agents/agent-config.ts` | `src/adapters/agents/agent-config.ts` | Agent configuration adapter |
| `src/platform/runtime/lib/agents/agents.ts` | `src/adapters/agents/agents.ts` | Agent process adapter |
| `src/platform/runtime/lib/agents/claude-telemetry.ts` | `src/adapters/agents/claude-telemetry.ts` | Claude telemetry adapter |
| `src/platform/runtime/lib/agents/claude.ts` | `src/adapters/agents/claude.ts` | Claude launcher adapter |
| `src/platform/runtime/lib/agents/codex-telemetry.ts` | `src/adapters/agents/codex-telemetry.ts` | Codex telemetry adapter |
| `src/platform/runtime/lib/agents/codex.ts` | `src/adapters/agents/codex.ts` | Codex launcher adapter |
| `src/platform/runtime/lib/agents/custom-capacity.ts` | `src/adapters/agents/custom-capacity.ts` | Runtime-capacity observation |
| `src/platform/runtime/lib/agents/launcher-selection.ts` | `src/adapters/agents/launcher-selection.ts` | Configured launcher selection adapter |
| `src/platform/runtime/lib/agents/limit-hit.ts` | `src/application/services/agent-limit.ts` | Agent-limit policy |
| `src/platform/runtime/lib/agents/opencode-export.ts` | `src/adapters/agents/opencode-export.ts` | OpenCode report adapter |
| `src/platform/runtime/lib/agents/opencode-telemetry.ts` | `src/adapters/agents/opencode-telemetry.ts` | OpenCode telemetry adapter |
| `src/platform/runtime/lib/agents/opencode.ts` | `src/adapters/agents/opencode.ts` | OpenCode launcher adapter |
| `src/platform/runtime/lib/agents/pi.ts` | `src/adapters/agents/pi.ts` | Pi launcher adapter |
| `src/platform/runtime/lib/agents/stage-telemetry.ts` | `src/adapters/agents/stage-telemetry.ts` | Telemetry observation adapter |
| `src/platform/runtime/lib/agents/vibe-telemetry.ts` | `src/adapters/agents/vibe-telemetry.ts` | Vibe telemetry adapter |
| `src/platform/runtime/lib/agents/vibe.ts` | `src/adapters/agents/vibe.ts` | Vibe launcher adapter |
| `src/platform/runtime/lib/agents/worktree.ts` | `src/adapters/git/agent-worktree.ts` | Worktree adapter |
| `src/platform/runtime/lib/architecture/boundary-guards.ts` | `src/adapters/architecture/boundary-guards.ts` | Production dependency scanner |
| `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts` | _deleted_ | Transitional exception list |
| `src/platform/runtime/lib/commands/active.ts` | `src/adapters/cli/commands/active.ts` | Active CLI adapter |
| `src/platform/runtime/lib/commands/checkpoint.ts` | `src/adapters/cli/commands/checkpoint.ts` | Checkpoint CLI adapter |
| `src/platform/runtime/lib/commands/config.ts` | `src/adapters/cli/commands/config.ts` | Config CLI adapter |
| `src/platform/runtime/lib/commands/coverage-gate.ts` | `src/adapters/verification/coverage-gate.ts` | Coverage verification adapter |
| `src/platform/runtime/lib/commands/diff.ts` | `src/adapters/cli/commands/diff.ts` | Diff CLI adapter |
| `src/platform/runtime/lib/commands/draft.ts` | `src/adapters/cli/commands/draft.ts` | Draft CLI adapter |
| `src/platform/runtime/lib/commands/handoff.ts` | `src/adapters/cli/commands/handoff.ts` | Handoff CLI adapter |
| `src/platform/runtime/lib/commands/integrate.ts` | `src/adapters/cli/commands/integrate.ts` | Integrate CLI adapter |
| `src/platform/runtime/lib/commands/mission-start.ts` | `src/adapters/cli/mission-start.ts` | Mission-start CLI adapter |
| `src/platform/runtime/lib/commands/mutation-gate.ts` | `src/adapters/verification/mutation-gate.ts` | Mutation verification adapter |
| `src/platform/runtime/lib/commands/rebase.ts` | `src/adapters/cli/commands/rebase.ts` | Rebase CLI adapter |
| `src/platform/runtime/lib/commands/repair-handoff.ts` | `src/adapters/cli/commands/repair-handoff.ts` | Repair-handoff CLI adapter |
| `src/platform/runtime/lib/commands/resolve-conflict.ts` | `src/adapters/cli/commands/resolve-conflict.ts` | Conflict CLI adapter |
| `src/platform/runtime/lib/commands/review.ts` | `src/adapters/cli/commands/review.ts` | Review CLI adapter |
| `src/platform/runtime/lib/commands/setup-review.ts` | `src/adapters/cli/commands/setup-review.ts` | Review setup CLI adapter |
| `src/platform/runtime/lib/commands/setup.ts` | `src/adapters/cli/commands/setup.ts` | Setup CLI adapter |
| `src/platform/runtime/lib/commands/stats-backfill.ts` | `src/adapters/cli/commands/stats-backfill.ts` | Statistics backfill CLI adapter |
| `src/platform/runtime/lib/commands/stats.ts` | `src/adapters/cli/commands/stats.ts` | Statistics CLI adapter |
| `src/platform/runtime/lib/commands/status.ts` | `src/adapters/cli/commands/status.ts` | Status CLI adapter |
| `src/platform/runtime/lib/commands/verify.ts` | `src/adapters/cli/commands/verify.ts` | Verify CLI adapter |
| `src/platform/runtime/lib/composition/application-services.ts` | `src/composition/application-services.ts` | Concrete application wiring |
| `src/platform/runtime/lib/core/cli-flags.ts` | `src/application/presentation/cli-flags.ts` | Pure CLI input parsing |
| `src/platform/runtime/lib/core/durable-state-inventory.ts` | `test/fixtures/durable-state-inventory.ts` | Test-only persistence certification inventory |
| `src/platform/runtime/lib/core/fmt.ts` | `src/application/presentation/cli-format.ts` | Pure presentation formatting |
| `src/platform/runtime/lib/core/gitignore.ts` | `src/adapters/filesystem/gitignore.ts` | Filesystem adapter |
| `src/platform/runtime/lib/core/git.ts` | `src/adapters/git/git.ts` | Git adapter |
| `src/platform/runtime/lib/core/mission-utils/graphify.ts` | `src/adapters/filesystem/mission-graphify.ts` | Graph-file adapter |
| `src/platform/runtime/lib/core/mission-utils/merge-noise.ts` | `src/adapters/git/merge-noise.ts` | Git merge-noise adapter |
| `src/platform/runtime/lib/core/mission-utils/paths.ts` | `src/adapters/filesystem/mission-paths.ts` | Filesystem path adapter |
| `src/platform/runtime/lib/core/mission-utils.ts` | `src/adapters/filesystem/mission-utils.ts` | Mission filesystem adapter |
| `src/platform/runtime/lib/core/mission-utils/worktree.ts` | `src/adapters/git/worktree.ts` | Worktree adapter |
| `src/platform/runtime/lib/core/mutation-scoper.ts` | `src/adapters/git/mutation-scoper.ts` | Git mutation adapter |
| `src/platform/runtime/lib/core/nels.ts` | `src/adapters/git/net-engineering-lines.ts` | Git NEL observation; classification remains in the domain |
| `src/platform/runtime/lib/core/package-root.ts` | `src/adapters/filesystem/package-root.ts` | Package path adapter |
| `src/platform/runtime/lib/core/persistent-data-migration.ts` | `src/adapters/storage/persistent-data-migration.ts` | Persistent-data adapter |
| `src/platform/runtime/lib/core/post-integrate-hook.ts` | `src/adapters/process/post-integrate-hook.ts` | Process hook adapter |
| `src/platform/runtime/lib/core/product-config.ts` | `src/adapters/config/product-config.ts` | Configuration adapter |
| `src/platform/runtime/lib/core/runtime-matrix.ts` | `src/adapters/agents/runtime-matrix.ts` | Runtime capability adapter |
| `src/platform/runtime/lib/core/spawn-tee.ts` | `src/adapters/process/spawn-tee.ts` | Process adapter |
| `src/platform/runtime/lib/core/state-map.ts` | `src/adapters/config/state-map.ts` | State-map configuration adapter |
| `src/platform/runtime/lib/core/storage.ts` | `src/adapters/storage/storage.ts` | Storage filesystem adapter |
| `src/platform/runtime/lib/core/subagent-limit.ts` | `src/adapters/agents/subagent-limit.ts` | Runtime subagent-limit adapter |
| `src/platform/runtime/lib/core/verification.ts` | `src/adapters/verification/verification.ts` | Verification process adapter |
| `src/platform/runtime/lib/index.ts` | _deleted_ | Transitional command barrel replaced by composition registry |
| `src/platform/runtime/lib/README.md` | `src/adapters/README.md` | Layer documentation |
| `src/platform/runtime/lib/review/rebase.ts` | `src/adapters/review/rebase.ts` | Review Git adapter |
| `src/platform/runtime/lib/review/review-adapter.ts` | `src/adapters/review/review-adapter.ts` | Review provider adapter |
| `src/platform/runtime/lib/review/review-artifacts.ts` | `src/adapters/review/review-artifacts.ts` | Review artifact adapter |
| `src/platform/runtime/lib/review/review-commands.ts` | `src/adapters/review/review-commands.ts` | Review provider/workflow adapter |
| `src/platform/runtime/lib/review/review-events.ts` | `src/adapters/review/review-events.ts` | Review persistence adapter |
| `src/platform/runtime/lib/review/review-loop.ts` | `src/adapters/review/review-loop.ts` | Review provider loop adapter |
| `src/platform/runtime/lib/review/review-polling.ts` | `src/adapters/review/review-polling.ts` | Review polling adapter |
| `src/platform/runtime/lib/review/review-prompts.ts` | `src/adapters/review/review-prompts.ts` | Review prompt asset adapter |
| `src/platform/runtime/lib/review/review-state-mapping.ts` | `src/adapters/review/review-state-mapping.ts` | Review persistence mapping |
| `src/platform/runtime/lib/review/review-state.ts` | `src/adapters/review/review-state.ts` | Review state repository |
| `src/platform/runtime/lib/review/review.ts` | Deleted; consumers import `review-commands.ts`, `review-loop.ts`, `review-artifacts.ts`, or `review-polling.ts` directly | Transitional review compatibility hub removed |
| `src/platform/runtime/lib/tools/backlog.ts` | `src/adapters/backlog/backlog.ts` | Backlog provider adapter |
| `src/platform/runtime/lib/tools/forgejo.ts` | `src/adapters/forgejo/forgejo.ts` | Forgejo provider adapter |
| `src/platform/runtime/lib/tools/gatekeeper.ts` | `src/adapters/verification/gatekeeper.ts` | Verification gate adapter |
| `src/platform/runtime/lib/tools/redgreen.ts` | `src/adapters/verification/redgreen.ts` | Verification adapter |
| `src/platform/runtime/lib/tools/setup-review.ts` | `src/adapters/review/setup-review.ts` | Review setup adapter |

Every listed final path now exists, except rows explicitly marked deleted. No
former module is retained through a compatibility re-export.
