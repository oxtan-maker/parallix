import * as fs from 'node:fs';
import path from 'node:path';
import { loadAdapterConfig } from '../config/product-config.js';
import * as gitModule from '../git/git.js';

/** @param {string} prefix */
function normalizeBranchPrefix(prefix: string): string {
  if (typeof prefix !== 'string' || !prefix.trim()) {
    return 'mission/';
  }
  return prefix.endsWith('/') ? prefix : prefix + '/';
}

export function missionAdapterDefaults() {
  return {
    baseDir: 'missions',
    branchPrefix: 'mission/',
    worktreePattern: '../<repo>-<slug>',
  };
}

export function resolveMissionAdapter(rootDir: string = process.cwd()) {
  const adapters = loadAdapterConfig(rootDir);
  const missions = (adapters.missions as Record<string, unknown>) || {};
  const defaults = missionAdapterDefaults();
  return {
    baseDir: typeof missions.baseDir === 'string' && missions.baseDir.trim()
      ? missions.baseDir
      : defaults.baseDir,
    branchPrefix: normalizeBranchPrefix(missions.branchPrefix as string || defaults.branchPrefix),
    worktreePattern: typeof missions.worktreePattern === 'string' && missions.worktreePattern.trim()
      ? missions.worktreePattern
      : defaults.worktreePattern,
  };
}

export function missionBaseDir(rootDir: string = process.cwd()): string {
  return path.resolve(rootDir, resolveMissionAdapter(rootDir).baseDir);
}

export function missionUsesYearTier(rootDir: string = process.cwd()): boolean {
  return resolveMissionAdapter(rootDir).baseDir !== missionAdapterDefaults().baseDir;
}

export function missionBranchPrefix(rootDir: string = process.cwd()): string {
  return resolveMissionAdapter(rootDir).branchPrefix;
}

/** @param {string} slug @param {string} [rootDir] */
export function missionBranchName(slug: string, rootDir: string = process.cwd()): string {
  return missionBranchPrefix(rootDir) + slug;
}

/** @param {string} slug @param {string} [rootDir] */
export function missionBranchRef(slug: string, rootDir: string = process.cwd()): string {
  return 'refs/heads/' + missionBranchName(slug, rootDir);
}

/** @param {unknown} value */
export function isMissionSlugCandidate(value: unknown): boolean {
  return typeof value === 'string' && /^(task|adhoc)-[a-z0-9][a-z0-9.-]*$/i.test(value.trim());
}

/** @param {string} branch @param {string} [rootDir] */
export function extractSlugFromBranch(branch: string, rootDir: string = process.cwd()): string | null {
  const prefix = missionBranchPrefix(rootDir);
  if (!branch || !branch.startsWith(prefix)) {return null;}
  return branch.slice(prefix.length).toLowerCase();
}

/** @param {string|undefined} [slug] @param {string} [rootDir] */
export function getMissionYear(slug: string | undefined = undefined, rootDir: string = process.cwd()): string {
  if (process.env.MISSION_YEAR_OVERRIDE) {
    return process.env.MISSION_YEAR_OVERRIDE;
  }

  const hasExplicitConfig = fs.existsSync(path.join(rootDir, 'workflow.config.json'));
  if (slug && (missionUsesYearTier(rootDir) || (!hasExplicitConfig && fs.existsSync(path.join(rootDir, 'docs', 'missions'))))) {
    const baseDir = missionUsesYearTier(rootDir)
      ? missionBaseDir(rootDir)
      : path.join(rootDir, 'docs', 'missions');
    if (fs.existsSync(baseDir)) {
      try {
        const stat = fs.statSync(baseDir);
        if (!stat.isDirectory()) {
          return new Date().getFullYear().toString();
        }
      } catch (_) {
        return new Date().getFullYear().toString();
      }
      const years = fs.readdirSync(baseDir)
        .filter(d => /^\d{4}$/.test(d))
        .sort((a: string, b: string) => b.localeCompare(a));

      const slugStr = slug;
      const candidateSlugs = [slugStr.toLowerCase()];
      const baseTaskMatch = slugStr.match(/^(task-\d+)/i);
      if (baseTaskMatch) {
        candidateSlugs.push(baseTaskMatch[1].toLowerCase());
      }

      for (const year of years) {
        for (const s of candidateSlugs) {
          const missionDir = path.join(baseDir, year, s);
          if (fs.existsSync(missionDir)) {
            return year;
          }
        }
      }
    }
  }

  return new Date().getFullYear().toString();
}

/** @param {string} rootDir @param {string} slug */
export function missionDirForSlug(rootDir: string, slug: string): string {
  const parts: string[] = [missionBaseDir(rootDir)];
  if (missionUsesYearTier(rootDir)) {
    parts.push(getMissionYear(slug, rootDir));
  }
  parts.push(slug);
  return path.join(...parts);
}

/** @param {string} rootDir @param {string} slug */
export function missionPathForSlug(rootDir: string, slug: string): string {
  return path.join(missionDirForSlug(rootDir, slug), 'MISSION.md');
}

