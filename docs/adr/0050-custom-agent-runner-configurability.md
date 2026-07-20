# ADR 0050: Custom agent runner configurability — opencode vs. pi

Status: Accepted
Date: 2026-07-10

Related: ADR 0029 (Forgejo identity enforcement), task-1359 (real-agent smoke gate), task-1339 (opencode session-id extraction), task-2208 (this mission)

## Context

Parallix has historically treated the `custom` agent family as synonymous with `opencode`: the launcher documentation names `custom -> opencode`, the real-agent smoke gate exercised only the `opencode` path, and the repo-level model configuration was pinned to a local Qwen model string in `workflow.config.json`. This blocks evaluation of alternative local runners even though the backlog explicitly requires: install Pi on the workstation, wire it into Parallix, compare it against the current `opencode` path on the same `custom` workflow, and recommend which runner should be the default.

Two earlier drafts of this ADR claimed the comparison was done without it actually being measured. The first draft asserted "Pi cannot emit trustworthy token counts" and "Pi does not support Graphify," and recommended `opencode` on that basis. Neither claim survived verification:

- **Telemetry**: `pi --print --mode json --approve` streams real per-message `usage` (`input`, `output`, `cacheRead`, `totalTokens`). The Pi launcher (`lib/agents/pi.ts`) had never actually been run against the real `pi` CLI — it invoked `pi ask --quiet ...`, a contract that does not exist (`pi --help` has no `ask` subcommand and no `--quiet` flag; running it reproduces `Error: Unknown option: --quiet` immediately).
- **Graphify**: Pi natively implements the [Agent Skills standard](https://agentskills.io/specification) and can load the exact same `SKILL.md` already used by Claude and opencode. Verified directly (see "Graphify on Pi" below).

Separately, verifying this ADR's claims surfaced a real production regression unrelated to Pi at all: `lib/agents/agents.ts` / `lib/agents/launcher-selection.ts` resolved the `custom` family's runner only when a `worktree` argument was truthy. Every real caller (`review-loop.ts`, `active.ts`, `draft.ts`) calls `selectAgent`/`assertAgentSupported` without one, so `custom` was permanently unselectable in production — biasing reviewer/implementer selection toward `claude` and causing `test/agents.test.ts` to OOM after ~14.5 minutes under repeated failed-retry pressure. This ADR's decision and the fix for that regression shipped together; see "Files Changed."

## Decision

Add a first-class configuration seam that selects the runner backing the `custom` agent family without requiring source edits, readable from `workflow.config.json` (`adapters.agents.runners.custom`):

```json
{
  "adapters": {
    "agents": {
      "runners": { "custom": "opencode" },  // "opencode" or "pi"
      "subagents": { "maxParallel": 2 }
    }
  }
}
```

`adapters.agents.models.custom` remains a supported *optional* override for either runner — no longer required or pre-populated by default. The original `workflow.config.json` hardcoded `models.custom` to a specific model string; that is a footgun independent of the runner-default decision, since it goes stale the moment the operator repoints the locally-served model. Removed: both runners now fall back to their own default model configuration (opencode remembers its own last-selected local model; Pi reads `defaultProvider`/`defaultModel` from `~/.pi/agent/settings.json`).

`lib/agents/pi.ts` was rewritten to the real CLI contract: `--print --mode json --approve` for non-interactive execution, `--model` for an override, `--session-id`/`--continue` for resume. Session ID and token telemetry are parsed directly from the `--mode json` event stream (the session header `{"type":"session","id":...}` and per-message `usage`), verified against the real installed binary with a real session ID and non-zero token counts.

**Runner default: keep `opencode`.** Not because `pi` is broken — both bugs found during verification (a CLI-contract hallucination and a tail-buffer truncation bug) are fixed, and `pi` completed the mission's own full E2E gate cleanly on a rerun. The reason is narrower: `pi`'s reliability through that gate isn't characterized yet (one checkpoint-evidence-citation failure out of three runs, cause not yet ruled out as `pi`-specific — see Follow-ups), while `opencode` has a longer track record on this exact gate. `opencode` is the safer default until `pi` has more real runs behind it; `pi` is now a credible, working option operators can opt into, with real efficiency gains worth pursuing further.

### Real, measured E2E comparison

Both runs went through the mission's own required gate — `node --import tsx test/e2e-real-agent-smoke.test.ts`, real `px draft` → real `px active` (autonomous review loop included), parametrized to run for `runner=opencode` and `runner=pi` — against the same throwaway repo shape, the same hello-world fix task, and the same backend model (`QuantTrio/Qwen3.6-27B-AWQ-6Bit` on a shared vLLM server).

| Runner | Draft duration | Draft input tokens | Draft tool calls | Active (review-inclusive) duration | Result |
|--------|----------------:|--------------------:|------------------:|-------------------------------------:|--------|
| opencode | 205,857 ms (~206s) | 180,861 | 12 | 695,363 ms (~695s) | PASS — full draft→active→review lifecycle, reviewer forced to `custom`, disposition `APPROVED` |
| pi, run 1 (before the tail-buffer fix below) | 153,969–180,788 ms (~154–181s, 2 runs) | 8,317–9,723 | 0 | not reached | FAIL — draft produces a real, correct, non-placeholder `MISSION.md`, but Parallix's own phantom-draft guard (`tool_calls > 0`) rejected it because the recorded tool-call count was 0 despite the file content proving tools were used |
| pi, run 2 (after the fix) | 133,665 ms (~134s) | 8,878 | 15 | 1,338,231 ms (~22 min) | draft phase FIXED; `px active` failed on a checkpoint-evidence citation the pi-backed model wrote (see below) |
| pi, run 3 (clean rerun, after the fix) | 132,782 ms (~133s) | 8,038 | 13 | 391,516 ms (~6.5 min) | **PASS** — full draft→active→review lifecycle completed |

**Root cause of the tool-call undercounting, found and fixed.** `lib/core/spawn-tee.ts` caps every captured child-process stdout to a 64KB tail buffer (`DEFAULT_MAX_TAIL_BYTES`) — reasonable for bounding error logs, but `pi --mode json` streams one JSON event per token/delta rather than per message, so a real multi-turn session routinely produces tens of megabytes of output (measured: 18.6MB for one draft run). Byte-offset analysis of a captured real run showed both the first and last `tool_execution_end` events (at byte offsets 338,001 and 17,946,458 of an 18.6MB stream) fell *outside* the last-64KB tail window that becomes `result.stdout`, while the final assistant message's `usage` field survived because it sits near the true end of the stream. The result was self-consistent but wrong: real, non-zero token counts alongside a false `toolCalls: 0`. Opencode never hits this because its telemetry comes from a separate, bounded `opencode export` command, not from parsing the live stream. Fixed by requesting a 32MB tail buffer for pi invocations specifically (`lib/agents/pi.ts`); regression-tested in `test/pi-runner.test.ts` (asserts the requested buffer size, not just a passing draft). **Confirmed fixed** across 2 post-fix runs (13 and 15 tool calls, both correctly non-zero).

**Run 2's `px active` failure did not reproduce on a clean rerun (run 3).** Run 2 failed because the pi-backed implementer's checkpoint document was rejected by Parallix's own gatekeeper — a Goal Check row citing only raw shell output (`| SC2: Running \`bash hello.sh\` ... | \`bash hello.sh\` → ... |`) without a paired file:line/test/ADR/command reference, exactly the failure mode the mission's own Checkpoint Documentation Requirements warn against. Run 3, on an otherwise-identical fresh throwaway repo, passed the same checkpoint-evidence gate cleanly. This is consistent with intermittent output-quality variance from a smaller local model (`QuantTrio/Qwen3.6-27B-AWQ-6Bit`) rather than a systematic pi-launcher or Parallix defect — the same class of occasional weak-citation failure Parallix's checkpoint gatekeeper is explicitly designed to catch for any implementer, not one specific to `pi`. Not fully ruled out as a `pi`-specific tendency without more repeated runs (see Follow-ups), but it is not a reproducible blocker on the evidence gathered.

Separately, for the same draft task, pi used roughly half the input tokens of opencode across both post-fix runs (8,038-8,878 vs 180,861 — over 20x fewer). That's real, measured, and consistent across runs.

### Graphify on Pi

Empirically verified: Pi already loads the exact Graphify skill used by Claude and opencode, with zero new code. Pi's native skill support explicitly documents importing skills from other harnesses:

```json
// ~/.pi/agent/settings.json
{ "skills": ["~/.claude/skills"] }
```

With that one-line settings change, invoking `/skill:graphify` in a real `pi --print --mode json --approve` session returns the actual, unmodified `~/.claude/skills/graphify/SKILL.md` content:

```
<skill name="graphify" location="/home/magnus/.claude/skills/graphify/SKILL.md">
References are relative to /home/magnus/.claude/skills/graphify.

# /graphify
Turn any folder of files into a navigable knowledge graph...
```

No `graphify install --platform pi` subcommand needs to exist — Graphify's existing `SKILL.md` frontmatter (`name`, `description`) is already Agent-Skills-standard-compliant, so pointing Pi's `skills` setting at the same directory Claude/opencode use is sufficient. This is the recommended path: it reuses the existing, actively-maintained Graphify skill instead of a separate integration to keep in sync.

A more integrated alternative exists but is not recommended today: [`juhas96/graphify-pi`](https://github.com/juhas96/graphify-pi) (MIT, ~12 stars, 8 commits) is a real, functional Pi extension — not a stub — that injects graph-first guidance into the system prompt automatically, tracks staleness across a session, and registers a native `/graphify` command, targeting parity with `safishamsi/graphify` (a different upstream than this repo's own graphify). It requires installing a separate npm/git extension and depends on a third-party project with minimal community activity (0 issues/PRs, small commit history) — a real maintenance-risk tradeoff against the zero-dependency skill-loading approach above. Worth revisiting if the project matures or if always-on system-prompt injection becomes a real requirement.

Graphify support was incorrectly documented as a Pi limitation in an earlier draft of this ADR and in `docs/operator-setup.md`. Both are corrected. Graphify is not a runner-default decision point — it's available on both runners, one via first-class `graphify install`, the other via a one-line settings import.

### Follow-ups

1. Run `runner=pi` through `test/e2e-real-agent-smoke.test.ts` a handful more times (e.g. 5-10x in CI or manually) to get a real pass-rate estimate for the checkpoint-evidence-citation flake observed in run 2 above. One failure in three runs isn't enough data to call this either "solved" or "a real pi-specific tendency" — it's the natural next step now that the systematic tail-buffer bug is fixed and out of the way.
2. Investigate the token-efficiency gap (pi used roughly half opencode's input tokens for the same draft task, consistently across both post-fix runs) — worth understanding whether it's a real architectural advantage or an artifact of this specific task.

## Consequences

**Positive:**
- Operators can switch between `opencode` and `pi` by changing one config field; no source edits
- `opencode` behavior is fully preserved and now verified via a real E2E pass, not assumed
- The `pi` launcher matches the real CLI, with real session-id and token telemetry, verified correct after fixing a real tail-buffer truncation bug (see "Real, measured E2E comparison")
- `pi` demonstrably completes the mission's own full draft→active→review E2E gate for real (run 3), not just its own launcher unit tests
- Neither runner requires a hardcoded model string in repo config
- Graphify works on both runners with no new integration
- The `custom`-family worktree-gating regression (see Context) is fixed and regression-tested (`test/runtime-matrix.test.ts`, `test/e2e-mission-lifecycle.test.ts`)
- The pi draft-phase tool-call undercounting is fixed and regression-tested (`test/pi-runner.test.ts`)
- Measured, consistent token efficiency advantage for `pi` on the same task (roughly half opencode's input tokens across 2 post-fix runs)

**Negative:**
- `pi`'s pass rate through the full E2E gate is not yet well-characterized — 1 failure (checkpoint-evidence citation) in 3 runs, with the systematic bug now ruled out as the cause; more runs are needed to know if this is real flakiness specific to `pi`/this model or ordinary local-model variance (Follow-up 1)
- `pi` requires an explicit `~/.pi/agent/models.json` provider block before any local model is usable, unlike opencode's more turnkey discovery

## Alternatives considered

- **Make Pi the default now** — rejected for this checkpoint: `pi`'s E2E pass rate isn't yet characterized well enough (1 real failure observed, cause not fully ruled out as `pi`-specific — Follow-up 1), even though the systematic launcher/telemetry bugs are fixed and one clean run passed end-to-end
- **Remove opencode support** — rejected: violates Restricted Areas and breaks existing workflows
- **Create a separate agent family for Pi** — rejected: misses the point of making `custom` configurable
- **Environment-variable-only configuration** — rejected: not reachable through the repo's real config path
- **Recommend Pi based on token efficiency alone** — rejected: efficiency is real and measured, but a runner needs a characterized pass rate through the mission's own E2E gate before it can be recommended as the default, not just a single green run

## Verification

- `./scripts/verify-local.sh all`: 2084 pass / 0 fail / 23 skipped
- `./scripts/verify-local.sh static-analysis`: ESLint, tsc, test-hygiene all clean
- `node --import tsx test/e2e-mission-lifecycle.test.ts`: 6/6
- `node --import tsx test/e2e-real-agent-smoke.test.ts`: `runner=opencode` PASSES end-to-end (re-run on 2026-07-10 during round-1 fixing: draft 442,512ms/132,200 input tokens/9 tool calls, active 689,382ms). `runner=pi` PASSES end-to-end on the same re-run (draft 133,793ms/8,077 input tokens/10 tool calls, active 736,196ms) — this confirms the "run 3, clean rerun" result above; the `px active` checkpoint-evidence failure recorded as "run 2" earlier in this document did not reproduce on that or the subsequent re-run (Follow-up 1 tracks characterizing the pass rate with more runs, not an unresolved failure)
- `test/pi-runner.test.ts`: 20/20 (added a regression test asserting the tail-buffer size fix)
- Graphify-on-Pi claim verified directly against a real `pi --print --mode json --approve` session (see above)

## Files Changed

| File | Change | Purpose |
|------|--------|---------|
| `config/workflow.config.schema.json` | Added | Schema for `adapters.agents.runners.custom` |
| `workflow.config.json` | Modified | Added `runners.custom: "opencode"`; removed the pinned `models.custom` string |
| `lib/core/product-config.ts` | Added | `resolveCustomRunner()` |
| `lib/agents/launcher-selection.ts` | Modified | Dynamic custom launcher dispatch; fixed the worktree-gating regression |
| `lib/agents/agents.ts` | Modified | Fixed the same worktree-gating bug in the draft-launch dispatch path |
| `lib/agents/pi.ts` | Rewritten | Real CLI contract, real session-id and telemetry extraction |
| `test/pi-runner.test.ts` | Modified | Corrected to the real CLI contract; added telemetry/session-header coverage |
| `test/agents.test.ts` | Modified | Corrected a test that had pinned the pre-fix (buggy) behavior |
| `test/e2e-real-agent-smoke.test.ts` | Modified | Parametrized for both runners; made `models.custom` optional; logs real duration/token benchmark lines |
| `docs/agents.md`, `docs/operator-setup.md`, `docs/real-agent-smoke.md` | Modified | Corrected the Pi CLI contract, model-pin guidance, and Graphify claim |
| `missions/task-2208/MISSION.md` | Amended | Documented the model-pin footgun fix and the corrected Graphify finding |

## See Also

- `missions/task-2208/CP-3.md` — checkpoint evidence and Goal Check for this mission
- `docs/agents.md` — runner matrix and invocation shapes
- `docs/operator-setup.md` — Pi install/config and Graphify setup
