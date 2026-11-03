import { observeCommandExits } from './recording/command-exits.js';
import { randomUUID } from 'node:crypto';
import { assertWorkflowControl } from './ports/mission-write-authorization.js';
import { missionId } from '../domain/mission.js';
import type { IntegrateWorkflowPort } from './ports/cli-workflows.js';
import { NO_EXECUTION_ACTIVITY, nestedWorkPublisher, type ExecutionActivityPort } from './recording/execution-activity-recorder.js';

/** CLI-independent application entry point for the integration workflow. */
export class IntegrateCommandUseCase {
  constructor(
    private readonly _workflow: IntegrateWorkflowPort,
    private readonly _currentWork: ExecutionActivityPort = NO_EXECUTION_ACTIVITY,
    private readonly _inferSlug: () => string | null = () => null,
  ) {}

  async execute(args: string[], options: Record<string, unknown> = {}): Promise<unknown> {
    assertWorkflowControl();
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
    // The repair agent and the re-review run inside this operation; they
    // publish under it so the board keeps showing live work (TASK-2620).
    const nestedWork = nestedWorkPublisher(this._currentWork, publication);
    const exits = observeCommandExits(options);
    let result: unknown;
    try {
      result = await this._workflow.execute(args, { ...options, ...exits.options, nestedWork });
    } catch (error) {
      if (exits.terminatedWith(error)) {
        const failed = exits.failure();
        if (failed === null) { await bestEffort(() => this._currentWork.ended(publication)); }
        else { await bestEffort(() => this._currentWork.blocked(publication, `${publication.summary} exited with status ${failed}`)); }
        throw error;
      }
      // A stop reason appears only when automation genuinely cannot continue.
      const reason = error instanceof Error ? error.message : 'integration cannot continue autonomously';
      await bestEffort(() => this._currentWork.blocked(publication, reason));
      throw error;
    }
    // Returning exit observers must not turn an unsuccessful workflow into success.
    const failed = exits.failure();
    if (failed !== null) {
      const error = new Error(`${publication.summary} exited with status ${failed}`);
      await bestEffort(() => this._currentWork.blocked(publication, error.message));
      throw error;
    }
    await bestEffort(() => this._currentWork.ended(publication));
    return result;
  }

  /** Board entry point: the mission identity is the complete trusted input. */
  executeForSlug(slug: string): Promise<unknown> {
    return this.execute([slug], {});
  }
}

async function bestEffort(publish: () => Promise<void>): Promise<void> {
  try {
    await publish();
  } catch {}
}
