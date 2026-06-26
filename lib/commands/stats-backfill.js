const fs = require('fs');
const path = require('path');

const fmt = require('../core/fmt');
const stats = require('./stats');
const gitLib = require('../core/git');
const {
  getTaskFrontmatterValue,
  getTaskStatus,
  resolveTaskFile,
} = require('../tools/backlog');
const { findMissionDir } = require('../core/mission-utils');

function hasCheckpointFiles(missionDir) {
  if (!missionDir || !fs.existsSync(missionDir)) return false;
  return fs.readdirSync(missionDir).some(file => /^CP-\d+\.md$/i.test(file) || /^CHECKPOINT_FINAL\.md$/i.test(file));
}

function listHistoricalMissionSlugs(rootDir = process.cwd()) {
  const missionsRoot = path.join(rootDir, 'docs', 'missions');
  if (!fs.existsSync(missionsRoot)) return [];

  const slugs = [];
  for (const year of fs.readdirSync(missionsRoot).sort()) {
    const yearDir = path.join(missionsRoot, year);
    if (!/^\d{4}$/.test(year) || !fs.statSync(yearDir).isDirectory()) continue;
    for (const slug of fs.readdirSync(yearDir).sort()) {
      if (!/^task-\d+/i.test(slug)) continue;
      const missionDir = path.join(yearDir, slug);
      if (!fs.statSync(missionDir).isDirectory()) continue;
      if (!hasCheckpointFiles(missionDir)) continue;
      slugs.push(slug);
    }
  }
  return slugs;
}

function extractDateOnly(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function normalizeHistoricalImplementer(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (/(^|[^a-z])codex([^a-z]|$)/.test(normalized)) return 'codex';
  if (/(^|[^a-z])claude([^a-z]|$)/.test(normalized)) return 'claude';
  if (/(^|[^a-z])gemini([^a-z]|$)/.test(normalized)) return 'gemini';
  if (/(^|[^a-z])custom([^a-z]|$)/.test(normalized)) return 'custom';
  if (/(^|[^a-z])mistral([^a-z]|$)/.test(normalized)) return 'mistral';
  if (/(^|[^a-z])magnus([^a-z]|$)/.test(normalized)) return 'magnus';
  if (/(^|[^a-z])human([^a-z]|$)/.test(normalized)) return 'human';
  return null;
}

function deriveImplementerFromGitHistory(slug, taskFile, rootDir = process.cwd()) {
  const missionDir = findMissionDir(slug, rootDir);
  const targets = [missionDir, taskFile].filter(Boolean);
  if (targets.length === 0) return null;

  const result = gitLib.git(['-C', rootDir, 'log', '--all', '--format=%an|%ae', '--', ...targets]);
  if (result.status !== 0) return null;

  const authors = result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [name = '', email = ''] = line.split('|');
      return normalizeHistoricalImplementer(email) || normalizeHistoricalImplementer(name);
    })
    .filter(Boolean);

  if (authors.length === 0) return null;
  const uniqueAuthors = [...new Set(authors)];
  return uniqueAuthors.length === 1 ? uniqueAuthors[0] : uniqueAuthors[0];
}

function deriveDateFromGitHistory(slug, taskFile, rootDir = process.cwd()) {
  const missionDir = findMissionDir(slug, rootDir);
  const targets = [missionDir, taskFile].filter(Boolean);
  if (targets.length === 0) return null;

  const result = gitLib.git(['-C', rootDir, 'log', '--all', '-1', '--format=%cs', '--', ...targets]);
  if (result.status !== 0) return null;
  return extractDateOnly(result.stdout.trim());
}

