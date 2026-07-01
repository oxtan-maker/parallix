#!/usr/bin/env bash
# verify-local.sh — local development verification gate
# Usage: ./scripts/verify-local.sh <subcommand>
# Subcommands:
#   docs             — verify documentation completeness
#   static-analysis  — run ESLint, tsc typecheck, and test-hygiene checks
#   integrate        — run configured integration-time gates for changed areas
#   all              — run the repo's general fast verification suite
#   workflow         — alias for the general fast verification suite
#   (other)          — fall back to the general fast verification suite
#   (none)           — no-op (default gate behavior)

set -euo pipefail

subcommand="${1:-}"
SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

gate_all() {
  npm test
}

# Static-analysis gate: runs ESLint, tsc --checkJs, and test-hygiene sequentially
gate_static_analysis() {
  echo "=== Static Analysis Gate ==="

  # Stage 1: ESLint on all sources with flat config (no --ext, ignores handled by config)
  echo "[1/3] Running ESLint..."
  if ! npx --yes eslint --max-warnings 300 lib/ index.ts px.ts 2>&1; then
    echo "FAIL: ESLint reported errors"
    return 1
  fi
  echo "PASS: ESLint clean"

  # Stage 2: TypeScript typecheck (emission mode)
  echo "[2/3] Running npm run typecheck..."
  TSC_OUTPUT=$(npm run typecheck 2>&1 || true)
  BAD_ERRORS=$(echo "$TSC_OUTPUT" | grep "error TS" | grep -v "TS18003" || true)
  if [ -z "$BAD_ERRORS" ]; then
    echo "PASS: tsc typecheck clean"
  else
    echo "$TSC_OUTPUT"
    echo "FAIL: tsc typecheck reported errors"
    return 1
  fi

  # Stage 3: Test-hygiene scanner
  echo "[3/3] Running test-hygiene check..."
  if ! bash scripts/test-hygiene.sh; then
    echo "FAIL: test-hygiene scanner found violations"
    return 1
  fi
  echo "PASS: test-hygiene clean"

  echo "=== Static Analysis Gate: ALL STAGES PASSED ==="
  return 0
}

gate_integrate() {
  node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const repoRoot = process.cwd();
const {
  loadIntegrationConfig,
  parseFilesToAreas,
  orderIntegrationGates,
  gateMatchesChangedAreas,
} = require('./lib/commands/integrate.js');

function log(message = '') {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
}

function detectChangedAreasFromGit() {
  const baseProbe = childProcess.spawnSync('git', ['branch', '--list', 'main', 'master', '--format=%(refname:short)'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  const baseBranch = (baseProbe.stdout || '')
    .split('\n')
    .map(line => line.trim())
    .find(Boolean) || 'main';

  const diffResult = childProcess.spawnSync('git', ['diff', '--name-only', baseBranch, '--', '.'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (diffResult.status === 0 && (diffResult.stdout || '').trim()) {
    return parseFilesToAreas(diffResult.stdout);
  }

  const headDiff = childProcess.spawnSync('git', ['diff', '--name-only', 'HEAD', '--', '.'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  if (headDiff.status === 0 && (headDiff.stdout || '').trim()) {
    return parseFilesToAreas(headDiff.stdout);
  }

  return [];
}

function resolveChangedAreas() {
  if (Object.prototype.hasOwnProperty.call(process.env, 'INTEGRATE_CHANGED_AREAS')) {
    return String(process.env.INTEGRATE_CHANGED_AREAS || '')
      .split(/\s+/)
      .map(area => area.trim())
      .filter(Boolean);
  }
  return detectChangedAreasFromGit();
}

const configPath = process.env.INTEGRATION_CONFIG_PATH || path.join(repoRoot, 'config', 'integration-pipelines.json');
const configResult = loadIntegrationConfig({ configPath });
if (!configResult.ok) {
  log(`integration-gates: ${configResult.error}, skipping`);
  process.exit(0);
}

const config = configResult.config || {};
if (!config.gates || Object.keys(config.gates).length === 0) {
  log('integration-gates: no gates defined in config, skipping');
  process.exit(0);
}

const changedAreas = resolveChangedAreas();
if (changedAreas.length === 0) {
  log('integration-gates: no area changes detected, skipping');
  process.exit(0);
}

const orderedGates = orderIntegrationGates(config);
const relevantGates = orderedGates.filter(gate => gateMatchesChangedAreas(gate.key, changedAreas));

if (relevantGates.length === 0) {
  log('integration-gates: no applicable gates for changed areas');
  process.exit(0);
}

if (String(process.env.INTEGRATE_DRY_RUN || '').toLowerCase() === 'true') {
  log('integration-gates: resolved gate plan:');
  for (const gate of relevantGates) {
    log(`${gate.key}: ${gate.command}`);
  }
  process.exit(0);
}

for (const gate of relevantGates) {
  log(`=== GATE: integration:${gate.key} ===`);
  log(`Command: ${gate.command}`);
  const result = childProcess.spawnSync('bash', ['-lc', gate.command], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      WORKFLOW_SUITE_CONTEXT: process.env.WORKFLOW_SUITE_CONTEXT || '',
    }
  });
  if (result.status !== 0) {
    fail(`=== FAIL: integration:${gate.key} ===`);
    fail(`Command: ${gate.command}`);
    process.exit(result.status || 1);
  }
  log(`=== PASS: integration:${gate.key} ===`);
}
NODE
}

case "$subcommand" in
  docs)
    # Verify key documentation files exist
    errors=0
    for f in README.md CHANGELOG.md LICENSE; do
      if [ ! -f "$f" ]; then
        echo "MISSING: $f"
        errors=$((errors + 1))
      fi
    done
    if [ ! -d docs/adr ]; then
      echo "MISSING: docs/adr/"
      errors=$((errors + 1))
    fi
    if [ "$errors" -gt 0 ]; then
      echo "FAIL: $errors documentation item(s) missing"
      exit 1
    fi
    echo "PASS: all required documentation present"
    exit 0
    ;;
  static-analysis)
    gate_static_analysis || exit 1
    exit 0
    ;;
  integrate)
    gate_integrate || exit 1
    exit 0
    ;;
  all|workflow)
    gate_all || exit 1
    exit 0
    ;;
  "")
    exit 0
    ;;
  *)
    gate_all || exit 1
    exit 0
    ;;
esac
