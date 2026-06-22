const { run } = require('./git');
const { loadAdapterConfig } = require('./product-config');

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
