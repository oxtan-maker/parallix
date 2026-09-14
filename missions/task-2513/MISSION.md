# Mission: Require explicit consent for unsandboxed mutating agents (task-2513)

## Goal
Ensure a mutating agent is never launched without confinement unless an operator has explicitly consented to unsandboxed execution. When Bubblewrap is unavailable, retain confinement by selecting the agent's native sandboxing capability where supported.

## Why Now
The current launch path can silently fall back from Bubblewrap to an unconstrained mutating agent. That makes host-file modification an implicit operational risk and gives operators no deliberate decision point when the preferred isolation mechanism is missing.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: mutation safety, explicit operator control, Bubblewrap-unavailable fallback behavior, native agent sandbox capability selection

## Scope
- Define and implement launch-policy behavior for mutating agents when Bubblewrap confinement is available, unavailable, or cannot be selected.
- Require an explicit operator consent path before a mutating agent may run unsandboxed.
- Use a supported agent-native sandboxing mechanism as the fallback confinement path when Bubblewrap is unavailable.
- Add focused automated coverage for the confinement selection and unsandboxed-consent decisions.
- Update durable user-facing workflow documentation only if the operator-facing consent behavior changes documented usage.

## Out of Scope
- Changing the sandbox policy for read-only or non-mutating agent work.
- Installing, packaging, or repairing Bubblewrap on operator machines.
- Designing a new operating-system sandbox, changing Bubblewrap itself, or guaranteeing confinement against a compromised host.
- Broad changes to agent prompts, agent models, review workflow, or unrelated command execution policy.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A mutating-agent launch selects Bubblewrap confinement when Bubblewrap is available, with automated coverage for that decision.
- When Bubblewrap is unavailable and the selected agent supports native sandboxing, the launch selects that native sandboxing path rather than unsandboxed execution, with automated coverage for that decision.
- When neither Bubblewrap nor supported native sandboxing can confine a mutating agent, the launch is blocked until an operator explicitly consents to unsandboxed execution; automated coverage demonstrates both the blocked and explicitly-consented outcomes.
- The consent mechanism is explicit in the command/workflow interface and cannot be triggered by an implicit fallback or default setting.
- Existing supported non-mutating launch behavior remains covered and unchanged by the new mutating-agent policy.
- `./scripts/verify-local.sh all` completes successfully on the completed implementation.

## Risks and Assumptions
- Agent providers expose different native-sandbox options; the implementation must only select capabilities that the chosen provider and invocation support.
- Explicit consent can interrupt existing automation that relied on fallback behavior; that interruption is intentional, but the consent surface must be actionable and unambiguous.
- Native sandboxing is a fallback defense, not a claim of equivalence with host-level Bubblewrap isolation.
- Assumption: the launch layer can identify mutation intent before starting the agent and can pass an agent-native sandbox setting where it is supported.

## Checkpoints
- CP 1: Map the mutating-agent launch decision points and record the required Bubblewrap, native-sandbox, and explicit-consent policy boundary before changing behavior.
- CP 2: Implement the confinement-selection and explicit-consent policy, with focused tests covering each decision outcome.
- CP 3: Validate compatibility for non-mutating launches, update user-facing workflow documentation if required, and run the mission verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST lead its evidence with durable, verifiable forms Parallix recognizes today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when necessary but discouraged because line numbers rot.

Every checkpoint document MUST include a summary of work done, the exact heading `## Goal Check`, and this exact 3-column table shape:

| Criterion | Evidence | Status |
|---|---|---|

Include at least one evidence row for every Success Criterion. For this mission, evidence should name the focused confinement-policy tests and their exact test names, the relevant test paths, any applicable ADR, and `./scripts/verify-local.sh all` when it has run. Raw `stat`/`ls` output or generic prose alone is not enough; if included, pair it with an accepted reference above. End each checkpoint with a concrete `Next action:` line that identifies the next policy, test, implementation, or verification step.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not weaken existing host-level Bubblewrap confinement when it is available.
- Do not permit an implicit, default, environment-only, or prompt-only bypass of the explicit unsandboxed consent requirement.
- Do not expand this mission into read-only agent policy or unrelated execution-framework refactoring.
- Do not claim that native agent sandboxing is equivalent to Bubblewrap unless the selected agent's documented capability establishes that equivalence.

## Stop Rules
- Stop and request direction if the repository cannot reliably determine whether a requested agent run is mutating before launch.
- Stop and request direction if no supported native sandbox setting exists for a Bubblewrap-unavailable mutating launch and the required operator-consent interface would materially alter a public workflow beyond this mission's stated policy.
- Stop and request direction if implementing consent requires changing provider credentials, remote infrastructure, or operating-system security policy.
- Stop before merging or releasing; hand off after the required verification evidence and Goal Check are recorded.
