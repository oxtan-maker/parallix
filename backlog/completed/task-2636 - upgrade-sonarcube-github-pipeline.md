---
id: TASK-2636
title: upgrade sonarcube github pipeline
status: done
assignee: [custom]
created_date: '2026-10-03 13:53'
labels: []
dependencies: []
ordinal: 155008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
> tsx scripts/sonar-local.ts scan

INFO: Scanner configuration file: /home/runner/work/parallix/parallix/node_modules/sonar-scanner/conf/sonar-scanner.properties
INFO: Project root configuration file: /home/runner/work/parallix/parallix/sonar-project.properties
INFO: SonarQube Scanner 3.1.0.1141
INFO: Java 17.0.20.1 Eclipse Adoptium (64-bit)
INFO: Linux 6.17.0-1022-azure amd64
INFO: User cache: /home/runner/work/parallix/parallix/tmp/sonar/cache
INFO: SonarQube server 13.14.0.6149
INFO: Default locale: "en", source code encoding: "UTF-8"
INFO: ------------------------------------------------------------------------
INFO: EXECUTION FAILURE
INFO: ------------------------------------------------------------------------
INFO: Total time: 4.515s
INFO: Final Memory: 6M/40M
INFO: ------------------------------------------------------------------------
ERROR: Error during SonarQube Scanner execution
ERROR: Java 17 is not supported. Please upgrade to Java 21 or newer, or use JRE auto-provisioning to keep this requirement always up to date. For more information check https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/scanners/scanner-environment/general-requirements.
ERROR: 
ERROR: Re-run SonarQube Scanner using the -X switch to enable full debug logging.
SonarQube Cloud analysis or quality gate failed (exit 1).
(node:31863) [DEP0205] DeprecationWarning: `module.register()` is deprecated. Use `module.registerHooks()` instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
Error: Process completed with exit code 1.

Interesting since parallix is not a java project at all.
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
