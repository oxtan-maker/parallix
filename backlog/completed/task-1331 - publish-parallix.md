---
id: TASK-1331
title: publish parallix
status: done
assignee: [qwen]
created_date: '2026-06-22 05:47'
labels:
  - ai_sdlc
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
I have now pushed parallix to public github. Go through the decisions made and create a credible distribution model and fix remaining visualBoard references.

Concrete concerns already visible in this repo:
- `package.json` still says parallix is private / unpublished.
- `README.md` still frames the workflow as a visualBoard lifecycle.
- `docs/adr/0044-workflow-distribution-model.md` is still proposed even though the repo is
  now public and needs a real operator-facing distribution story.
- There are still current public-facing `visualBoard` references in active docs/templates
  that should either become `parallix` or be explicitly marked historical.
<!-- SECTION:DESCRIPTION:END -->
