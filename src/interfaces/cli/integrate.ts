import { IntegrateCommandUseCase } from '../../application/integrate-command-use-case.js';

import { parseIntegrateArgs, type IntegrateRequest } from '../../application/integrate/support.js';

export type IntegrateCliRequest = IntegrateRequest;

/** Parse public CLI flags without consulting filesystem or adapter state. */
export function parseIntegrateCliRequest(args: string[], environment = process.env): IntegrateCliRequest {
  return parseIntegrateArgs(args, environment);
}

export function createIntegrateCommand(useCase: IntegrateCommandUseCase) {
  return (args: string[], options: Record<string, unknown> = {}) => {
    parseIntegrateCliRequest(args);
    return useCase.execute(args, options);
  };
}
