import type { MissionId } from '../domain/mission.js';
import type { MissionStore } from './domain-ports.js';

/** The one store capability cancellation needs: the scoped, transactional delete. */
export type MissionCancelStore = Required<Pick<MissionStore, 'cancel'>>;

export interface MissionCancelResult {
  readonly slug: string;
  /**
   * Whether the mission's task file was archived. The board projects its cards
   * from task markdown, so this — not the row delete — is what makes a
   * cancelled mission leave every lane.
   */
  readonly taskArchived: boolean;
  /**
   * The git cleanup the operator runs next. Cancellation prints it and stops:
   * no branch, worktree, remote ref or pull request is touched here.
   */
  readonly cleanupCommand: string;
}

/**
 * Cancel one mission: delete its lifecycle rows, archive its task file so the
 * card leaves every board lane, and report the advisory git cleanup. Recorded usage survives — the store's delete list never names
 * `usage_statistics`, so cost history keeps no holes.
 */
export class MissionCancelService {
  constructor(
    private readonly _store: MissionCancelStore,
    private readonly _cleanupCommandFn: (_slug: string) => string,
    /** Archives the mission's task file; the board reads task markdown, not rows. */
    private readonly _archiveTaskFn: (_slug: string) => boolean,
  ) {}

  async executeForSlug(slug: string): Promise<MissionCancelResult> {
    const cleanupCommand = this._cleanupCommandFn(slug);
    await this._store.cancel(slug as MissionId);
    // Rows first: an archived task file with live lifecycle rows would leave a
    // mission the board cannot show and the operator cannot reach.
    const taskArchived = this._archiveTaskFn(slug);
    return { slug, taskArchived, cleanupCommand };
  }
}
