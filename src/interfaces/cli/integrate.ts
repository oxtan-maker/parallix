import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import { IntegrateCommandUseCase } from '../../application/integrate-command-use-case.js';

import { parseIntegrateArgs, type IntegrateRequest } from '../../application/integrate/support.js';

export type IntegrateCliRequest = IntegrateRequest;

/** Parse public CLI flags without consulting filesystem or adapter state. */
export function parseIntegrateCliRequest(args: string[], configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): IntegrateCliRequest {
  return parseIntegrateArgs(args, configuration);
}

export function createIntegrateCommand(useCase: IntegrateCommandUseCase) {
  return (args: string[], options: Record<string, unknown> = {}) => {
    parseIntegrateCliRequest(args, options.configuration as ParallixConfiguration | undefined);
    return useCase.execute(args, options);
  };
}
