import fs from 'node:fs';
import path from 'node:path';

export function positiveCpuBudget(value, name) {
  const budget = Number(value);
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error(`invalid ${name} CPU budget`);
  return budget;
}

export function readCpuBudgetPolicy(root) {
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'test/lib/test-cpu-budgets.json'), 'utf8'));
  for (const [group, keys] of [
    ['unitSuites', ['plain', 'fastPlain', 'covered', 'fastCovered']],
    ['integrationSuites', ['plainCi', 'coveredCi', 'local', 'all']],
  ]) {
    for (const key of keys) positiveCpuBudget(policy[group]?.[key], `${group}.${key}`);
  }
  positiveCpuBudget(policy.integrationCases?.defaultMs, 'integrationCases.defaultMs');
  for (const profile of ['plain', 'covered']) {
    if (!policy.integrationCases[profile] || typeof policy.integrationCases[profile] !== 'object') {
      throw new Error(`missing integration CPU profile: ${profile}`);
    }
    for (const [file, value] of Object.entries(policy.integrationCases[profile])) {
      if (!/\.test\.(?:ts|js)$/.test(file)) throw new Error(`invalid integration CPU file identity: ${file}`);
      positiveCpuBudget(value, `${profile}.${file}`);
    }
  }
  return policy;
}

export function suiteCpuBudget(policy, { integration, ci, local, fast, covered, env = process.env }) {
  const group = integration ? policy.integrationSuites : policy.unitSuites;
  const profile = integration ? ci ? covered ? 'coveredCi' : 'plainCi' : local ? 'local' : 'all'
    : fast ? covered ? 'fastCovered' : 'fastPlain' : covered ? 'covered' : 'plain';
  const override = env[integration ? 'PARALLIX_INTEGRATION_SUITE_CPU_BUDGET_MS' : 'PARALLIX_UNIT_TEST_CPU_BUDGET_MS'];
  return positiveCpuBudget(override === undefined ? group[profile] : override, `${integration ? 'integration' : 'unit'} suite`);
}
