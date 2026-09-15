#!/usr/bin/env bash
# bump-version.sh — parallix's own integrate pre-commit hook.
#
# Wired via workflow.config.json's adapters.integrate.preCommitCommand. px
# integrate runs it in the mission worktree after rebasing onto the base branch
# and before the integration gates; px commits the files it modifies onto the
# mission branch, so the squash lands one commit carrying the version bump.
#
# The base branch (INTEGRATE_HOOK_BASE_BRANCH, HEAD when unset) is the version
# authority. A mission branch carrying a stale version must not move the
# version backwards (task-2500.05 landed 1.5.121 -> 1.5.119). The next version
# is the base patch + 1, unless the mission already declares a newer version,
# which is kept — so re-running integrate after an abort does not bump twice.
# The script never commits.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."

node - <<'NODE'
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

// ponytail: plain MAJOR.MINOR.PATCH only; prerelease versions fail closed.
const parse = (version, source) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!match) { throw new Error(`${source} version "${version}" is not MAJOR.MINOR.PATCH`); }
  return match.slice(1).map(Number);
};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

const baseRef = process.env.INTEGRATE_HOOK_BASE_BRANCH || 'HEAD';
const base = parse(JSON.parse(execFileSync('git', ['show', `${baseRef}:package.json`], { encoding: 'utf8' })).version, `${baseRef} package.json`);
const pkg = readJson('package.json');
const mission = parse(pkg.version, 'package.json');
const firstDiff = mission.findIndex((part, index) => part !== base[index]);
const next = firstDiff !== -1 && mission[firstDiff] > base[firstDiff]
  ? pkg.version
  : `${base[0]}.${base[1]}.${base[2] + 1}`;

pkg.version = next;
writeJson('package.json', pkg);
if (fs.existsSync('package-lock.json')) {
  const lock = readJson('package-lock.json');
  lock.version = next;
  if (lock.packages && lock.packages['']) { lock.packages[''].version = next; }
  writeJson('package-lock.json', lock);
}
console.log(`[bump-version] ${base.join('.')} -> ${next}`);
NODE
