const fs = require('fs');
const path = require('path');
const { eligibleAgentsForStep, workflowLauncherStatus } = require('../agents/agents');

// Agent eligibility and selection are config-driven: parallix/config/agents.json
// declares which agents are eligible per step, and each agent's launcher is
// discovered by the RESOLVERS in agents.js (which resolve launchers as bare
// executable names on PATH). This module no longer ships hardcoded
// binary paths.
const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'agents.json');

// Thin diagnostic wrapper over agents.js launcher discovery. Kept so the runtime
// matrix reports exactly the discovery the launcher actually uses (RESOLVERS),
// instead of a divergent default-path mechanism.
function launcherStatus(agent, options = {}) {
  const { workflowLauncherStatusFn = workflowLauncherStatus } = options;
  return workflowLauncherStatusFn(agent);
}

function buildAutonomousReviewMatrix(options = {}) {
  const {
    step = 'review',
    eligibleAgentsForStepFn = eligibleAgentsForStep,
    workflowLauncherStatusFn = workflowLauncherStatus,
    configPath = CONFIG_PATH,
    existsSyncFn = fs.existsSync
  } = options;

  const agents = eligibleAgentsForStepFn(step);
  const launchers = Object.fromEntries(
    agents.map(agent => [agent, workflowLauncherStatusFn(agent)])
  );

  return {
    step,
    agents,
    configPath,
    configPresent: existsSyncFn(configPath),
    launchers
  };
}

function formatMatrixSummary(matrix) {
  const lines = [];

  lines.push(`Agent eligibility config: ${matrix.configPresent ? 'present' : 'missing'} (${matrix.configPath})`);
  lines.push(`Launcher support matrix (step: ${matrix.step}):`);
  for (const agent of matrix.agents) {
    const launcher = matrix.launchers[agent];
    const status = launcher.supported ? 'supported' : 'blocked';
    const health = launcher.health ? `, ${launcher.health}` : '';
    const reason = launcher.reason ? `; ${launcher.reason}` : '';
    lines.push(`  - ${agent}: ${status} (${launcher.detail}${health}${reason})`);
  }
  lines.push(
    'Reviewer is chosen at runtime from the eligible-and-supported pool, ' +
    'excluding the implementer (config-driven via agents.json; no hardcoded routing).'
  );

  return lines;
}

/**
 * Returns true if any eligible agent other than `implementer` has a supported launcher.
 * Used by the review loop to decide whether single-family fallback is authorized.
 */
function runnableDifferentFamilyExists(implementer, options = {}) {
  const {
    step = 'review',
    eligibleAgentsForStepFn = eligibleAgentsForStep,
    workflowLauncherStatusFn = workflowLauncherStatus
  } = options;
  const agents = eligibleAgentsForStepFn(step);
  return agents.some(a => a !== implementer && workflowLauncherStatusFn(a).supported);
}

module.exports = {
  launcherStatus,
  buildAutonomousReviewMatrix,
  formatMatrixSummary,
  runnableDifferentFamilyExists
};
