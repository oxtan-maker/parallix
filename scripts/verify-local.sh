#!/bin/sh
# Start via POSIX sh so an inherited BASH_ENV cannot run before this script has
# a chance to clear it. The verifier itself requires Bash below.
if [ "${VERIFY_LOCAL_CLEAN_BASH:-}" != "1" ]; then
  exec env -u BASH_ENV VERIFY_LOCAL_CLEAN_BASH=1 bash "$0" "$@"
fi

# verify-local.sh — local development verification gate
# Usage: ./scripts/verify-local.sh <subcommand>
# Subcommands:
#   docs             — verify documentation completeness
#   static-analysis  — run ESLint, tsc typecheck, and test-hygiene checks
#   integrate        — run configured integration-time gates for changed areas
#   mutation-gate    — parallix-internal-only: diff-scoped mutation-testing ratchet
#                      for parallix's own development (see docs/adr/adr-mutation-testing.md);
#                      not a parallix user feature — cannot run on an arbitrary repo.
#                      pass extra flags through, e.g. `./scripts/verify-local.sh mutation-gate --dry-run`
#   all              — run the repo's general fast verification suite
#   workflow         — alias for the general fast verification suite
#   (other)          — fall back to the general fast verification suite
#   (none)           — no-op (default gate behavior)

set -euo pipefail

subcommand="${1:-}"
SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

# `bash -lc` may activate an old NVM default after Parallix has already been
# launched with a supported runtime. The default suite uses `node --test`, so
# ensure npm resolves a Node version that satisfies package.json's >=20 engine.
node_major() {
  "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || true
}

select_supported_node() {
  local candidate major nvm_dir version
  local candidates=()

  [[ -n "${PARALLIX_NODE:-}" ]] && candidates+=("$PARALLIX_NODE")
  candidates+=("$(command -v node)")
  [[ -x "$HOME/.local/bin/node" ]] && candidates+=("$HOME/.local/bin/node")

  nvm_dir="${NVM_DIR:-$HOME/.nvm}/versions/node"
  if [[ -d "$nvm_dir" ]]; then
    for version in "$nvm_dir"/*; do
      [[ -x "$version/bin/node" ]] && candidates+=("$version/bin/node")
    done
  fi

  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" && -x "$candidate" ]] || continue
    major="$(node_major "$candidate")"
    if [[ "$major" =~ ^[0-9]+$ ]] && (( major >= 20 )); then
      export PATH="$(dirname "$candidate"):$PATH"
      return 0
    fi
  done

  echo "FAIL: Node.js >=20 is required for verification; found $(node --version 2>/dev/null || echo 'no node')." >&2
  return 1
}

select_supported_node

# Apple Git 2.24 lacks `git init -b`, while the fixture suite uses that modern
# spelling. Keep the compatibility shim scoped to verification so production
# Git calls retain the operator's configured executable.
export PARALLIX_REAL_GIT="$(command -v git)"
export PATH="${SCRIPT_DIR}:$PATH"

gate_all() {
  npm test
}

# Static-analysis gate: runs ESLint, tsc --checkJs, and test-hygiene sequentially
gate_static_analysis() {
  echo "=== Static Analysis Gate ==="

  # Tests execute dist/ JavaScript, but typechecking that generated CommonJS
  # directly is both noisy and expensive. Emit declarations only for this gate
  # so test imports resolve cheaply, then remove them: declarations are not part
  # of the distribution contract (ADR 0044).
  cleanup_test_declarations() {
    find "$REPO_ROOT/dist" -type f -name '*.d.ts' -delete 2>/dev/null || true
  }
  trap cleanup_test_declarations EXIT

  # Stage 1: ESLint on all sources with flat config (no --ext, ignores handled by config)
  echo "[1/4] Running ESLint..."
  if ! npx --yes eslint --max-warnings 300 lib/ index.ts px.ts 2>&1; then
    echo "FAIL: ESLint reported errors"
    return 1
  fi
  echo "PASS: ESLint clean"

  # Stage 2: TypeScript typecheck (emission mode)
  echo "[2/4] Running npm run typecheck..."
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
  echo "[3/4] Running test-hygiene check..."
  if ! bash scripts/test-hygiene.sh; then
    echo "FAIL: test-hygiene scanner found violations"
    return 1
  fi
  echo "PASS: test-hygiene clean"

  # Stage 4: Test typecheck (check-only project for test/**/*.js)
  echo "[4/4] Running test typecheck..."
  if ! npx tsc --declaration --emitDeclarationOnly; then
    echo "FAIL: could not prepare temporary declarations for test typecheck"
    return 1
  fi
  TEST_TSC_OUTPUT=$(npx tsc --noEmit --project tsconfig.test.json 2>&1 || true)
  if [ -z "$TEST_TSC_OUTPUT" ]; then
    echo "PASS: test typecheck clean"
  else
    echo "$TEST_TSC_OUTPUT"
    echo "FAIL: test typecheck reported errors"
    return 1
  fi

  echo "=== Static Analysis Gate: ALL STAGES PASSED ==="
  return 0
}