function inferHistoricalClassificationFromMissionDoc(slug, rootDir = process.cwd()) {
  const missionDir = findMissionDir(slug, rootDir);
  if (!missionDir) return null;

  const missionFile = path.join(missionDir, 'MISSION.md');
  if (!fs.existsSync(missionFile)) return null;
  const text = fs.readFileSync(missionFile, 'utf8').toLowerCase();

  const productSurfacePatterns = [
    /web-client\//g,
    /\bios\b/g,
    /\bandroid\b/g,
    /\bwearos\b/g,
    /\bauth-server\b/g,
    /\bserver\/src\b/g,
    /\bgrocer(?:y|ies)\b/g,
    /\bboard\b/g,
    /\bdelta\b/g,
    /\bsync\b/g,
    /\bprice\b/g,
    /\bstore\b/g,
    /\bshopping\b/g,
    /\bui\b/g,
    /\bclient\b/g,
    /\bcheapest\b/g,
  ];
  const workflowPatterns = [
    /workflow\//g,
    /node parallix\/index\.js/g,
    /\bworkflow\b/g,
    /\bagent\b/g,
    /\bbacklog\b/g,
    /\bforgejo\b/g,
    /\breview loop\b/g,
    /\breview\b/g,
    /\bdraft\b/g,
    /\bintegrate\b/g,
    /\brebase\b/g,
    /\bcheckpoint\b/g,
    /\bprompt\b/g,
    /\bstats\b/g,
    /\bworktree\b/g,
    /\bcli\b/g,
    /\bgit\b/g,
    /\bcoverage\b/g,
    /\bverification\b/g,
  ];

  const score = patterns => patterns.reduce((sum, pattern) => sum + ((text.match(pattern) || []).length), 0);
  const productScore = score(productSurfacePatterns);
  const workflowScore = score(workflowPatterns);

  if (productScore === 0 && workflowScore === 0) return null;
  if (workflowScore >= productScore + 2) return 'ai_sdlc';
  if (productScore >= workflowScore + 2) return 'user_value';

  const titleLine = text.split('\n')[0] || '';
  if (/\bworkflow|agent|forgejo|backlog|review|rebase|checkpoint|stats|cli\b/.test(titleLine)) {
    return 'ai_sdlc';
  }
  if (/\bweb client|web-client|ios|android|grocer|board|delta|sync|store|price\b/.test(titleLine)) {
    return 'user_value';
  }

  return null;
}

function resolveHistoricalClassification(slug, taskFile, rootDir = process.cwd()) {
  const resolution = stats.resolveMissionClassification(slug, rootDir);
  if (resolution.classification) {
    return { value: resolution.classification, source: 'backlog-label' };
  }
  // Classification missing or invalid — fall through to fallbacks.
  const legacy = stats._internals.normalizeClassification(getTaskFrontmatterValue(taskFile, 'classification'));
  if (legacy) {
    return { value: legacy, source: 'backlog-classification' };
  }
  const inferred = inferHistoricalClassificationFromMissionDoc(slug, rootDir);
  if (inferred) {
    return { value: inferred, source: 'mission-doc-heuristic' };
  }
  return { value: null, source: null };
}

