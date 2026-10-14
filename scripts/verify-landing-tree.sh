#!/usr/bin/env bash
set -euo pipefail
npm test -- --unit-test-headroom \
  test/unit/adapters/backlog/backlog-completed-task-consistency.test.ts \
  test/unit/adapters/cli/commands/mission-directory-free-workflow.test.ts \
  test/unit/adapters/cli/commands/prompt-split.test.ts \
  test/unit/test/lib/test-categories.test.ts \
  test/unit/test/lib/default-test-suite.test.ts \
  test/unit/repository/file-size-cap.test.ts
