import type { ApplicationOutcome, Cancellation, Capability } from './contracts.js';
import { failure, rejected } from './contracts.js';
import type { ActivePort, ProgressPort } from './ports.js';

export interface ActiveRequest {
  readonly operationId: string;
  readonly slug: string;
  readonly agent?: string | null;
  readonly capabilities: ReadonlySet<Capability>;
  readonly cancellation?: Cancellation;
}

export interface ActiveResult {
  readonly agent: string;
}

export class ActiveService {
  constructor(private readonly _port: ActivePort, private readonly _progress?: ProgressPort) {}

  async execute(request: ActiveRequest): Promise<ApplicationOutcome<ActiveResult>> {
    if (!request.operationId || !request.slug) {return rejected('validation', 'operationId and slug are required');}
    if (!request.capabilities.has('active:execute')) {return rejected('capability', 'active:execute capability is required');}
    if (request.cancellation?.requested) {return failure('cancelled', 'cancelled before launch');}
    const validationError = await this._port.validateSlug(request.slug);
    if (validationError) {return rejected('validation', validationError);}
    this.emit(request, 1, 'launch', 'launching execute agent');
    try {
      const launched = await this._port.launch(request.slug, request.agent);
      const evidence = [launched.evidence];
      this.emit(request, 2, 'record', 'recording durable launch evidence');
      evidence.push(await this._port.recordLaunch(request.slug, launched.agent));
      if (request.cancellation?.requested) {return failure('cancelled', 'cancelled after durable launch; re-query task state', evidence);}
      this.emit(request, 3, 'handoff', 'starting handoff', launched.agent);
      await this._port.handoff(request.slug, launched.agent);
      return { status: 'completed', value: { agent: launched.agent }, durableEvidence: evidence };
    } catch (error) {
      return failure('execution', error instanceof Error ? error.message : 'active execution failed');
    }
  }

  private emit(request: ActiveRequest, sequence: number, phase: string, message: string, agent?: string) {
    this._progress?.({ operationId: request.operationId, sequence, phase, message, timestamp: new Date().toISOString(), agent });
  }
}
