# CP-2: Concrete Review, Gate, Agent, OperationLog, Git Read Adapters

## Summary

Implemented five concrete read adapters, each with unit tests for normal and missing/unavailable sources:

- **ReviewReadAdapter** (`concrete-review-read-adapter.ts`): Materialises domain `Review` from Git-owned `review-state.json` via `readReviewState()`. Returns null when no review exists. Approval detected from `phase: 'approved'`.
- **GateReadAdapter** (`concrete-gate-read-adapter.ts`): Reads gate status from `.workflow/gate-result.json` or `gate-status.txt`. Returns `'unknown'` when no gate artifacts exist (R2 mitigation).
- **AgentReadAdapter** (`concrete-agent-read-adapter.ts`): Reads availability from SQLite `AgentBlocklistRepository` (TASK-2295 snapshot). Supports timed blocks, indefinite blocks, and unblocked agents.
- **OperationLogReadAdapter** (`concrete-operation-log-read-adapter.ts`): Reads from `SqliteOperationalHistoryRepository.findAll()`. Maps to board `OperationLogEntry` format.
- **GitReadAdapter** (`concrete-git-read-adapter.ts`): Supplies `RepositoryId` from `git config remote.origin.url` (or directory name fallback) and HEAD sha from `git rev-parse HEAD`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `ReviewReadAdapter.loadReview()` returns domain `Review` or null | `src/adapters/backlog/concrete-review-read-adapter.ts:67`, `"loadReview returns domain Review from review state"`, `"loadReview returns null when no review state exists"` | PASS |
| `ReviewReadAdapter.loadReviewApproval()` returns typed approval or null | `src/adapters/backlog/concrete-review-read-adapter.ts:82`, `"loadReviewApproval returns approval data for approved phase"`, `"loadReviewApproval returns null for non-approved phase"` | PASS |
| `GateReadAdapter.loadGateStatus()` returns `'passed' \| 'failed' \| 'running' \| 'unknown'` | `src/adapters/backlog/concrete-gate-read-adapter.ts:58`, `"loadGateStatus returns passed from gate content"`, `"loadGateStatus returns failed from gate content"`, `"loadGateStatus returns running from gate content"` | PASS |
| GateReadAdapter handles missing gate artifacts gracefully (R2) | `src/adapters/backlog/concrete-gate-read-adapter.ts:62`, `"handles missing gate artifacts gracefully (R2)"`, `"loadGateStatus returns unknown when no gate file exists"` | PASS |
| `AgentReadAdapter.loadAgentAvailability()` returns `AgentAvailability[]` from SQLite | `src/adapters/backlog/concrete-agent-read-adapter.ts:67`, `"loadAgentAvailability returns availability from blocklist snapshot"`, `"loadAgentAvailability handles timed blocks"` | PASS |
| `AgentReadAdapter.loadAssignedAgent()` returns `AgentFamily \| null` | `src/adapters/backlog/concrete-agent-read-adapter.ts:92`, `"loadAssignedAgent returns agent from task file"`, `"loadAssignedAgent returns null for missing task"` | PASS |
| `OperationLogReadAdapter.loadOperationLog()` returns entries from `SqliteOperationalHistoryRepository.findAll()` | `src/adapters/backlog/concrete-operation-log-read-adapter.ts:33`, `"loadOperationLog returns entries from SQLite snapshot"`, `"loadOperationLog returns empty array for empty history"` | PASS |
| `GitReadAdapter.loadRepositoryId()` returns `RepositoryId` | `src/adapters/backlog/concrete-git-read-adapter.ts:55`, `"loadRepositoryId returns configured repository id"`, `"loadRepositoryId extracts name from git remote URL"`, `"loadRepositoryId falls back to directory name"` | PASS |
| `GitReadAdapter.loadHeadCommit()` returns HEAD sha string | `src/adapters/backlog/concrete-git-read-adapter.ts:82`, `"loadHeadCommit returns HEAD sha"`, `"loadHeadCommit returns empty string on git error"` | PASS |

**Tests:** `npm test -- test/adapters/concrete-adapters-cp2.test.ts` (25 tests, 0 failures)

Next action: Wire BoardProjectionBuilder in the composition root over all concrete adapters and add integration-base-vs-worktree reconciliation test (CP-3).
