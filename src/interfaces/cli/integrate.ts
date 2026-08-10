import { IntegrateCommandUseCase } from '../../application/integrate-command-use-case.js';

export interface IntegrateCliRequest {
  readonly explicitSlug?: string;
  readonly dryRun: boolean;
  readonly noIntegrationGates: boolean;
  readonly noGate: boolean;
  readonly realAgent: string | null;
  readonly realAgentModel: string | null;
}

/** Parse public CLI flags without consulting filesystem or adapter state. */
export function parseIntegrateCliRequest(args: string[], environment = process.env): IntegrateCliRequest {
  const positional: string[] = [];
  let dryRun = false;
  let noIntegrationGates = false;
  let noGate = false;
  let realAgent: string | null = null;
  let realAgentModel: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--real-agent' || arg === '--real-agent-model') {
      const value = args[++index];
      if (!value || value.startsWith('--')) { throw new Error(`${arg} requires a value.`); }
      if (arg === '--real-agent') { if (realAgent) { throw new Error('--real-agent may be supplied only once.'); } realAgent = value; }
      else { if (realAgentModel) { throw new Error('--real-agent-model may be supplied only once.'); } realAgentModel = value; }
    } else if (arg === '--dry-run') { dryRun = true; }
    else if (arg === '--no-integration-gates') { noIntegrationGates = true; }
    else if (arg === '--no-gate') { noGate = true; }
    else if (arg.startsWith('--')) { throw new Error(`Unknown integrate option: ${arg}`); }
    else { positional.push(arg); }
  }
  if ((realAgent === null) !== (realAgentModel === null)) { throw new Error('--real-agent and --real-agent-model must be supplied together.'); }
  if (realAgent !== null && realAgent !== 'codex') { throw new Error(`Unsupported real agent "${realAgent}". Supported value: codex.`); }
  if (realAgentModel !== null && realAgentModel !== 'gpt-5.6-luna') { throw new Error(`Unsupported Codex real-agent model "${realAgentModel}". Supported value: gpt-5.6-luna.`); }
  if (noIntegrationGates && environment.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS !== '1') { throw new Error('--no-integration-gates is rejected: final integration gates are mandatory.'); }
  return { explicitSlug: positional[0], dryRun, noIntegrationGates, noGate, realAgent, realAgentModel };
}

export function createIntegrateCommand(useCase: IntegrateCommandUseCase) {
  return (args: string[], options: Record<string, unknown> = {}) => {
    parseIntegrateCliRequest(args);
    return useCase.execute(args, options);
  };
}
