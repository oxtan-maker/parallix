const fs = require('fs');
const path = require('path');
const fmt = require('../core/fmt');

const { findMissionDir, findCheckpoints, missionDirForSlug, missionBranchName } = require('../core/mission-utils');
const { resolveTaskFile, getTaskStorage } = require('./backlog');
const { readToken, postReview } = require('./forgejo');

const DEFAULT_GATEKEEPER_USER = 'forgejo-gatekeeper';

// Pre-review pushback bot. Runs after performHandoff has created/updated the
// PR and before the human/agent reviewer engages, so missing mandatory
// artifacts surface as a request-changes review instead of consuming a
// reviewer cycle. Returns { ok, missing, skipped, posted } so callers can
// surface a clear log line without needing to re-derive state.

function checkMandatoryFiles(slug, options = {}) {
  const {
    rootDir = process.cwd(),
    findMissionDirFn = findMissionDir,
    findCheckpointsFn = findCheckpoints,
    resolveTaskFileFn = resolveTaskFile
  } = options;

  const missing = [];
  const expectedMissionDir = missionDirForSlug(rootDir, slug);
  const expectedMissionRel = path.relative(rootDir, expectedMissionDir).split(path.sep).join('/');

  const missionDir = findMissionDirFn(slug, rootDir);
  const missionPath = missionDir ? path.join(missionDir, 'MISSION.md') : null;
  if (!missionPath || !fs.existsSync(missionPath)) {
    missing.push(`${expectedMissionRel}/MISSION.md`);
  }

  if (missionDir) {
    const checkpoints = findCheckpointsFn(missionDir);
    if (!checkpoints || checkpoints.length === 0) {
      missing.push(`${expectedMissionRel}/CP-*.md (at least one checkpoint document)`);
    }
  } else {
    missing.push(`${expectedMissionRel}/CP-*.md (at least one checkpoint document)`);
  }

  const taskResolution = resolveTaskFileFn(slug, rootDir);
  const missionArtifactsPresent = Boolean(missionPath && fs.existsSync(missionPath) && missionDir && findCheckpointsFn(missionDir).length > 0);
  if ((!taskResolution || !taskResolution.ok) && !missionArtifactsPresent) {
    const { tasksDir } = getTaskStorage(rootDir);
    const taskDirRel = path.relative(rootDir, tasksDir).split(path.sep).join('/');
    missing.push(`${taskDirRel}/${slug} - *.md`);
  }

  return { ok: missing.length === 0, missing };
}

function buildPushbackBody(slug, missing) {
  const bullets = missing.map(item => `- ${item}`).join('\n');
  return [
    `**Pre-review gatekeeper: missing mandatory artifacts for \`${slug}\`.**`,
    '',
    'The following files are required before a reviewer engages but were not found on this branch:',
    '',
    bullets,
    '',
    'Push the missing artifacts and re-request review. This comment is automated; once the artifacts are present the gatekeeper will not block again.'
  ].join('\n');
}

function runGatekeeper(slug, options = {}) {
  const {
    rootDir = process.cwd(),
    user = process.env.FORGEJO_GATEKEEPER_USER || DEFAULT_GATEKEEPER_USER,
    log = fmt.log.plain,
    readTokenFn = readToken,
    postReviewFn = postReview,
    checkFn = checkMandatoryFiles
  } = options;
  const branch = options.branch || missionBranchName(slug, rootDir);

  const check = checkFn(slug, { rootDir });
  if (check.ok) {
    log(fmt.status('INFO', `Gatekeeper: all mandatory artifacts present for ${fmt.slug(slug)}.`));
    return { ok: true, missing: [], skipped: false, posted: false };
  }

  const token = readTokenFn(user);
  if (!token) {
    log(fmt.status('WARN', `Gatekeeper: no Forgejo token for "${fmt.agent(user)}"; skipping pushback for ${fmt.slug(slug)}. Missing: ${check.missing.join(', ')}.`));
    return { ok: false, missing: check.missing, skipped: true, posted: false };
  }

  const body = buildPushbackBody(slug, check.missing);
  log(fmt.status('INFO', `Gatekeeper: posting request-changes pushback on ${fmt.branch(branch)} as ${fmt.agent(user)}. Missing: ${check.missing.join(', ')}.`));
  const result = postReviewFn(branch, token, 'request-changes', body);

  if (!result || !result.ok) {
    const detail = result && result.error ? result.error : 'unknown postReview failure';
    log(fmt.status('WARN', `Gatekeeper: pushback post failed for ${fmt.slug(slug)}: ${detail}.`));
    return { ok: false, missing: check.missing, skipped: false, posted: false };
  }

  return { ok: false, missing: check.missing, skipped: false, posted: true };
}

module.exports = {
  DEFAULT_GATEKEEPER_USER,
  checkMandatoryFiles,
  buildPushbackBody,
  runGatekeeper
};
