---
id: TASK-2649
title: Improve Parallix discovery and make supported coding agents obvious
status: done
assignee: [claude]
created_date: '2026-10-05 08:14'
labels: []
dependencies: []
ordinal: 162008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Improve how Parallix is discovered and evaluated by developers searching for a coding-agent harness/orchestration workflow.

This is a **public discovery and comprehension** mission, not a generic SEO rewrite.

The current repository has almost no meaningful human GitHub traffic despite substantial npm registry activity. The goal is to make the package and repository match the vocabulary developers use when choosing tools in this category, while preserving Parallix's current trust-layer positioning and technical accuracy.

A visitor should be able to answer within the first screen:

1. What category of tool is this?
2. What problem does it solve?
3. Does it work with the coding agent(s) I already use?
4. What is different about it from simply running an agent directly?

---

# Evidence before editing

Inspect current:

```text
README.md
package.json
config/agents.json

src/adapters/agents/agent-family-names.ts
src/adapters/agents/launcher-selection.ts
src/adapters/agents/codex.ts
src/adapters/agents/claude.ts
src/adapters/agents/qwen.ts
src/adapters/agents/vibe.ts
src/adapters/agents/opencode.ts
src/adapters/agents/pi.ts

src/adapters/config/product-config.ts
```

Do not infer supported agents from old documentation.

The implementation is authoritative.

---

# 1. Make the supported agents obvious near the top of README

The current README says Parallix is agent-agnostic but does not quickly tell a new visitor which popular coding agents actually work.

Add a compact supported-agent statement near the top, after the introductory positioning and before or around the first install/use flow.

Do **not** create a large compatibility matrix above the fold.

Something semantically similar to:

```text
Works with Codex CLI, Claude Code, Qwen Code and Mistral Vibe,
plus OpenCode or Pi as the configurable custom runner.
```

Exact wording may improve, but it must remain compact.

Use recognizable public product names, not only Parallix's internal family identifiers.

## Accuracy requirement

Distinguish:

### Native workflow families

Current configured workflow families include:

```text
codex
claude
qwen
vibe
custom
```

### Custom runner implementations

The `custom` family can currently use:

```text
opencode
pi
```

Do not claim that `opencode` and `pi` are simultaneously separate workflow families if that is not how selection/configuration works.

Do not expose this internal distinction in the headline unless needed for accuracy.

---

# 2. Add a compact "Supported coding agents" section

Add a short durable section lower in the README.

Preferred shape:

```markdown
## Supported coding agents

Parallix works with the coding-agent CLIs you already use:

- **Codex CLI**
- **Claude Code**
- **Qwen Code**
- **Mistral Vibe Code**
- **OpenCode**
- **Pi coding agent**

Codex, Claude, Qwen and Vibe are built-in workflow families.
OpenCode and Pi are available through the configurable custom runner.
Agent eligibility can be configured independently for drafting,
implementation and review.
```

Do not use that wording blindly. Verify current capability and use the smallest accurate formulation.

If one launcher has materially different limitations relevant to first use, mention only the limitation that affects the user's choice.

Do not turn this into implementation documentation.

---

# 3. Improve the first-screen category vocabulary

Preserve the current trust-layer differentiator.

Do not replace the opening with generic SEO prose.

However, ensure the first ~150–200 words naturally contain terms an evaluator is likely to search for, where factually appropriate:

```text
AI coding agents
coding-agent workflow
agent orchestration
Git worktrees
code review
verification
Codex
Claude Code
```

Do not mechanically include every keyword.

The opening should still read like an engineer describing a product, not a search-engine landing page.

## Positioning principle

Prefer:

> local-first workflow and trust layer for AI coding agents

over:

> revolutionary multi-agent AI orchestration platform

Do not add superlatives.

---

# 4. Update npm description

The current package description is:

```text
Trust ladder for AI coding work — separate review, configured verification,
conditional Linux confinement, and human-owned merges
```

This is distinctive after someone understands Parallix, but weak as a category-discovery string.

Change it to include the category first.

Preferred semantic direction:

```text
Local-first workflow and trust layer for AI coding agents — isolated worktrees,
separate review, verification gates, and human-owned merges
```

Keep it short enough to work as npm search-result copy.

Do not stuff agent product names into the description; those belong in README/keywords.

---

# 5. Update npm keywords

npm discovery uses the `keywords` array in `package.json`, together with package name, description and README.

Replace the current low-specificity set with a focused discovery set.

Candidate keywords:

```json
[
  "parallix",
  "coding-agent",
  "coding-agents",
  "ai-coding",
  "ai-agents",
  "agentic-ai",
  "agent-orchestration",
  "agent-harness",
  "multi-agent",
  "git-worktree",
  "git-worktrees",
  "code-review",
  "verification",
  "developer-tools",
  "local-first",
  "claude-code",
  "codex",
  "qwen-code",
  "mistral-vibe",
  "opencode"
]
```

Investigate whether `pi-coding-agent` is also a useful public search term and include it if appropriate.

Do not add generic filler such as:

