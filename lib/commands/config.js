#!/usr/bin/env node

const fmt = require('../core/fmt');
const { loadEffectiveConfig, loadWorkflowConfig, validateWorkflowConfig } = require('../core/product-config');

// `node parallix config` — read-only. Prints the effective configuration:
// code-owned defaults merged with the optional workflow.config.json override.
// This replaces the deleted workflow.config.json.example as the way to discover
// the configurable surface, with no copy-paste footgun and no second source of
// truth to drift from (task-1233 Scope Amendment).
/** @param {string[]} _args @param {{logFn?: Function, errorFn?: Function, exitFn?: Function, rootDir?: string}} opts */
async function config(_args = [], opts = {}) {
  void _args; // intentionally unused — part of public API signature
  const logFn = opts.logFn || fmt.log.plain;
  const errorFn = opts.errorFn || fmt.log.plainError;
  const exitFn = opts.exitFn || /** @type{(code: number) => void} */ ((code) => { process.exitCode = code; });
  const rootDir = opts.rootDir || process.cwd();

  const loaded = loadWorkflowConfig(rootDir);
  if (!loaded.found) {
    logFn(fmt.status('INFO', 'No workflow.config.json found — showing built-in defaults.'));
  } else if (loaded.parseError) {
    errorFn(fmt.status('FAIL', `workflow.config.json is invalid JSON (${/** @type{Error} */(loaded.parseError).message}); showing fallback built-in defaults.`));
    logFn(JSON.stringify(loadEffectiveConfig(rootDir), null, 2));
    exitFn(1);
    return;
  } else {
    const issues = validateWorkflowConfig(loaded.config);
    if (issues.length > 0) {
      errorFn(fmt.status('FAIL', `workflow.config.json is structurally invalid: ${issues.join('; ')}; showing fallback built-in defaults.`));
      logFn(JSON.stringify(loadEffectiveConfig(rootDir), null, 2));
      exitFn(1);
      return;
    }
    logFn(fmt.status('INFO', `Effective config (built-in defaults + ${loaded.configPath}):`));
  }

  logFn(JSON.stringify(loadEffectiveConfig(rootDir), null, 2));
}

module.exports = config;
