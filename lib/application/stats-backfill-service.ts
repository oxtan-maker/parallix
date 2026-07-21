import type { ApplicationOutcome, Cancellation, Capability } from './contracts.js';
import { failure, rejected } from './contracts.js';
import type { ProgressPort, StatsBackfillPort, StatsProjection } from './ports.js';

export interface StatsBackfillRequest {
  readonly operationId: string;
  readonly apply: boolean;
  readonly capabilities: ReadonlySet<Capability>;
  readonly cancellation?: Cancellation;
}

export class StatsBackfillService {
  constructor(private readonly _port: StatsBackfillPort, private readonly _progress?: ProgressPort) {}

  async execute(request: StatsBackfillRequest): Promise<ApplicationOutcome<StatsProjection>> {
    if (!request.operationId) {return rejected('validation', 'operationId is required');}
    if (request.apply && !request.capabilities.has('stats:apply')) {return rejected('capability', 'stats:apply capability is required');}
    if (request.cancellation?.requested) {return failure('cancelled', 'cancelled before reading projection');}
    this.emit(request.operationId, 1, 'read', 'reading stats projection');
    try {
      const projection = await this._port.readProjection();
      if (!request.apply) {return { status: 'completed', value: projection, durableEvidence: [] };}
      if (request.cancellation?.requested) {return failure('cancelled', 'cancelled before applying rows');}
      this.emit(request.operationId, 2, 'apply', 'applying stats rows');
      const evidence = await this._port.applyRows(projection.rows);
      return { status: 'completed', value: projection, durableEvidence: evidence };
    } catch (error) {
      return failure('unavailable', error instanceof Error ? error.message : 'stats dependency unavailable');
    }
  }

  private emit(operationId: string, sequence: number, phase: string, message: string) {
    this._progress?.({ operationId, sequence, phase, message, timestamp: new Date().toISOString() });
  }
}
