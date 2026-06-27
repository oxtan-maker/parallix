const { git, run } = require('./git');

/** @typedef {(args: string[], options?: object) => import('child_process').SpawnSyncReturns<string>} GitFn */
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

/** @param {string} [area] @param {string} [rootDir] */
function formatVerificationCommand(area, rootDir = process.cwd()) {
  const { command, defaultArea } = resolveVerificationAdapter(rootDir);
  const effectiveArea = area || defaultArea;
  if (!command) {
    return NO_GATE_NOTICE;
  }
  return command.replaceAll('{{area}}', effectiveArea || DEFAULT_AREA);
}

/** @param {string} [area] @param {{rootDir?: string, log?: Function, stdio?: string, runFn?: Function}} [options] */
function runVerificationGate(area, options = {}) {
  /** @type {{rootDir?: string, log?: Function, stdio?: string, runFn?: Function}} */
  const opts = options;
  const rootDir = opts.rootDir || process.cwd();
  const { command, defaultArea } = resolveVerificationAdapter(rootDir);
  const effectiveArea = area || defaultArea;

  if (!command) {
    const info = opts.log || require('./fmt').log.info;
    info(`No verification gate configured for area: ${effectiveArea}; default is no validation. `
      + 'Set adapters.verification.command in workflow.config.json to enforce one.');
    return { status: 0 };
  }

  const stdio = opts.stdio || 'inherit';
  const runFn = opts.runFn || run;
  return runFn('bash', ['-lc', command.replaceAll('{{area}}', effectiveArea)], { cwd: rootDir, stdio });
}

/** @param {string} rootDir @param {{gitRunner?: GitFn}} [options] */
function readPublishedTreeState(rootDir, options = {}) {
  /** @type {GitFn} */
  const gitRunner = options.gitRunner || git;
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

/** @param {string} [area] @param {string} [rootDir] @param {{gitRunner?: GitFn, runFn?: Function, stdio?: string}} [options] */
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

  const after = readPublishedTreeState(/** @type {string} */(before.rootDir), { gitRunner });
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

/** @param {{rootDir?: string, commit?: string, tree?: string}} proof @param {string} [rootDir] @param {{gitRunner?: GitFn}} [opts] */
function assertVerifiedTreeProof(proof, rootDir = process.cwd(), opts = {}) {
  if (!proof || typeof proof !== 'object') {
    return { ok: false, error: 'missing verification proof' };
  }

  /** @type {{gitRunner?: GitFn}} */
  const o = opts;
  const gitRunner = o.gitRunner || git;
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

/** @param {string[]} args @param {{log?: Function}} [options] */
function runWorkflow(args, options = {}) {
  /** @type {{log?: Function}} */
  const opts = options;
  const log = opts.log || require('./fmt').log.plain;
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
