import fs from 'node:fs';

export interface IntegrationPipelineEntry {
  command: string; order?: number; run_last?: boolean; areas?: string[]; always?: boolean; enabled?: boolean;
}
export interface IntegrationPipelineConfig { gates?: Record<string, IntegrationPipelineEntry>; }

/**
 * Parse a list of files (one per line) and extract the top-level area directories
 */
/** @param {string} filesOutput */
export function parseFilesToAreas(filesOutput: string) {
  const areas = new Set<string>();
  const knownAreas = ['lib', 'server', 'auth-server', 'web-client', 'docs', 'workflow', 'android', 'kubernetes'];
  const workflowOwnedDirs = new Set(['test', 'scripts', 'config', 'prompts', 'data']);
  const workflowRootFiles = new Set([
    'px.ts',
    'px.js',
    'index.ts',
    'index.js',
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'workflow.config.json',
    'tsconfig.json',
    'tsconfig.base.json',
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs'
  ]);

  filesOutput.split('\n').forEach((file: string) => {
    file = file.trim();
    if (!file) {return;}
    if (!file.includes('/')) {
      if (workflowRootFiles.has(file)) {
        areas.add('workflow');
      }
      return;
    }
    const topDir = file.split('/')[0];
    if (knownAreas.includes(topDir)) {
      areas.add(topDir);
      return;
    }
    if (workflowOwnedDirs.has(topDir)) {
      areas.add('workflow');
    }
  });

  return Array.from(areas);
}

/**
 * @param {{gates?: Record<string, IntegrationPipelineEntry>}} config
 * @returns {{key: string, command: string, order: number, run_last: boolean, areas?: string[], always?: boolean}[]}
 */
export function orderIntegrationGates(config: IntegrationPipelineConfig) {
  const gateEntries = Object.entries(config.gates || {});
  /** @type {{key: string, command: string, order: number, run_last: boolean, areas?: string[], always?: boolean}[]} */
  const gates = gateEntries
    .map(([key, value]) => {
      /** @type {{key: string, command: string, order: number, run_last: boolean, areas?: string[], always?: boolean}} */
      let gate = {
        key,
        command: value.command,
        order: value.order || 0,
        run_last: value.run_last || false,
        ...(Array.isArray(value.areas) && value.areas.length > 0 ? { areas: value.areas } : {}),
        ...(value.always === true ? { always: true } : {})
      };
      return gate;
    })
    .filter(gate => {
      const rawGate = config.gates?.[gate.key];
      if (rawGate && rawGate.enabled === false) {
        return false;
      }
      return true;
    });

  const nonRunLast = gates.filter(g => !g.run_last).sort((a, b) => a.order - b.order);
  const runLastGates = gates.filter(g => g.run_last).sort((a, b) => a.order - b.order);
  return /** @type {{key: string, command: string, order: number, run_last: boolean, areas?: string[], always?: boolean}[]} */ ([...nonRunLast, ...runLastGates]);
}

/** @param {string} gateKey @param {string[]} changedAreas @param {string[]|undefined} gateAreas @param {boolean|undefined} always */
export function gateMatchesChangedAreas(gateKey: string, changedAreas: string[], gateAreas?: string[], always?: boolean) {
  if (always) {return true;}
  if (changedAreas.length === 0) {return true;}
  if (Array.isArray(gateAreas) && gateAreas.length > 0) {
    return gateAreas.some(area => changedAreas.includes(area));
  }
  if (changedAreas.includes(gateKey)) {return true;}
  if (gateKey === 'web-e2e') {
    return changedAreas.includes('web-client');
  }
  if (gateKey === 'workflow' || gateKey === 'custom-agent-smoke') {
    return changedAreas.includes('workflow') || changedAreas.includes('lib');
  }
  return false;
}

/**
 * Load integration pipelines config from repo-side file
 */
/** @param {{configPath?: string}} opts */
export function readIntegrationConfig(configPath: string) {
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).size) {
    return { ok: false as const, error: 'no config present' };
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content) as IntegrationPipelineConfig;
    return { ok: true as const, config };
  } catch (error: unknown) {
    return { ok: false as const, error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}
