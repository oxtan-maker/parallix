import { AUTHOR_HELP, parseMissionAuthoring } from './mission-authoring.js';
import type { MissionBriefService } from '../../application/mission-brief-service.js';
import { fail, flag, helped, output, request, unwrap } from './mission-write-support.js';

interface Services {
  readonly resolveSlug: (_explicit?: string) => string | null;
  readonly brief: Pick<MissionBriefService, 'author' | 'markSuccessCriteriaComplete'>;
}

export const MISSION_HELP = `
Usage:${AUTHOR_HELP}
  px mission mark-complete [--slug <slug>] (--criterion <n> | --all)

Mark one success criterion, by the index \`px status\` lists it with, or every
criterion complete. Review preparation requires every criterion complete and evidenced by
a verifiable Goal Check row in the final checkpoint.
`.trimStart();

export function createMissionCommand(services: Services, validateGate: (_command: string) => string | null = () => null) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, MISSION_HELP)) { return; }
    if (args[0] === 'author') {
      const fields = parseMissionAuthoring(args, validateGate);
      output(unwrap(await services.brief.author({ ...request(args, 'mission-author', services.resolveSlug), ...fields }), 'mission author'));
      return;
    }
    if (args[0] !== 'mark-complete') { fail(MISSION_HELP); }
    const index = flag(args, '--criterion'); const all = args.includes('--all');
    if (all === (index !== null)) { fail('give exactly one of --criterion <n> or --all'); }
    const criterion = all ? 'all' : Number(index);
    if (criterion !== 'all' && !/^\d+$/.test(index ?? '')) { fail(`--criterion must be a criterion number, got: ${index}`); }
    output(unwrap(await services.brief.markSuccessCriteriaComplete({ ...request(args, 'mission-mark-complete', services.resolveSlug), criterion }), 'mark-complete'));
  };
}
