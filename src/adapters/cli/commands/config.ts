#!/usr/bin/env node

import * as fmt from '../../../application/presentation/cli-format.js';
import { loadEffectiveConfig, loadWorkflowConfig, validateWorkflowConfig, hasGitRepository } from '../../config/product-config.js';
import { ensureFirstRunAgentConfig } from '../../agents/first-run-config.js';
import { CONFIG_PATH } from '../../agents/agent-config.js';

interface ConfigOptions {
  logFn?: (_msg: string) => void;
  errorFn?: (_msg: string) => void;
  exitFn?: (_code: number) => void;
  rootDir?: string;
}

// `node parallix config` — read-only. Prints the effective configuration:
// code-owned defaults merged with the optional workflow.config.json override.
// This replaces the deleted workflow.config.json.example as the way to discover
// the configurable surface, with no copy-paste footgun and no second source of
// truth to drift from (architecture migration Scope Amendment).
function wantsConfigWrite(args: string[]): boolean {
  return args.includes('--write');
}

async function config(_args: string[] = [], opts: ConfigOptions = {}) {
  const logFn = opts.logFn || fmt.log.plain;
  const errorFn = opts.errorFn || fmt.log.plainError;
  const exitFn = opts.exitFn || ((code: number) => { process.exitCode = code; });
  const rootDir = opts.rootDir || process.cwd();

  // `px config --write` regenerates (or refreshes) the working-tree
  // config/agents.json with availability-filtered eligible agents. It is a
  // write, so it requires a repository root and never runs on the read-only
  // default path, which keeps printing the effective config as before.
  if (wantsConfigWrite(_args)) {
    if (!hasGitRepository(rootDir)) {
      errorFn(fmt.status('FAIL', 'px config --write requires a repository root. Run it from a git checkout.'));
      exitFn(1);
      return;
    }
    // force:true so an explicit --write regenerates a stale/empty detection; the
    // implicit first-run hook never sets force, so it stays idempotent.
    const result = ensureFirstRunAgentConfig({ rootDir, worktree: rootDir, force: true });
    if (result.written) {
      logFn(fmt.status('INFO', `Wrote ${result.configPath} with availability-filtered eligible agents.`));
    } else if (result.emptyDetection) {
      logFn(fmt.status('WARN', `No agent families are available on this host; left ${CONFIG_PATH} unchanged and falling back to the shipped default. Install a launcher or set WORKFLOW_AGENT=<name>.`));
    } else {
      logFn(fmt.status('INFO', `Working-tree ${CONFIG_PATH} already exists — left unchanged (user edits win).`));
    }
    logFn(JSON.stringify(loadEffectiveConfig(rootDir), null, 2));
    return;
  }

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

export default config;
export { config };
