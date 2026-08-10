import * as fmt from '../../application/presentation/cli-format.js';
import { DraftCommandUseCase } from '../../application/draft-command-use-case.js';

export interface DraftCliRequest {
  readonly explicitInput?: string;
  readonly agent?: string;
}

/** Parse public CLI flags without consulting filesystem or adapter state. */
export function parseDraftCliRequest(args: string[]): DraftCliRequest {
  const positional: string[] = [];
  let agent: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--agent') {
      const value = args[++index];
      if (!value || value.startsWith('--')) {
        throw new Error('--agent requires a value.');
      }
      if (agent) {
        throw new Error('--agent may be supplied only once.');
      }
      agent = value;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown draft option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  return { explicitInput: positional[0], agent };
}

/** Map a parse error to the draft CLI's established diagnostic format. */
function formatParseError(error: Error): string {
  const msg = error.message;
  if (msg === '--agent requires a value.') {
    return fmt.status('FAIL', 'Missing value for --agent. Usage: px draft <slug> --agent <family>');
  }
  if (msg === '--agent may be supplied only once.') {
    return fmt.status('FAIL', '--agent may be supplied only once.');
  }
  // Unknown option or other parse error
  return fmt.status('FAIL', msg);
}

export function createDraftCommand(useCase: DraftCommandUseCase) {
  return (args: string[], options: Record<string, unknown> = {}) => {
    const errorFn = (options.errorFn || fmt.log.plainError) as (_msg: string) => void;
    const exitFn = (options.exitFn || process.exit) as (_code?: number) => never;

    try {
      parseDraftCliRequest(args);
    } catch (error) {
      errorFn(formatParseError(error as Error));
      exitFn(1);
      return;
    }

    return useCase.execute(args, options);
  };
}