gate_integrate() {
  local real_agent="${PARALLIX_REAL_AGENT:-}"
  local real_agent_model="${PARALLIX_REAL_AGENT_MODEL:-}"
  local saw_real_agent=0
  local saw_real_agent_model=0

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --real-agent|--real-agent-model)
        if [ "$#" -lt 2 ] || [ -z "$2" ] || [[ "$2" == --* ]]; then
          echo "FAIL: $1 requires a value" >&2
          return 1
        fi
        if [ "$1" = "--real-agent" ]; then
          if [ "$saw_real_agent" -eq 1 ]; then echo "FAIL: --real-agent may be supplied only once" >&2; return 1; fi
          real_agent="$2"; saw_real_agent=1
        else
          if [ "$saw_real_agent_model" -eq 1 ]; then echo "FAIL: --real-agent-model may be supplied only once" >&2; return 1; fi
          real_agent_model="$2"; saw_real_agent_model=1
        fi
        shift 2
        ;;
      *) echo "FAIL: unknown integrate option: $1" >&2; return 1 ;;
    esac
  done

  if [ -n "$real_agent" ] || [ -n "$real_agent_model" ]; then
    if [ -z "$real_agent" ] || [ -z "$real_agent_model" ]; then
      echo "FAIL: --real-agent and --real-agent-model must be supplied together" >&2
      return 1
    fi
    if [ "$real_agent" != "codex" ]; then
      echo "FAIL: unsupported real agent $real_agent (supported: codex)" >&2
      return 1
    fi
    if [ "$real_agent_model" != "gpt-5.6-luna" ]; then
      echo "FAIL: unsupported Codex real-agent model $real_agent_model (supported: gpt-5.6-luna)" >&2
      return 1
    fi
  fi

  PARALLIX_REAL_AGENT="$real_agent" PARALLIX_REAL_AGENT_MODEL="$real_agent_model" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const repoRoot = process.cwd();
const realAgent = String(process.env.PARALLIX_REAL_AGENT || '');
const realAgentModel = String(process.env.PARALLIX_REAL_AGENT_MODEL || '');
const {
  loadIntegrationConfig,
  parseFilesToAreas,
  orderIntegrationGates,
  gateMatchesChangedAreas,
} = require('./dist/lib/commands/integrate.js');

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
const relevantGates = orderedGates.filter(gate => gateMatchesChangedAreas(gate.key, changedAreas, gate.areas));

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
  const gateEnv = {
    ...process.env,
    WORKFLOW_SUITE_CONTEXT: process.env.WORKFLOW_SUITE_CONTEXT || '',
  };
  // `bash -c` does not load login profiles, but Bash still honors BASH_ENV for
  // non-interactive shells. Do not let an inherited startup hook affect a
  // project verification gate.
  delete gateEnv.BASH_ENV;
  if (gate.key === 'custom-agent-smoke' && realAgent && realAgentModel) {
    gateEnv.PARALLIX_REAL_AGENT = realAgent;
    gateEnv.PARALLIX_REAL_AGENT_MODEL = realAgentModel;
  } else {
    delete gateEnv.PARALLIX_REAL_AGENT;
    delete gateEnv.PARALLIX_REAL_AGENT_MODEL;
  }
  // Gates inherit the verified runner environment. Avoid login-shell startup
  // files, which can rewrite PATH or fail independently of the project.
  const result = childProcess.spawnSync('bash', ['-c', gate.command], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: gateEnv
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

# Parallix-internal-only pre-integrate gate: diff-scoped mutation-testing ratchet.
# Runs against parallix's own lib/ tree and test suite; cannot execute on an
# arbitrary user repository (see docs/adr/adr-mutation-testing.md). Invoked
# directly via `./scripts/verify-local.sh mutation-gate` or through the
# integration pipeline at config/integration-pipelines.json (order 40).
gate_mutation() {
  npm run --silent build
  node dist/lib/commands/mutation-gate.js "$@"
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
  mutation-gate)
    shift || true
    gate_mutation "$@" || exit 1
    exit 0
    ;;
  integrate)
    shift || true
    gate_integrate "$@" || exit 1
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