function collectHistoricalStatsBackfill(rootDir = process.cwd(), filePath = null) {
  filePath = filePath || stats.resolveStatsPath();
  const repoName = stats.resolveStatsRepoName(rootDir);
  const existingMissions = new Set(
    stats.loadStatsCsv(filePath, { rootDir }).rows
      .filter(row => String(row.repo || '').trim() === repoName)
      .map(row => row.mission)
  );
  const rows = [];
  const unresolved = [];
  const skipped = [];

  for (const slug of listHistoricalMissionSlugs(rootDir)) {
    if (existingMissions.has(slug)) continue;

    const taskResolution = resolveTaskFile(slug, rootDir);
    if (!taskResolution.ok) {
      unresolved.push({
        slug,
        reason: 'task-resolution',
        detail: taskResolution.reason,
      });
      continue;
    }

    const taskFile = taskResolution.taskFile;
    const status = getTaskStatus(taskFile);
    if (status !== 'done') {
      skipped.push({ slug, reason: `status=${status || 'unknown'}` });
      continue;
    }

    const date = extractDateOnly(getTaskFrontmatterValue(taskFile, 'updated_date')) || deriveDateFromGitHistory(slug, taskFile, rootDir);
    const classification = resolveHistoricalClassification(slug, taskFile, rootDir);

    let implementerInfo = null;
    let implementerError = null;
    try {
      implementerInfo = stats.deriveImplementerAndFixRounds(slug, rootDir);
    } catch (error) {
      implementerError = error.message;
    }

    if (!implementerInfo?.implementer || implementerInfo.implementer === 'unknown') {
      const gitHistoryImplementer = deriveImplementerFromGitHistory(slug, taskFile, rootDir);
      if (gitHistoryImplementer) {
        implementerInfo = {
          implementer: gitHistoryImplementer,
          prFixRounds: 0,
          source: 'git-history-author',
        };
      }
    }

    if (!date || !classification.value || !implementerInfo?.implementer) {
      unresolved.push({
        slug,
        reason: 'missing-fields',
        date: date || null,
        classification: classification.value || null,
        implementer: implementerInfo?.implementer || null,
        prFixRounds: implementerInfo?.prFixRounds ?? null,
        sources: {
          classification: classification.source,
          implementer: implementerInfo?.source || null,
        },
        missing: [
          ...(!date ? ['date'] : []),
          ...(!classification.value ? ['classification'] : []),
          ...(!implementerInfo?.implementer ? ['implementer'] : []),
        ],
        detail: implementerError,
      });
      continue;
    }

    rows.push({
      date,
      repo: repoName,
      mission: slug,
      classification: classification.value,
      implementer: implementerInfo.implementer,
      pr_fix_rounds: String(implementerInfo.prFixRounds),
      sources: {
        date: 'backlog-updated_date',
        classification: classification.source,
        implementer: implementerInfo.source,
      },
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.mission.localeCompare(b.mission));
  unresolved.sort((a, b) => a.slug.localeCompare(b.slug));
  skipped.sort((a, b) => a.slug.localeCompare(b.slug));

  return { rows, unresolved, skipped };
}

function renderBackfillSummary(report) {
  const lines = [];
  lines.push(`Resolved rows: ${report.rows.length}`);
  lines.push(`Unresolved missions: ${report.unresolved.length}`);
  lines.push(`Skipped missions: ${report.skipped.length}`);
  lines.push('');

  if (report.rows.length > 0) {
    lines.push('Resolved:');
    for (const row of report.rows) {
      lines.push(`- ${row.date} ${row.mission} ${row.classification} ${row.implementer} ${row.pr_fix_rounds} [${row.sources.classification}/${row.sources.implementer}]`);
    }
    lines.push('');
  }

  if (report.unresolved.length > 0) {
    lines.push('Unresolved:');
    for (const item of report.unresolved) {
      const missing = Array.isArray(item.missing) && item.missing.length > 0 ? ` missing=${item.missing.join(',')}` : '';
      const detail = item.detail ? ` detail=${item.detail}` : '';
      lines.push(`- ${item.slug} reason=${item.reason}${missing}${detail}`);
    }
    lines.push('');
  }

  if (report.skipped.length > 0) {
    lines.push('Skipped:');
    for (const item of report.skipped) {
      lines.push(`- ${item.slug} ${item.reason}`);
    }
  }

  return lines.join('\n');
}

function applyBackfillRows(rows, filePath = null, rootDir = process.cwd()) {
  filePath = filePath || stats.resolveStatsPath({ ensureDir: true });
  let changed = 0;
  for (const row of rows) {
    const result = stats.upsertStatsRow(row, { filePath, rootDir });
    if (result.changed) changed += 1;
  }
  return changed;
}

function printUsage(log = fmt.log.plain) {
  log(`Usage: px stats-backfill [--apply] [--json] [--csv-file <path>]

Examples:
  px stats-backfill
  px stats-backfill --json
  px stats-backfill --apply

Notes:
  - This command is for historical stats recovery only.
  - With no --csv-file, reads and writes <PARALLIX_HOME>/stats.csv.
  - It uses strict workflow stats derivation for implementer/fix rounds and historical fallbacks for classification.
  - Non-done missions are skipped and unresolved missions are reported without being written.`);
}

function statsBackfill(args, options = {}) {
  const log = options.log || fmt.log.plain;
  const error = options.error || fmt.log.plainError;
  const exit = options.exit || process.exit;
  const rootDir = options.rootDir || process.cwd();

  if (args.includes('--help') || args.includes('-h')) {
    printUsage(log);
    return;
  }

  let apply = false;
  let json = false;
  let filePath = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--csv-file' && i + 1 < args.length) {
      filePath = args[i + 1];
      i += 1;
    }
  }
  filePath = filePath || stats.resolveStatsPath({ ensureDir: apply });

  const report = collectHistoricalStatsBackfill(rootDir, filePath);
  const changed = apply ? applyBackfillRows(report.rows, filePath, rootDir) : 0;
  const payload = {
    resolved: report.rows.length,
    unresolved: report.unresolved.length,
    skipped: report.skipped.length,
    changed,
    rows: report.rows,
    unresolvedItems: report.unresolved,
    skippedItems: report.skipped,
  };

  if (json) {
    log(JSON.stringify(payload, null, 2));
  } else {
    log(renderBackfillSummary(report));
    if (apply) {
      log('');
      log(fmt.status('PASS', `Applied ${changed} stats rows to ${filePath}`));
    }
  }

  if (apply && report.unresolved.length > 0) {
    error(fmt.status('INFO', `${report.unresolved.length} missions remain unresolved and were not written.`));
  }
}

module.exports = statsBackfill;
module.exports.collectHistoricalStatsBackfill = collectHistoricalStatsBackfill;
module.exports.inferHistoricalClassificationFromMissionDoc = inferHistoricalClassificationFromMissionDoc;
module.exports.extractDateOnly = extractDateOnly;