/** @param {string} slug @param {string} [rootDir] @param {{missionPath?: string}} options */
export function findMissionDir(slug: string, rootDir: string = process.cwd(), options: { missionPath?: string } = {}): string | null {
  const opts = options;
  if (opts.missionPath && fs.existsSync(opts.missionPath)) {
    return fs.statSync(opts.missionPath).isDirectory() ? opts.missionPath : path.dirname(opts.missionPath);
  }
  if (!slug) {return null;}
  const missionDir = missionDirForSlug(rootDir, slug);
  if (fs.existsSync(missionDir)) {return missionDir;}

  const baseTaskMatch = slug.match(/^(task-\d+)/i);
  if (baseTaskMatch) {
    const baseSlug = baseTaskMatch[1].toLowerCase();
    const baseMissionDir = missionDirForSlug(rootDir, baseSlug);
    if (fs.existsSync(baseMissionDir)) {return baseMissionDir;}
  }

  const legacyBaseDir = path.join(rootDir, 'docs', 'missions');
  if (!missionUsesYearTier(rootDir) && !fs.existsSync(path.join(rootDir, 'workflow.config.json')) && fs.existsSync(legacyBaseDir)) {
    const year = getMissionYear(slug, rootDir);
    const legacyMissionDir = path.join(legacyBaseDir, year, slug);
    if (fs.existsSync(legacyMissionDir)) {return legacyMissionDir;}
    if (baseTaskMatch) {
      const legacyBaseMissionDir = path.join(legacyBaseDir, year, baseTaskMatch[1].toLowerCase());
      if (fs.existsSync(legacyBaseMissionDir)) {return legacyBaseMissionDir;}
    }
  }

  return null;
}

/**
 * Infer mission slug from current context:
 * 1. Explicit slugCandidate (task-NNN)
 * 2. Current branch (mission/slug)
 * 3. Current directory name (mission-task-slug)
 * 4. Registered worktree branch for current directory
 *
 * @param {string} [slugCandidate]
 * @returns {string|null}
 */
/** @param {string} [slugCandidate] */
export function inferSlug(slugCandidate: string | undefined): string | null {
  if (slugCandidate && isMissionSlugCandidate(slugCandidate)) {
    return slugCandidate.toLowerCase();
  }

  // 1. Check branch
  try {
    const branch = gitModule.getCurrentBranch();
    const fromBranch = extractSlugFromBranch(branch);
    if (fromBranch) {return fromBranch;}
  } catch (_) {
    // ignore
  }

  // 3. Check directory name
  const cwd = process.cwd();
  const dirName = path.basename(cwd);
  const dirSlugMatch = dirName.match(/((?:task|adhoc)-[a-z0-9][a-z0-9.-]*)$/i);
  if (dirSlugMatch) {
    return dirSlugMatch[1].toLowerCase();
  }


  // 3. Check worktree registry
  try {
    const lines = gitModule.git(['worktree', 'list', '--porcelain']).stdout.split('\n');
    let currentPath: string | null = null;
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentPath = line.slice('worktree '.length).trim();
      } else if (line.startsWith('branch ') && currentPath === cwd) {
        const branch = line.slice('branch '.length).trim();
        const shortBranch = branch.replace(/^refs\/heads\//, '');
        const fromBranch = extractSlugFromBranch(shortBranch, cwd);
        if (fromBranch) {return fromBranch;}
      } else if (line === '') {
        currentPath = null;
      }
    }
  } catch (_) {
    // ignore
  }

  return null;
}

/** @param {string} missionDir */
export function findCheckpoints(missionDir: string): string[] {
  const files = fs.readdirSync(missionDir);
  return files
    .filter(f => /^(CHECKPOINT_|CP-\d+).*\.md$/i.test(f))
    .sort(compareCheckpointFiles)
    .map(f => path.join(missionDir, f));
}

/** @param {string} a @param {string} b */
export function compareCheckpointFiles(a: string, b: string): number {
  const aOrder = checkpointOrder(a);
  const bOrder = checkpointOrder(b);

  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  return a.localeCompare(b);
}

/** @param {string} filename */
export function checkpointOrder(filename: string): number {
  const numericMatch = filename.match(/(?:CP-|CHECKPOINT_)(\d+)/i);
  if (numericMatch) {
    return Number(numericMatch[1]);
  }

  return Number.MAX_SAFE_INTEGER;
}

/** @param {string} filePath */
export function getFirstLine(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split('\n')[0].replace(/^#+\s*/, '').trim();
}

/** @param {string} missionDir */
export function readMissionFile(missionDir: string): string {
  return fs.readFileSync(path.join(missionDir, 'MISSION.md'), 'utf8');
}

/** @param {string} [slug] */
export function missionTitle(slug: string | undefined): string | null {
  if (!slug) {return null;}
  const missionDir = findMissionDir(slug);
  if (!missionDir) {return null;}

  const missionPath = path.join(missionDir, 'MISSION.md');
  if (!fs.existsSync(missionPath)) {return null;}

  const firstLine = fs.readFileSync(missionPath, 'utf8').split('\n')[0] || '';
  return firstLine.replace(/^#\s*Mission:\s*/i, '').trim() || null;
}

export const SUPPORTED_VERIFY_AREAS = new Set(['docs', 'workflow', 'web', 'server', 'auth', 'android', 'k8s', 'deps', 'all']);

/** @param {string} [area] */
export function normalizeVerifyArea(area: string | undefined): string {
  if (!area) {return 'docs';}
  if (area === 'auth-server') {return 'auth';}
  return SUPPORTED_VERIFY_AREAS.has(area) ? area : area;
}

/** @param {string} content */
export function detectMissionAreaFromContent(content: string): string {
  const gateMatch = content.match(
    /(?:^|\s)(?:\.{1,2}\/[\w.\/-]+\.(?:sh|bash|py|rb)|\.{1,2}\/[a-z][\w-]*)\s+([a-zA-Z0-9_-]+)\s*(?:$|\n)/m
  );
  return normalizeVerifyArea(gateMatch ? gateMatch[1] : 'docs');
}

export function findMissionArea(missionDir: string): string {
  const missionPath = path.join(missionDir, 'MISSION.md');
  if (!fs.existsSync(missionPath)) {return 'docs';}

  const content = fs.readFileSync(missionPath, 'utf8');
  return detectMissionAreaFromContent(content);
}
