---
id: TASK-2206
title: post integration hook as errors
status: done
assignee: [codex]
created_date: '2026-07-07 19:54'
labels: [ai_sdlc]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
when changing ts files in a mission I get this errors:

[FAIL] Post-integrate hook failed (exit code 254): ./scripts/refresh-global-px.sh
[FAIL] [refresh-global-px] Bumping patch version for task-2203...
[FAIL] [refresh-global-px] package.json/package-lock.json bumped to v1.3.20
[FAIL] [main ff3a0820] chore: bump version to 1.3.20 (post-integrate self-update)
[FAIL]  2 files changed, 3 insertions(+), 3 deletions(-)
[FAIL] [refresh-global-px] Building the distributable (tsc -> CommonJS)...
[FAIL] 
[FAIL] > @magnusekdahl/parallix@1.3.20 build:cjs
[FAIL] > tsc --rootDir . --outDir . --module CommonJS --moduleResolution Node --esModuleInterop && { head -1 px.js | grep -q '^#!' || sed -i '1i#!/usr/bin/env node' px.js; } && chmod +x px.js
[FAIL] 
[FAIL] [refresh-global-px] Packing a tarball of this checkout...
[FAIL] [refresh-global-px] Installing 
[FAIL] > @magnusekdahl/parallix@1.3.20 prepack
[FAIL] > npm run publish:guard
[FAIL] 
[FAIL] 
[FAIL] > @magnusekdahl/parallix@1.3.20 publish:guard
[FAIL] > node -e "require('./lib/core/build-freshness.js').assertBuildFreshness(process.cwd())"
[FAIL] 
[FAIL] magnusekdahl-parallix-1.3.20.tgz globally...
[FAIL] 
[FAIL] npm notice
[FAIL] npm notice 📦  @magnusekdahl/parallix@1.3.20
[FAIL] npm notice Tarball Contents
[FAIL] npm notice 7.9kB CHANGELOG.md
[FAIL] npm notice 34.5kB LICENSE
[FAIL] npm notice 15.8kB README.md
[FAIL] npm notice 1.0kB config/agents.json
[FAIL] npm notice 497B config/agents.local.json.template
[FAIL] npm notice 535B config/integration-pipelines.json
[FAIL] npm notice 64B config/state-map.json
[FAIL] npm notice 1.1kB config/state-map.json.template
[FAIL] npm notice 5.7kB config/workflow.config.schema.json
[FAIL] npm notice 0B data/.gitkeep
[FAIL] npm notice 5.0kB docs/adr/0031-ai-agent-instruction-boundary-and-command-floor.md
[FAIL] npm notice 6.2kB docs/adr/0032-mission-refinement-state-and-usage-budget-signals.md
[FAIL] npm notice 9.8kB docs/adr/0034-module-and-skill-invocation-model.md
[FAIL] npm notice 5.2kB docs/adr/0036-mission-sizing-and-dependency-wave-heuristics.md
[FAIL] npm notice 8.9kB docs/adr/0037-ai-workflow-coordination-architecture.md
[FAIL] npm notice 10.7kB docs/adr/0041-integration-pipeline-gates.md
[FAIL] npm notice 6.7kB docs/adr/0042-workflow-cli-color-rendering-approach.md
[FAIL] npm notice 15.3kB docs/adr/0043-git-target-resolution-strategy.md
[FAIL] npm notice 28.3kB docs/adr/0044-workflow-distribution-model.md
[FAIL] npm notice 12.9kB docs/adr/0045-parallax-branch-model.md
[FAIL] npm notice 11.9kB docs/adr/0046-npm-publish-process-and-security.md
[FAIL] npm notice 8.9kB docs/adr/0047-per-mission-change-size-budget.md
[FAIL] npm notice 14.5kB docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md
[FAIL] npm notice 18.6kB docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md
[FAIL] npm notice 3.7kB docs/adr/index.md
[FAIL] npm notice 14.8kB docs/agents.md
[FAIL] npm notice 24.5kB docs/authority-reference.md
[FAIL] npm notice 5.0kB docs/doc-standards.md
[FAIL] npm notice 3.9kB docs/forgejo-setup.md
[FAIL] npm notice 3.6kB docs/migration/extraction.md
[FAIL] npm notice 2.8kB docs/migration/task-classification.md
[FAIL] npm notice 3.6kB docs/operator-setup.md
[FAIL] npm notice 11.8kB docs/readme-rewrite-benchmark.md
[FAIL] npm notice 9.9kB docs/real-agent-smoke.md
[FAIL] npm notice 31.1kB docs/use-cases.md
[FAIL] npm notice 2.3kB examples/README.md
[FAIL] npm notice 7.5kB examples/run-enterprise-tarball-workflow-smoke.sh
[FAIL] npm notice 1.2kB examples/run-verify-env-smoke.sh
[FAIL] npm notice 11.9kB index.js
[FAIL] npm notice 44.8kB lib/agents/agents.js
[FAIL] npm notice 10.3kB lib/agents/claude-telemetry.js
[FAIL] npm notice 6.8kB lib/agents/claude.js
[FAIL] npm notice 8.4kB lib/agents/codex-telemetry.js
[FAIL] npm notice 10.3kB lib/agents/codex.js
[FAIL] npm notice 9.7kB lib/agents/limit-hit.js
[FAIL] npm notice 5.0kB lib/agents/mistral-telemetry.js
[FAIL] npm notice 13.3kB lib/agents/mistral.js
[FAIL] npm notice 7.7kB lib/agents/opencode-export.js
[FAIL] npm notice 14.4kB lib/agents/opencode-telemetry.js
[FAIL] npm notice 17.6kB lib/agents/opencode.js
[FAIL] npm notice 2.1kB lib/agents/stage-telemetry.js
[FAIL] npm notice 5.0kB lib/agents/vibe-telemetry.js
[FAIL] npm notice 13.3kB lib/agents/vibe.js
[FAIL] npm notice 36.2kB lib/commands/active.js
[FAIL] npm notice 4.5kB lib/commands/checkpoint.js
[FAIL] npm notice 3.6kB lib/commands/config.js
[FAIL] npm notice 15.3kB lib/commands/coverage-gate.js
[FAIL] npm notice 6.8kB lib/commands/diff.js
[FAIL] npm notice 51.3kB lib/commands/draft.js
[FAIL] npm notice 49.5kB lib/commands/handoff.js
[FAIL] npm notice 96.9kB lib/commands/integrate.js
[FAIL] npm notice 15.9kB lib/commands/mission-start.js
[FAIL] npm notice 14.3kB lib/commands/mutation-gate.js
[FAIL] npm notice 34.5kB lib/commands/rebase.js
[FAIL] npm notice 21.3kB lib/commands/repair-handoff.js
[FAIL] npm notice 6.3kB lib/commands/resolve-conflict.js
[FAIL] npm notice 604B lib/commands/review.js
[FAIL] npm notice 659B lib/commands/setup-review.js
[FAIL] npm notice 439B lib/commands/setup.js
[FAIL] npm notice 16.9kB lib/commands/stats-backfill.js
[FAIL] npm notice 92.7kB lib/commands/stats.js
[FAIL] npm notice 11.2kB lib/commands/status.js
[FAIL] npm notice 496B lib/commands/verify.js
[FAIL] npm notice 5.8kB lib/core/build-freshness.js
[FAIL] npm notice 5.3kB lib/core/fmt.js
[FAIL] npm notice 5.7kB lib/core/git.js
[FAIL] npm notice 3.6kB lib/core/gitignore.js
[FAIL] npm notice 43.6kB lib/core/mission-utils.js
[FAIL] npm notice 7.0kB lib/core/mutation-scoper.js
[FAIL] npm notice 6.2kB lib/core/nels.js
[FAIL] npm notice 11.7kB lib/core/persistent-data-migration.js
[FAIL] npm notice 2.3kB lib/core/post-integrate-hook.js
[FAIL] npm notice 17.9kB lib/core/product-config.js
[FAIL] npm notice 2.7kB lib/core/runtime-matrix.js
[FAIL] npm notice 5.6kB lib/core/spawn-tee.js
[FAIL] npm notice 4.2kB lib/core/state-map.js
[FAIL] npm notice 5.7kB lib/core/storage.js
[FAIL] npm notice 1.3kB lib/core/subagent-limit.js
[FAIL] npm notice 8.6kB lib/core/verification.js
[FAIL] npm notice 9.0kB lib/index.js
[FAIL] npm notice 768B lib/README.md
[FAIL] npm notice 8.8kB lib/review/rebase.js
[FAIL] npm notice 8.8kB lib/review/review-adapter.js
[FAIL] npm notice 26.7kB lib/review/review-artifacts.js
[FAIL] npm notice 70.0kB lib/review/review-commands.js
[FAIL] npm notice 29.0kB lib/review/review-events.js
[FAIL] npm notice 76.3kB lib/review/review-loop.js
[FAIL] npm notice 6.3kB lib/review/review-polling.js
[FAIL] npm notice 10.6kB lib/review/review-prompts.js
[FAIL] npm notice 12.6kB lib/review/review-state.js
[FAIL] npm notice 12.1kB lib/review/review.js
[FAIL] npm notice 36.8kB lib/tools/backlog.js
[FAIL] npm notice 76.2kB lib/tools/forgejo.js
[FAIL] npm notice 8.1kB lib/tools/gatekeeper.js
[FAIL] npm notice 10.9kB lib/tools/redgreen.js
[FAIL] npm notice 3.6kB lib/tools/sessions.js
[FAIL] npm notice 58.6kB lib/tools/setup-review.js
[FAIL] npm notice 2.0kB package.json
[FAIL] npm notice 1.4kB prompts/act-on-review-verbose.md
[FAIL] npm notice 1.7kB prompts/act-on-review.md
[FAIL] npm notice 3.2kB prompts/draft.md
[FAIL] npm notice 1.8kB prompts/execute.md
[FAIL] npm notice 1.6kB prompts/portfolio.md
[FAIL] npm notice 2.5kB prompts/review-verbose.md
[FAIL] npm notice 3.3kB prompts/review.md
[FAIL] npm notice 10.6kB px.js
[FAIL] npm notice 772B templates/AGENTS-snippet.md
[FAIL] npm notice 2.4kB templates/AGENTS.md.template
[FAIL] npm notice 148B templates/claude-commands/act-on-review.md
[FAIL] npm notice 108B templates/claude-commands/area-review.md
[FAIL] npm notice 317B templates/claude-commands/draft.md
[FAIL] npm notice 291B templates/claude-commands/execute.md
[FAIL] npm notice 141B templates/claude-commands/integrate.md
[FAIL] npm notice 203B templates/claude-commands/portfolio.md
[FAIL] npm notice 155B templates/claude-commands/review.md
[FAIL] npm notice 1.7kB templates/CLAUDE.md.template
[FAIL] npm notice 2.1kB templates/CODEX.md.template
[FAIL] npm notice 121B templates/codex/config.toml
[FAIL] npm notice 1.0kB templates/mission-scaffold.md
[FAIL] npm notice 1.1kB templates/VIBE.md.template
[FAIL] npm notice 657B templates/vibe/skills/act-on-review/SKILL.md
[FAIL] npm notice 569B templates/vibe/skills/area-review/SKILL.md
[FAIL] npm notice 533B templates/vibe/skills/draft/SKILL.md
[FAIL] npm notice 564B templates/vibe/skills/execute/SKILL.md
[FAIL] npm notice 558B templates/vibe/skills/integrate/SKILL.md
[FAIL] npm notice 804B templates/vibe/skills/portfolio/SKILL.md
[FAIL] npm notice 548B templates/vibe/skills/review/SKILL.md
[FAIL] npm notice 2.4kB tools/setup-forgejo-docker.sh
[FAIL] npm notice Tarball Details
[FAIL] npm notice name: @magnusekdahl/parallix
[FAIL] npm notice version: 1.3.20
[FAIL] npm notice filename: magnusekdahl-parallix-1.3.20.tgz
[FAIL] npm notice package size: 415.2 kB
[FAIL] npm notice unpacked size: 1.7 MB
[FAIL] npm notice shasum: cc18ee9aeb796f599ee54c2b3fdff826b6e165c2
[FAIL] npm notice integrity: sha512-2lRrVFdgUUY20[...]jMNPO/I/a8O8w==
[FAIL] npm notice total files: 138
[FAIL] npm notice
[FAIL] npm warn tarball tarball data for file:
[FAIL] npm warn tarball > @magnusekdahl/parallix@1.3.20 prepack
[FAIL] npm warn tarball > npm run publish:guard
[FAIL] npm warn tarball
[FAIL] npm warn tarball
[FAIL] npm warn tarball > @magnusekdahl/parallix@1.3.20 publish:guard
[FAIL] npm warn tarball > node -e "require('./lib/core/build-freshness.js').assertBuildFreshness(process.cwd())"
[FAIL] npm warn tarball
[FAIL] npm warn tarball magnusekdahl-parallix-1.3.20.tgz (null) seems to be corrupted. Trying again.
[FAIL] npm warn tarball tarball data for file:
[FAIL] npm warn tarball > @magnusekdahl/parallix@1.3.20 prepack
[FAIL] npm warn tarball > npm run publish:guard
[FAIL] npm warn tarball
[FAIL] npm warn tarball
[FAIL] npm warn tarball > @magnusekdahl/parallix@1.3.20 publish:guard
[FAIL] npm warn tarball > node -e "require('./lib/core/build-freshness.js').assertBuildFreshness(process.cwd())"
[FAIL] npm warn tarball
[FAIL] npm warn tarball magnusekdahl-parallix-1.3.20.tgz (null) seems to be corrupted. Trying again.
[FAIL] npm error code ENOENT
[FAIL] npm error syscall open
[FAIL] npm error path /home/magnus/code/parallix/
[FAIL] npm error path > @magnusekdahl/parallix@1.3.20 prepack
[FAIL] npm error path > npm run publish:guard
[FAIL] npm error path
[FAIL] npm error path
[FAIL] npm error path > @magnusekdahl/parallix@1.3.20 publish:guard
[FAIL] npm error path > node -e "require('./lib/core/build-freshness.js').assertBuildFreshness(process.cwd())"
[FAIL] npm error path
[FAIL] npm error path magnusekdahl-parallix-1.3.20.tgz
[FAIL] npm error errno -2
[FAIL] npm error enoent ENOENT: no such file or directory, open '/home/magnus/code/parallix/
[FAIL] npm error enoent > @magnusekdahl/parallix@1.3.20 prepack
[FAIL] npm error enoent > npm run publish:guard
[FAIL] npm error enoent
[FAIL] npm error enoent
[FAIL] npm error enoent > @magnusekdahl/parallix@1.3.20 publish:guard
[FAIL] npm error enoent > node -e "require('./lib/core/build-freshness.js').assertBuildFreshness(process.cwd())"
[FAIL] npm error enoent
[FAIL] npm error enoent magnusekdahl-parallix-1.3.20.tgz'
[FAIL] npm error enoent This is related to npm not being able to find a file.
[FAIL] npm error enoent
[FAIL] npm error A complete log of this run can be found in: /home/magnus/.npm/_logs/2026-07-07T19_49_10_623Z-debug-0.log
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
