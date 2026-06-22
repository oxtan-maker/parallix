# ADR 0031: AI Agent Instruction Boundary and Bounded Command Floor

**Status:** Accepted
**Date:** 2026-03-31

## Context

ADR 0023 established the repo's AI SDLC authority stack:

- `AGENTS.md` as the repo-wide authority
- locked `MISSION.md` as the execution contract
- prompt files under `docs/agent-prompts/` as mode-specific workflow guidance
- mission branches and worktrees as the execution boundary

ADR 0026 then added Backlog as the current-state and recovery surface.

That architecture created a new security question: agents now intentionally read large volumes of repo text, Backlog task text, and Forgejo review text. Some of that text is authoritative, but much of it is merely informative and can be stale, misleading, or adversarial.

The current repo also exposes an execution-surface asymmetry:

- repo policy is explicit about a safe local command floor and hard production boundaries
- Claude's repo-visible allowlist additionally permits `python -c` and `python3 -c`, which are broader than the explicitly enumerated floor and provide a generic scripting escape hatch if untrusted text is followed too literally

The threat-model mission behind this ADR concluded that the main practical risk is not a single "malicious file." It is instruction laundering across mixed-trust text surfaces: PR comments, task descriptions, docs, and checkpoint artifacts being treated as if they could override the mission contract.

## Decision

Adopt an explicit instruction-boundary rule for the repo AI SDLC:

1. The only repo-visible instruction-bearing artifacts for execution are:
   - `AGENTS.md`
   - relevant subdirectory `AGENTS.md`
   - the locked `MISSION.md` for the current mission
   - the mode prompt explicitly loaded for the current session
   - direct human instructions in the current session
2. Other consumed text is untrusted data unless the human explicitly promotes it into mission scope:
   - Backlog descriptions, notes, and references
   - Forgejo PR descriptions, comments, and review comments
   - general docs, checkpoint artifacts, and code comments
   - tool and MCP output
3. Repo-managed command permissions should stay reviewable and as close as practical to the explicitly documented safe local command floor, but the repo may keep broader autonomy affordances when the operator cost of removing them is too high.
4. The repo explicitly accepts the residual risk of keeping `python -c` and `python3 -c` in Claude's repo-visible allowlist. This is a conscious autonomy tradeoff, not an accidental gap.

## Consequences

### Positive

- The most important trust boundary becomes explicit rather than implied.
- Prompt injection through PR comments, task notes, and docs is easier to reason about because those surfaces are now formally classified as data.
- The trust-boundary rule is explicit even when the runtime command surface remains somewhat broader for autonomy reasons.
- Future workflow docs can be reviewed against a clear question: "is this authoritative instruction, or merely informative text?"

### Negative

- Agents still need to read untrusted text to operate, so this does not remove the attack surface.
- Claude's generic local scripting path remains available, so prompt-injection blast radius is not minimized as aggressively as it could be.
- Codex/Gemini still depend more on runtime/wrapper controls than repo-visible deny rules, so enforcement symmetry remains imperfect.

## Alternatives Considered

### Keep the current implicit boundary and rely on agent judgment

Positive:

- No workflow or config churn.

Negative:

- Leaves instruction laundering under-specified.
- Makes review of workflow-security changes less objective.

### Ban agents from reading PR comments, Backlog notes, or general docs

Positive:

- Reduces direct prompt-injection exposure.

Negative:

- Breaks normal execution and review workflows.
- Discards information the repo explicitly depends on.

### Remove `python -c` and `python3 -c` from Claude's repo-visible allowlist

Positive:

- Narrows the most generic local scripting path exposed in repo-visible config.
- Better aligns Claude's allowlist with the explicit command floor.

Negative:

- Reduces normal agent autonomy for legitimate repo-local transforms.
- In this repo/runtime, that operator friction is judged worse than the marginal security gain.

### Keep `python -c` and treat it as an accepted risk

Positive:

- Preserves maximum local scripting flexibility.
- Preserves the repo's autonomy-by-default operating model for legitimate local work.

Negative:

- Leaves a generic arbitrary-execution path in the allowlist that is broader than the documented floor.
- Increases the blast radius of command suggestion laundering.

Decision: chosen.

## Links

- [ADR 0023](0023-ai-sdlc-configuration.md)
- [ADR 0026](0026-ai-task-state-and-agent-recovery-surface.md)
- [AI agent threat model](../security/ai-agent-threat-model.md)
- [Mission](../missions/2026/ai-agent-prompt-injection-threat-model-and-mitigation-design/MISSION.md)
