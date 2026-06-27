const { git, run } = require('./git');
const { loadAdapterConfig } = require('./product-config');
const fs = require('fs');

// parallix targets arbitrary repositories, so there is no universal gate
// command. When adapters.verification.command is not configured, verification
// is a no-op pass ("no validation"). A repository opts into a real gate by
// declaring the command in workflow.config.json.
const DEFAULT_AREA = 'docs';
// Shell-safe no-op so this is harmless if pasted into a command sequence: `:` is
// the bash null command and `#` comments the explanation.
const NO_GATE_NOTICE = ': # no verification gate configured (set adapters.verification.command)';

function resolveVerificationAdapter(rootDir = process.cwd()) {
  const verification = loadAdapterConfig(rootDir).verification || {};
  const command = typeof verification.command === 'string' && verification.command.trim()
    ? verification.command.trim()
    : null;
  const defaultArea = typeof verification.defaultArea === 'string' && verification.defaultArea.trim()
    ? verification.defaultArea.trim()
    : DEFAULT_AREA;

  return { command, defaultArea };
}

function formatVerificationCommand(area, rootDir = process.cwd()) {
  const { command, defaultArea } = resolveVerificationAdapter(rootDir);
  const effectiveArea = area || defaultArea;
  if (!command) {
    return NO_GATE_NOTICE;
  }
  return command.replaceAll('{{area}}', effectiveArea);
}

function runVerificationGate(area, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const { command, defaultArea } = resolveVerificationAdapter(rootDir);
  const effectiveArea = area || defaultArea;

  if (!command) {
    const info = options.log || require('./fmt').log.info;
    info(`No verification gate configured for area: ${effectiveArea}; default is no validation. `
      + 'Set adapters.verification.command in workflow.config.json to enforce one.');
    return { status: 0 };
  }

  const stdio = options.stdio || 'inherit';
  const runFn = options.runFn || run;
  return runFn('bash', ['-lc', command.replaceAll('{{area}}', effectiveArea)], { cwd: rootDir, stdio });
}

function readPublishedTreeState(rootDir = process.cwd(), { gitRunner = git } = {}) {
  const resolvedRoot = fs.realpathSync(rootDir);
  const commitResult = gitRunner(['-C', resolvedRoot, 'rev-parse', 'HEAD']);
  const treeResult = gitRunner(['-C', resolvedRoot, 'rev-parse', 'HEAD^{tree}']);

  const commit = commitResult.stdout ? commitResult.stdout.trim() : '';
  const tree = treeResult.stdout ? treeResult.stdout.trim() : '';
  if (commitResult.status !== 0 || treeResult.status !== 0 || !commit || !tree) {
    return {
      ok: false,
      error: `could not resolve current published tree for ${resolvedRoot}`
    };
  }

  return { ok: true, rootDir: resolvedRoot, commit, tree };
}

function captureVerifiedTreeProof(area, rootDir = process.cwd(), options = {}) {
  const {
    gitRunner = git,
    runFn = run,
    stdio = 'inherit'
  } = options;

  const before = readPublishedTreeState(rootDir, { gitRunner });
  if (!before.ok) {return before;}

  const verification = runVerificationGate(area, {
    rootDir: before.rootDir,
    runFn,
    stdio
  });
  if (verification.status !== 0) {
    return {
      ok: false,
      error: `verification gate failed for ${before.rootDir} with exit code ${verification.status}`
    };
  }

  const after = readPublishedTreeState(before.rootDir, { gitRunner });
  if (!after.ok) {return after;}
  if (after.commit !== before.commit || after.tree !== before.tree) {
    return {
      ok: false,
      error: `verification proof became stale while publishing ${before.rootDir}`
    };
  }

  const { command, defaultArea } = resolveVerificationAdapter(before.rootDir);
  const effectiveArea = area || defaultArea;

  return {
    ok: true,
    proof: {
      rootDir: before.rootDir,
      area: effectiveArea,
      command: command || null,
      commit: after.commit,
      tree: after.tree,
      verifiedAt: new Date().toISOString()
    }
  };
}

function assertVerifiedTreeProof(proof, rootDir = process.cwd(), { gitRunner = git } = {}) {
  if (!proof || typeof proof !== 'object') {
    return { ok: false, error: 'missing verification proof' };
  }

  const current = readPublishedTreeState(rootDir, { gitRunner });
  if (!current.ok) {return current;}

  if (proof.rootDir !== current.rootDir) {
    return { ok: false, error: `verification proof was captured from a different checkout: ${proof.rootDir}` };
  }
  if (proof.commit !== current.commit || proof.tree !== current.tree) {
    return { ok: false, error: 'verification proof does not match the tree being published' };
  }

  return { ok: true, proof: current };
}

function runWorkflow(args, options = {}) {
  const log = options.log || require('./fmt').log.plain;
  const area = args[0] || process.env.VERIFY_AREA || DEFAULT_AREA;
  log(`Running verification gate for area: ${area}...`);
  return runVerificationGate(area, { stdio: 'inherit' });
}

module.exports = runWorkflow;
module.exports.DEFAULT_AREA = DEFAULT_AREA;
module.exports.NO_GATE_NOTICE = NO_GATE_NOTICE;
module.exports.formatVerificationCommand = formatVerificationCommand;
module.exports.resolveVerificationAdapter = resolveVerificationAdapter;
module.exports.runVerificationGate = runVerificationGate;
module.exports.readPublishedTreeState = readPublishedTreeState;
module.exports.captureVerifiedTreeProof = captureVerifiedTreeProof;
module.exports.assertVerifiedTreeProof = assertVerifiedTreeProof;