```text
software
programming
javascript
node
tool
development
```

merely to increase keyword count.

Every keyword should correspond to either:

- the product category;
- an important differentiating capability;
- a supported coding agent;
- a likely comparison/search intent.

---

# 6. Recommend GitHub topics

Repository topics themselves are GitHub metadata and cannot be changed through README/package metadata.

Produce the recommended final topic set in the mission checkpoint so the operator can apply it through GitHub's About editor.

Current topics are:

```text
agentic-ai
ai-agents
cli
code-review
coding-agents
developer-tools
git-worktrees
local-first
multi-agent
sandboxing
software-engineering
typescript
```

Recommended direction:

### Keep

```text
agentic-ai
ai-agents
code-review
coding-agents
developer-tools
git-worktrees
local-first
multi-agent
sandboxing
cli
```

### Consider adding

```text
agent-orchestration
agent-harness
ai-coding
claude-code
codex
qwen-code
mistral-vibe
opencode
pi-coding-agent
```

### Consider removing

```text
software-engineering
typescript
```

because they describe implementation/context much more weakly than user search intent.

Do not make automated GitHub settings changes from repository code.

---

# 7. Do not build an "alternatives" SEO page yet

Investigate whether a short comparison sentence is useful, but do not create pages targeting:

```text
Parallix vs Claude Code
Parallix vs Codex
best AI coding agents 2026
10 best coding-agent orchestrators
```

That would be premature SEO content with no evidence that those pages are the acquisition bottleneck.

The current mission should improve the canonical package/repository surfaces first.

---

# 8. Preserve the trust story

Do not remove or weaken the distinctive elements that currently make Parallix credible:

- isolated missions/worktrees;
- preferentially different-agent review;
- repository-owned verification;
- confinement;
- human-owned integration;
- local-first operation;
- dogfooding;
- observed throughput graph.

Supported-agent names should help a developer recognize compatibility, not replace the trust-layer proposition.

A useful mental model is:

```text
SEARCH:
"Claude Code worktree orchestration"
          ↓
RECOGNITION:
"Parallix works with Claude Code"
          ↓
DIFFERENTIATION:
"and puts independent review + gates + human merge around it"
```

---

# 9. Avoid unsupported compatibility claims

Do not write:

> Works with any coding agent

unless current generic-family behavior makes that statement genuinely supported and documented.

The launcher-selection implementation can probe configured family names, but the known built-in integration quality is not identical for arbitrary CLIs.

Prefer an explicit list of supported integrations plus a narrowly worded extensibility statement.

Do not claim equal telemetry, resume, sandbox or provider-limit behavior across every agent unless verified.

---

# 10. Add a lightweight documentation contract

Add a focused test or documentation assertion ensuring the public supported-agent list does not silently drift away from built-in launcher support.

Do not parse marketing prose with a huge brittle exact-string test.

A reasonable invariant could compare a small exported/public supported-launcher metadata list with the built-in launcher registry, or otherwise verify that every specifically advertised launcher has a production launcher implementation.

Do not introduce a second agent registry solely for README generation.

If there is no clean way to make this mechanical without duplicating authority, document the checked source in a small test instead.

---

# Verification

At minimum:

- package metadata is valid;
- package-content audit passes;
- README rendering remains valid;
- npm description appears in packed package metadata;
- supported-agent names correspond to current launcher implementations;
- existing README npm-safe image contracts continue passing;
- normal required repository gate passes.

Do not require live npm or GitHub search ranking in CI.

---

# Success criteria

This mission is complete when:

1. A new visitor can identify supported coding agents from the first screen of README.
2. README has a compact durable supported-agent section.
3. Codex CLI, Claude Code, Qwen Code, Mistral Vibe Code, OpenCode and Pi are described according to actual implementation.
4. The difference between built-in workflow families and custom runners is accurate without dominating the user-facing copy.
5. npm description names the product category as well as its trust differentiator.
6. npm keywords cover high-intent coding-agent/orchestration/worktree/review searches.
7. A recommended GitHub-topic set is recorded for operator application.
8. No generic SEO filler or comparison-page content is added.
9. Existing trust positioning remains intact.
10. No unsupported "works with everything" claim is introduced.

---

# Agent-slop guardrails

Do not:

- keyword-stuff the first paragraph;
- repeat every supported agent name throughout the README;
- add badges for every agent;
- add vendor logos/assets;
- create an SEO landing-page subsystem;
- generate comparison articles;
- claim official partnership with any supported agent vendor;
- imply OpenAI, Anthropic, Mistral, Alibaba/Qwen, OpenCode or Pi endorse Parallix;
- call every launcher a "native integration" if it isn't;
- advertise capabilities one launcher does not support;
- add search terms unrelated to actual features;
- replace the trust-layer positioning with generic "multi-agent orchestration";
- mention npm download counts as adoption evidence;
- add telemetry to measure discovery;
- change product behavior as part of this mission.

The purpose is simple:

> Help the right developer find Parallix and recognize that it works with the coding agents they already use.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
