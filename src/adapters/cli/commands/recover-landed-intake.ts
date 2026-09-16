import fs from 'node:fs';
import { git } from '../../git/git.js';
import { missionBranchName, resolveMissionBaseBranch } from '../../filesystem/mission-utils.js';
import { findTaskFile, getTaskFrontmatterValue, getTaskLabels, getTaskStatus } from '../../backlog/backlog.js';
import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';
import { missionId, missionLabels, type MissionIntake } from '../../../domain/mission.js';

/**
 * Durable proof that a mission's payload was squash-landed on its recorded base
 * branch, expressed as the intake the recovery path needs to rebuild the absent
 * Mission aggregate.
 *
 * `px integrate` lands with `git merge --squash`, so the mission branch tip is
 * never reachable from the base branch; the landing is instead recorded by the
 * squash commit's `mission/<slug>:` subject (same evidence
 * `findExistingSquashCommit` uses, but scoped to the recorded base branch
 * instead of the current HEAD). Forgejo PR state is deliberately not consulted:
 * local Git history is the only merge authority.
 *
 * Returns `null` whenever the evidence is insufficient — no completed task
 * artifact, no resolvable base branch, or no squash commit on it — so the
 * caller refuses recovery rather than inferring completion.
 */
export function landedMissionIntake(slug: string, rootDir: string): MissionIntake | null {
  const taskFile = findTaskFile(slug, rootDir);
  if (!taskFile || !fs.existsSync(taskFile)) {return null;}
  const status = getTaskStatus(taskFile);
  if (!status || !/^(done|completed)$/i.test(String(status).trim())) {return null;}

  const base = resolveMissionBaseBranch(slug, rootDir);
  if (!base) {return null;}
  const baseRef = git(['-C', rootDir, 'rev-parse', '--verify', `${base}^{commit}`]);
  if (baseRef.status !== 0) {return null;}

  const prefix = `${missionBranchName(slug, rootDir)}:`;
  const log = git(['-C', rootDir, 'log', base, '--format=%s', '-200']);
  if (log.status !== 0) {return null;}
  const landed = log.stdout.split('\n').some(subject => subject.startsWith(prefix));
  if (!landed) {return null;}

  return {
    id: missionId(slug.toLowerCase()),
    repositoryId: resolveCanonicalRepositoryId(rootDir),
    title: String(getTaskFrontmatterValue(taskFile, 'title') ?? slug).trim() || slug,
    labels: missionLabels(getTaskLabels(taskFile) ?? []),
    rawStatus: String(status),
  };
}
