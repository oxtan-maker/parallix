import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workflow = fs.readFileSync(path.join(import.meta.dirname, '..', '.github/workflows/ci-required.yml'), 'utf8');

test('task-2509: release trusts only the successful main-push SHA with release-only OIDC permissions', () => {
  assert.match(workflow, /permissions:\n\s+contents: read/);
  assert.match(workflow, /release:\n\s+needs: ci-required\n\s+if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && needs\.ci-required\.result == 'success'/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /release:[\s\S]*?permissions:\n\s+contents: write\n\s+id-token: write/);
  assert.match(workflow, /node-version: '24'/);
  assert.match(workflow, /registry-url: 'https:\/\/registry\.npmjs\.org'/);
  assert.match(workflow, /npm install --global npm@11\.5\.1/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /npm version/);
});

test('task-2522: ci-required runs and summarizes the existing coverage gate on PRs and main pushes', () => {
  assert.match(workflow, /pull_request:\n\s+branches:\n\s+- main/);
  assert.match(workflow, /push:\n\s+branches:\n\s+- main/);
  assert.match(workflow, /PARALLIX_TEST_COVERAGE/);
  assert.match(workflow, /npm run coverage:merge/);
  assert.match(workflow, /Publish SonarQube quality gate result[\s\S]*?GITHUB_STEP_SUMMARY/);
  assert.doesNotMatch(workflow, /npm run test:coverage/);
});
