---
id: TASK-1341
title: Make backlog.md optional
status: backlog
assignee: []
created_date: '2026-06-23 16:55'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
At the moment there is a hard dependency on backlog.md in parallix, fix this so its possible to start the draft of a mission using px draft "create a hello world program" or px draft ./... to load the intent instead. Its ok in those cases that the classification of user_value/ai_sdlc is not availible. But we need to ensure that stats module still works "unkown" or similar instead.

Also go thourgh all other dependencies in all other parts of parallix so similar to the forgejo setup its truly optional and not hardcoded or coded as spaggeticode, see forgejo missions in . and ../visualBoard on the several refactors before foregjo got into a good state.

Update the README.md, see the style/tone from the SEO mission so this looks more useful and first time users do not have to spend time understanding both parallix and backlog.md if they only read first time install instructions.
<!-- SECTION:DESCRIPTION:END -->
