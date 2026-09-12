---
id: TASK-2489
title: add a team lead/scrum master/loop to parallix
status: backlog
assignee: []
created_date: '2026-09-11 09:21'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
while the rebounces has reduced the need for human attention on standard agent failure modes a lot there are still holes and will most likely always be to some extend. 

Add a team leader/ scrum master to parallix to help stucked missions to proceed, usually by giving the agent a more correct context on how to resolve issues than the code prompt gives (when it fails) and ask the agent to fix the problem without breaking the mission deliveries or the repo. Do not try to autofix genuine problems that needs human attention, most commonly when the repo and or different instructions in the mission are in conflict with each other (geniune block).

Do not try to get the agents to fix problems in a mission that is a problem in main, instead create new backlog.md ticket to solve it on main instead as a parallel mission, and then rebase the mission branch to main once the blocker is resolved and resume the mission.

Do (web) research on how to implement loops/team leaders in blogs, articles, and existing repo implementations in similar projects to parallix, this mission needs to be credible as evaluated by a senior AI engineer.
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
