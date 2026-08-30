import { randomUUID } from 'node:crypto';
import { missionId } from '../domain/mission.js';
import type { IntegrateWorkflowPort } from './ports/cli-workflows.js';
import { NO_CURRENT_WORK_PORT, type CurrentWorkPort } from './recording/current-work-recorder.js';

/** CLI-independent application entry point for the integration workflow. */
export class IntegrateCommandUseCase {
  constructor(
    private readonly _workflow: IntegrateWorkflowPort,
    private readonly _currentWork: CurrentWorkPort = NO_CURRENT_WORK_PORT,
    private readonly _inferSlug: () => string | null = () => null,
  ) {}

  async execute(args: string[], options: Record<string, unknown> = {}): Promise<unknown> {
    const slug = args.find((arg) => !arg.startsWith('-')) ?? this._inferSlug();
    if (!slug) { return this._workflow.execute(args, options); }

    // Integration runs gates and a merge; it is long enough that a board built
    // during the run must show the mission as working rather than as waiting
    // for the operator who already started it.
    const publication = {
      missionId: missionId(slug),
      operationId: `integrate:${slug}:${randomUUID()}`,
      phase: 'integrate' as const,
      summary: `px integrate ${slug}`,
      agent: null,
    };
    await bestEffort(() => this._currentWork.running(publication));
    try {
      return await this._workflow.execute(args, options);
    } finally {
      await bestEffort(() => this._currentWork.ended(publication));
    }
  }

  /** Board entry point: the mission identity is the complete trusted input. */
  executeForSlug(slug: string): Promise<unknown> {
    return this.execute([slug], {});
  }
}

async function bestEffort(publish: () => Promise<void>): Promise<void> {
  try {
    await publish();
  } catch (error) {
    void error;
  }
}
