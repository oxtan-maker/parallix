---
id: TASK-1332
title: Use case extraction
status: backlog
assignee: []
created_date: '2026-06-22 16:11'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
# Mission: Extract primary Parallix use cases for positioning and branding

## Status

Locked mission.

## Mission type

Product / PM discovery and positioning.

## Objective

Extract the primary use cases for Parallix from the actual repository, workflow behavior, docs, prompts, examples, missions, config, and code. The goal is to create a credible PM-quality use-case foundation that can later drive positioning, branding, README rewrite, landing page copy, examples, and packaging decisions.

The current README is not credible as an external-facing explanation because it reads like an internal authority reference rather than a clear product narrative. Do not rewrite the README in this mission. Produce the underlying product/use-case analysis first.

## Background

Parallix is a Node.js toolkit and `px` runner for coordinating AI-assisted software missions through a structured lifecycle. It appears to support:

* mission lifecycle management across states such as backlog, draft, active, review, approved, and done
* worktree and branch based execution
* multi-agent execution and review
* agent selection and blocklisting
* checkpoint-based resumability
* review loops
* integration gates
* stats / telemetry
* repo-specific verification adapters
* local packaging and enterprise/local installation paths

However, these are implementation capabilities, not yet a clear product story. This mission should translate the implementation reality into credible PM use cases.

## Product question

What are the primary use cases Parallix actually supports today, and which of them are strong enough to be used for public positioning?

## Non-goals

Do not rewrite the public README.

Do not invent capabilities that are not supported by the repository.

Do not create aspirational marketing claims unless clearly marked as future / not yet supported.

Do not rename the product.

Do not change runtime behavior unless a tiny documentation-supporting correction is required and explicitly justified.

Do not turn this into generic “AI coding tool” positioning. The output must be specific to Parallix.

## Required approach

Work as a skeptical PM, not as a fan of the project.

Start from repository evidence. Inspect, at minimum:

* README.md
* package.json
* AGENTS.md
* CHANGELOG.md
* docs/
* docs/adr/
* prompts/
* templates/
* examples/
* missions/
* config/
* lib/
* index.js
* px.js
* tests, especially where they reveal expected behavior

Also inspect git history mission for both parallix and ../visualBoard to find the agent missions including the retros and the hypothesis that are bets and what of those have data what is not proven.
<!-- SECTION:DESCRIPTION:END -->
