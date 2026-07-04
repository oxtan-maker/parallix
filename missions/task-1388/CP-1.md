# CP-1: Extended buildPushbackBody() with artifact-creation instructions

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| buildPushbackBody includes creation instructions for MISSION.md | gatekeeper.ts:80-81: `instructions.push('- **create** \`MISSION.md\` with the standard mission contract template...'` | PASS |
| buildPushbackBody includes creation instructions for checkpoint docs | gatekeeper.ts:83-84: `instructions.push('- **create** at least one checkpoint document (e.g. \`CP-1.md\`) with a \`## Goal Check\` table...'` | PASS |
| buildPushbackBody includes creation instructions for backlog task file | gatekeeper.ts:86-87: `instructions.push('- **create** a backlog task file at \`backlog/tasks/<slug> - <title>.md\`...'` | PASS |
| buildPushbackBody omits instructions section when no artifacts are missing | gatekeeper.ts:89-91: `const instructionsBlock = instructions.length > 0 ? ... : ''` | PASS |
| Test: buildPushbackBody includes artifact-creation instructions for MISSION.md | gatekeeper.test.js:149-157: asserts body includes 'create', 'MISSION.md', 'mission contract template' | PASS |
| Test: buildPushbackBody includes artifact-creation instructions for CP-*.md | gatekeeper.test.js:159-167: asserts body includes 'create', 'CP-1.md', 'Goal Check' | PASS |
| Test: buildPushbackBody includes artifact-creation instructions for backlog task | gatekeeper.test.js:169-177: asserts body includes 'create', 'backlog/tasks', 'frontmatter' | PASS |
| Test: all three instructions present when all artifacts missing | gatekeeper.test.js:179-190: asserts 3 `**create**` instruction lines | PASS |
| All existing gatekeeper tests pass without regression | `node --test test/gatekeeper.test.js` → 18 pass, 0 fail | PASS |

Next action: Implement bounded retry loop in handoff.ts for gatekeeperPushedBack case (CP-2).
