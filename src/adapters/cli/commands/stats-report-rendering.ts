// Markdown/table report rendering for `px stats` (extracted from stats.ts, task-2369.02).
//
// Leaf module: it must never import `./stats.js`. stats.ts imports these symbols
// and re-exports them, so a back-import would close an import cycle.

import * as fmt from '../../../application/presentation/cli-format.js';
import * as statsReport from './stats-report.js';
import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';
import {
  summarizeCompletedMissionWindow,
  statisticsMissionKey,
  statisticsRowInWindow,
} from '../../../application/services/statistics-service.js';
import {
  parseBooleanish, normalizeRow, normalizeRows, statsMissionKey, modelBelongsToImplFamily,
  isValidClassification, normalizeClassification, rowInWindow,
} from './stats-normalization.js';

// Core single-mission renderer from stats-report.ts (task-2217)
const { renderMissionPhaseReport: _renderMissionPhaseReport } = statsReport;

// @ts-nocheck
/**
 * @param {string} dateStr
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function formatDate(dateStr) {
  if (!dateStr) {return '';}
  try {
    const date = new Date(dateStr);
    return date.toISOString().split('T')[0];
  } catch (/** @type{any} */ _err) {
    return dateStr;
  }
}

/**
 * @param {StatsRow[]} rows
 * @param {string} field
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function groupBy(rows, field) {
  /** @type {Record<string, StatsRow[]>} */
  const groups = {};
  for (const row of rows) {
    const key = String(row[field] || 'unknown');
// @ts-ignore -- retained reporting helper is dynamically typed
    if (!groups[key]) {groups[key] = [];}
// @ts-ignore -- retained reporting helper is dynamically typed
    groups[key].push(row);
  }
  return groups;
}

/**
 * @param {StatsRow[]} group
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function computeImplStats(group) {
  const total = group.length;
// @ts-ignore -- retained reporting helper is dynamically typed
  const merged = group.filter(row => row.isMerged).length;
// @ts-ignore -- retained reporting helper is dynamically typed
  const totalReviews = group.reduce((sum, row) => sum + (Number.parseInt(String(row.review_count || ''), 10) || 0), 0);
  const avgReviews = total > 0 ? (totalReviews / total).toFixed(2) : '0.00';
// @ts-ignore -- retained reporting helper is dynamically typed
  const reviewRounds = group.reduce((sum, row) => sum + Math.max(1, Number.parseInt(String(row.review_count || ''), 10) || 0), 0);
  const avgRounds = total > 0 ? (reviewRounds / total).toFixed(2) : '0.00';
  return { total, merged, totalReviews, avgReviews, reviewRounds, avgRounds };
}

/**
 * @param {StatsRow[]} group
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function computePeriodStats(group) {
// @ts-ignore -- retained reporting helper is dynamically typed
  const dates = group.map(row => formatDate(String(row.normalizedDate))).filter(Boolean);
  if (dates.length === 0) {return null;}
  const sorted = dates.sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = new Date(first);
  const end = new Date(last);
  const days = Math.max(1, Math.ceil((Number(end) - Number(start)) / (1000 * 60 * 60 * 24)) + 1);
  const total = group.length;
// @ts-ignore -- retained reporting helper is dynamically typed
  const merged = group.filter(row => row.isMerged).length;
  const open = total - merged;
// @ts-ignore -- retained reporting helper is dynamically typed
  const totalReviews = group.reduce((sum, row) => sum + (Number.parseInt(String(row.review_count || ''), 10) || 0), 0);
  const avgReviews = total > 0 ? (totalReviews / total).toFixed(2) : '0.00';
  return { period: `${first} → ${last}`, days, total, merged, open, totalReviews, avgReviews };
}

/**
 * @param {{headers: string[], rows: StatsRow[]}} data
 * @param {StatsOptions} options
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function generateMarkdownReport(data, options = {}) {
  const rows = normalizeRows(data.rows);
// @ts-ignore -- retained reporting helper is dynamically typed
  const groupByField = options.groupBy;

  if (rows.length === 0) {
    return 'No data to report.';
  }

  const lines = [];
  lines.push('# Forgejo Stats Report\n');
  lines.push(`Generated: ${new Date().toISOString().split('T')[0]}\n`);
  lines.push(`Total PRs analyzed: ${rows.length}\n`);

// @ts-ignore -- retained reporting helper is dynamically typed
  const overallMerged = rows.filter(row => row.isMerged).length;
  const overallOpen = rows.length - overallMerged;
// @ts-ignore -- retained reporting helper is dynamically typed
  const overallReviews = rows.reduce((sum, row) => sum + (Number.parseInt(row.review_count || '', 10) || 0), 0);
  lines.push('## Overall Summary\n');
  lines.push(`- **Total PRs:** ${rows.length}`);
  lines.push(`- **Merged:** ${overallMerged}`);
  lines.push(`- **Open/Closed:** ${overallOpen}`);
  lines.push(`- **Total Reviews Submitted:** ${overallReviews}`);
  lines.push(`- **Avg Reviews/PR:** ${(overallReviews / rows.length).toFixed(2)}`);
  lines.push('');

  lines.push('## Per-PR Detail\n');
  lines.push('| Mission | Implementer | Reviewer | Reviews | Merged | Created |');
  lines.push('|---------|-------------|----------|---------|--------|---------|');
  const sorted = [...rows].sort((a, b) => String(a.normalizedDate || '').localeCompare(String(b.normalizedDate || '')));
  for (const row of sorted) {
    lines.push(`| ${/** @type {any} */ (row).mission} | ${/** @type {any} */ (row).implementer} | ${/** @type {any} */ (row).reviewer} | ${row.review_count} | ${row.normalizedMerged} | ${formatDate(String(row.normalizedDate))} |`);
  }
  lines.push('');

  if (groupByField === 'implementer') {
    const groups = groupBy(rows, 'implementer');
    lines.push('## By Implementer\n');
    lines.push('| Agent | PRs | Merged | Open | Total Reviews | Avg Reviews/PR | Avg Review Rounds |');
    lines.push('|-------|-----|--------|------|---------------|----------------|-------------------|');
    const implData = Object.entries(groups)
      .map(([implementer, group]) => {
        const stats = computeImplStats(group);
        return {
          implementer,
          prs: stats.total,
          merged: stats.merged,
// @ts-ignore -- retained reporting helper is dynamically typed
          open: group.filter(row => !row.isMerged).length,
          totalReviews: stats.totalReviews,
          avgReviews: stats.avgReviews,
          avgRounds: stats.avgRounds,
        };
      })
      .sort((a, b) => b.prs - a.prs);
    for (const row of implData) {
      lines.push(`| ${row.implementer} | ${row.prs} | ${row.merged} | ${row.open} | ${row.totalReviews} | ${row.avgReviews} | ${row.avgRounds} |`);
    }
    lines.push('');
  } else if (groupByField === 'period') {
    const groups = {};
    for (const row of rows) {
      const date = formatDate(String(row.normalizedDate));
      if (!date) {continue;}
      const month = date.substring(0, 7);
// @ts-ignore -- retained reporting helper is dynamically typed
      if (!/** @type {any} */ (groups)[month]) {/** @type {any} */ (groups)[month] = [];}
// @ts-ignore -- retained reporting helper is dynamically typed
      /** @type {any} */ (groups)[month].push(row);
    }
    lines.push('## By Period (Month)\n');
    lines.push('| Period | Days | PRs | Merged | Open | Total Reviews | Avg Reviews/PR |');
    lines.push('|--------|------|-----|--------|------|---------------|----------------|');
    for (const month of Object.keys(groups).sort()) {
// @ts-ignore -- retained reporting helper is dynamically typed
      const period = computePeriodStats(/** @type{StatsRow[]} */(/** @type {any} */ (groups)[month]));
      if (period) {
        lines.push(`| ${period.period} | ${period.days} | ${period.total} | ${period.merged} | ${period.open} | ${period.totalReviews} | ${period.avgReviews} |`);
      }
    }
    lines.push('');
  } else if (groupByField === 'merged') {
// @ts-ignore -- retained reporting helper is dynamically typed
    const mergedRows = rows.filter(row => row.isMerged);
// @ts-ignore -- retained reporting helper is dynamically typed
    const unmergedRows = rows.filter(row => !row.isMerged);
    lines.push('## Merged vs Unmerged\n');
    lines.push('### Merged PRs\n');
    if (mergedRows.length > 0) {
      lines.push('| Mission | Implementer | Reviews | Reviewer | Created |');
      lines.push('|---------|-------------|---------|----------|---------|');
// @ts-ignore -- retained reporting helper is dynamically typed
      for (const row of mergedRows.sort((a, b) => String(a.normalizedDate || '').localeCompare(String(b.normalizedDate || '')))) {
        lines.push(`| ${/** @type {any} */ (row).mission} | ${/** @type {any} */ (row).implementer} | ${row.review_count} | ${/** @type {any} */ (row).reviewer} | ${formatDate(String(row.normalizedDate))} |`);
      }
    } else {
      lines.push('None.');
    }
    lines.push('');
    lines.push('### Unmerged/Closed PRs\n');
    if (unmergedRows.length > 0) {
      lines.push('|---------|-------------|---------|----------|---------|');
// @ts-ignore -- retained reporting helper is dynamically typed
      for (const row of unmergedRows.sort((a, b) => String(a.normalizedDate || '').localeCompare(String(b.normalizedDate || '')))) {
        lines.push(`| ${/** @type {any} */ (row).mission} | ${/** @type {any} */ (row).implementer} | ${row.review_count} | ${/** @type {any} */ (row).reviewer} | ${formatDate(String(row.normalizedDate))} |`);
      }
    } else {
      lines.push('None.');
    }
    lines.push('');
  }

  lines.push('## Raw Data\n');
  lines.push('```csv');
  lines.push(data.headers.join(','));
  for (const row of rows) {
// @ts-ignore -- retained reporting helper is dynamically typed
    lines.push(data.headers.map(header => /** @type{any} */(row)[header] || '').join(','));
  }
  lines.push('```\n');

  return lines.join('\n');
}

/**
 * @param {StatsRow[]} rows
 * @param {{start: Date, end: Date}} window
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function summarizeMissionWindow(rows, window, completedMissionKeys = new Set()) {
// @ts-ignore -- retained reporting helper is dynamically typed
  const { rows: closedRows, missions: uniqueMissions } = summarizeCompletedMissionWindow(rows, window, completedMissionKeys);
  const userValue = uniqueMissions.filter(row => normalizeClassification(row.classification) === 'user_value').length;
  const aiSdlc = uniqueMissions.filter(row => normalizeClassification(row.classification) === 'ai_sdlc').length;
  const unknown = uniqueMissions.filter(row => normalizeClassification(row.classification) === 'unknown').length;
  const validMissions = uniqueMissions.filter(row => normalizeClassification(row.classification) !== null);
  return {
    rows: closedRows,
    total: validMissions.length,
    userValue,
    aiSdlc,
    unknown,
  };
}

/**
 * @param {StatsRow[]} rows
 * @param {{start: Date, end: Date}} window
 * @param {{rootDir?: string|null, deriveFixRoundsFn?: Function}} [options]
 */
/**
 * Shared mission-dedup + agent-grouping pass behind `Agent performance this
 * week`. Deduplicates globally by (repo, mission) so each mission is counted
 * exactly once across all agent groups, then groups the winning per-mission
 * rows by display key (model name, falling back to implementer family).
 * Also returns a mission-key -> displayKey map so other report sections
 * (e.g. the stage-spend table) can fan back out over the *raw*, non-deduped
 * window rows using the same row identity/grouping without re-deriving it.
 *
 * @param {StatsRow[]} rows
 * @param {{start: Date, end: Date}} window
 * @param {{completedOnly?: boolean}} [options]
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function computeAgentMissionGroups(rows, window, options = {}) {
// @ts-ignore -- retained reporting helper is dynamically typed
  const completedMissionKeys = options.completedMissionKeys || new Set();
// @ts-ignore -- retained reporting helper is dynamically typed
  let windowRows;
  // @ts-expect-error dynamically typed reporting options
  if (options.completedOnly) {
    windowRows = rows.filter((row: any) => completedMissionKeys.has(statisticsMissionKey(row)));
  } else {
    windowRows = rows.filter((row: any) => statisticsRowInWindow(row, window));
  }
// @ts-ignore -- retained reporting helper is dynamically typed
  const validWindowRows = windowRows.filter(row => normalizeClassification(row.classification) !== null);
  // Completion is supplied by lifecycle readers, never inferred from telemetry.
  let allValidWindowRows = validWindowRows;
  // The non-completed path supports the live spend table, where no final owner
  // exists yet. It picks a concrete model deterministically.
  /** @type {Record<string, StatsRow>} */
  const byMission = {};
  /** @type {Record<string, StatsRow[]>} */
  const rowsByMission = {};
  for (const row of allValidWindowRows) {
    const key = statisticsMissionKey(row);
// @ts-ignore -- retained reporting helper is dynamically typed
    if (!rowsByMission[key]) {rowsByMission[key] = [];}
// @ts-ignore -- retained reporting helper is dynamically typed
    rowsByMission[key].push(row);
// @ts-ignore -- retained reporting helper is dynamically typed
    const prev = byMission[key];
    const modelTrimmed = (row.model && String(row.model).trim()) || '';
    const implTrimmed = (row.implementer && String(row.implementer).trim()) || '';
    const rowHasModel = Boolean(modelTrimmed);
    const isFamilyMatch = rowHasModel && implTrimmed && modelBelongsToImplFamily(modelTrimmed, implTrimmed);
    let shouldReplace;
    if (!prev) {
      shouldReplace = true;
    } else {
      const prevModelTrimmed = (prev.model && String(prev.model).trim()) || '';
      const prevImplTrimmed = (prev.implementer && String(prev.implementer).trim()) || '';
      const prevHasModel = Boolean(prevModelTrimmed);
      const prevFamilyMatch = prevHasModel && prevImplTrimmed && modelBelongsToImplFamily(prevModelTrimmed, prevImplTrimmed);
      if (rowHasModel && !prevHasModel) {
        shouldReplace = true;
      } else if (!rowHasModel && prevHasModel) {
        shouldReplace = false;
      } else if (rowHasModel && prevHasModel) {
        // Both have models — implementer-family match first, then date, then CSV order.
        if (isFamilyMatch && !prevFamilyMatch) {
          shouldReplace = true;
        } else if (!isFamilyMatch && prevFamilyMatch) {
          shouldReplace = false;
        } else if (row.date > prev.date) {
          shouldReplace = true;
        } else if (row.date < prev.date) {
          shouldReplace = false;
        } else {
          // Same date, same tier — last in CSV wins
          shouldReplace = true;
        }
      } else {
        // Both blank — last in CSV wins
        shouldReplace = true;
      }
    }
    if (shouldReplace) {
// @ts-ignore -- retained reporting helper is dynamically typed
      byMission[key] = row;
    }
  }

// @ts-ignore -- retained reporting helper is dynamically typed
  if (options.completedOnly) {
    for (const [key, missionRows] of Object.entries(rowsByMission)) {
// @ts-ignore -- retained reporting helper is dynamically typed
      const rollup = [...missionRows].reverse().find(row => row.stage === 'default');
// @ts-ignore -- retained reporting helper is dynamically typed
      const owner = rollup?.implementer ?? [...missionRows].reverse().find(row =>
        String(row.stage || 'default').trim().toLowerCase() !== 'review',
      )?.implementer;
// @ts-ignore -- retained reporting helper is dynamically typed
      const ownerModel = [...missionRows].reverse().find(row =>
        row.implementer === owner
          && String(row.stage || 'default').trim().toLowerCase() !== 'review'
          && String(row.model || '').trim(),
      );
// @ts-ignore -- retained reporting helper is dynamically typed
      if (owner && byMission[key]) {
// @ts-ignore -- retained reporting helper is dynamically typed
        byMission[key] = {
// @ts-ignore -- retained reporting helper is dynamically typed
          ...(ownerModel || rollup || byMission[key]),
          reportedImplementer: owner,
// @ts-ignore -- retained reporting helper is dynamically typed
          pr_fix_rounds: rollup?.pr_fix_rounds ?? byMission[key].pr_fix_rounds,
        };
      }
    }
  }

 const uniqueMissions = Object.values(byMission);

  /** @type {Record<string, StatsRow[]>} */
  const groups = {};
  /** @type {Record<string, string>} */
  const missionKeyToDisplayKey = {};
  for (const row of uniqueMissions) {
// @ts-ignore -- retained reporting helper is dynamically typed
    const modelTrimmed = (row.model && String(row.model).trim()) || '';
    let displayKey;
// @ts-ignore -- retained reporting helper is dynamically typed
    if (row.reportedImplementer) {
// @ts-ignore -- retained reporting helper is dynamically typed
      if (modelTrimmed && modelBelongsToImplFamily(modelTrimmed, row.reportedImplementer)) {
        displayKey = modelTrimmed;
      } else {
// @ts-ignore -- retained reporting helper is dynamically typed
        displayKey = row.reportedImplementer;
      }
    } else {
// @ts-ignore -- retained reporting helper is dynamically typed
      displayKey = modelTrimmed || (row.implementer || 'unknown');
    }
// @ts-ignore -- retained reporting helper is dynamically typed
    missionKeyToDisplayKey[statisticsMissionKey(row)] = displayKey;
// @ts-ignore -- retained reporting helper is dynamically typed
    if (!groups[displayKey]) {groups[displayKey] = [];}
// @ts-ignore -- retained reporting helper is dynamically typed
    groups[displayKey].push(row);
  }
  return { allValidWindowRows, groups, missionKeyToDisplayKey };
}

/**
 * @param {StatsRow[]} rows
 * @param {{start: Date, end: Date}} window
 * @param {{rootDir?: string|null, deriveFixRoundsFn?: Function}} [options]
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function summarizeAgentWindow(rows, window, options = {}) {
  /** @type {{rootDir?: string|null, deriveFixRoundsFn?: Function}} */
  const opts = options;
// @ts-ignore -- retained reporting helper is dynamically typed
  const { rootDir = null, deriveFixRoundsFn = null } = opts;
  // Mission counts and repair-round averages describe completed missions only.
  // Other report sections reuse the grouping helper without this filter so
  // their live stage telemetry remains unchanged.
  const { allValidWindowRows, groups } = computeAgentMissionGroups(rows, window, {
// @ts-ignore -- retained reporting helper is dynamically typed
    completedOnly: true, completedMissionKeys: options.completedMissionKeys,
  });
  // Build agent groups from the globally deduplicated missions.
  //
  // `pr_fix_rounds` comes off the stored measurement rows. This used to be
  // re-derived here from the mission-local review event files, because those
  // files were the only complete record of the loop and the stored value could
  // lag them. After the architecture migration cutover the Review aggregate in the
  // operator database is that record, and it is what stamps the stored value —
  // so there is nothing left for a render-time override to correct, and a
  // synchronous renderer has no business reading the database behind the
  // application's back to try. `deriveFixRoundsFn` stays as an injection point
  // for a caller that has already derived a count.
  //
  // Review-fix values are nullable telemetry observations, keyed by lifecycle
  // completion rather than a telemetry completion row.
  /** @type {Record<string, number>} */
  const storedRoundsByMission: Record<string, number> = {};
  const roundsFromRollupByMission = new Set();
  for (const row of allValidWindowRows) {
    const key = statisticsMissionKey(row);
    if (row.pr_fix_rounds !== undefined) {
      // The default rollup is authoritative; without one, the final row is.
      if (row.stage === 'default' || !roundsFromRollupByMission.has(key)) {
// @ts-ignore -- retained reporting helper is dynamically typed
        const rounds = Number.parseInt(String(row.pr_fix_rounds), 10);
        if (Number.isInteger(rounds) && rounds >= 0) {
          storedRoundsByMission[key] = rounds;
          if (row.stage === 'default') { roundsFromRollupByMission.add(key); }
        }
      }
    }
  }
// @ts-ignore -- retained reporting helper is dynamically typed
  const roundsFor = (/** @type {any} */ row) => {
    if (rootDir && deriveFixRoundsFn) {
      const authoritative = deriveFixRoundsFn(row.mission, rootDir, row.repo);
      if (authoritative !== null && authoritative !== undefined) {
        const rounds = Number.parseInt(authoritative, 10);
        return Number.isInteger(rounds) && rounds >= 0 ? rounds : null;
      }
    }
// @ts-ignore -- retained reporting helper is dynamically typed
    return storedRoundsByMission[statisticsMissionKey(row)] ?? null;
  };
  return Object.entries(groups)
    .map(([displayKey, group]) => {
// @ts-ignore -- retained reporting helper is dynamically typed
      const rounds = group.map(roundsFor).filter(value => value !== null);
      const totalRounds = rounds.reduce((sum: number, value: number) => sum + value, 0);
      const summary = {
        implementer: displayKey,
// @ts-ignore -- retained reporting helper is dynamically typed
        missions: group.length,
        averageFixRounds: rounds.length > 0 ? (totalRounds / rounds.length).toFixed(2) : null,
      };
      Object.defineProperty(summary, 'prFixObservationCount', { value: rounds.length });
      return summary;
    })
    .sort((a, b) => a.implementer.localeCompare(b.implementer));
}

// Canonical report stages for the per-agent spend-by-stage table (architecture migration).
// Stored stage `active` is displayed as `execute`, matching the alias already
// used by `MISSION_PHASE_ORDER` for the single-mission phase report. Unlike
// `MISSION_PHASE_ORDER`, this table also carries an explicit `default` column
// (rows with no stage recorded) because the backlog request names it directly.
const AGENT_SPEND_STAGE_COLUMNS = [
  { stage: 'draft', label: 'draft' },
  { stage: 'active', label: 'execute' },
  { stage: 'review', label: 'review' },
  { stage: 'follow-up', label: 'follow-up' },
  { stage: 'default', label: 'default' },
];

/**
 * Classifies a grouped agent row into the spend metric family whose stored
 * telemetry field is the right lens for that agent (architecture migration):
 *  - Codex / OpenAI-backed rows: `openai_usage_after` (usage % snapshot)
 *  - Claude and Mistral rows: `cost_usd` (dollar spend)
 *  - Custom/local-model rows (and anything else unrecognized, since custom/
 *    local is the safe default per the backlog request): `duration_minutes`
 *
 * @param {string} displayKey
 * @param {StatsRow[]} groupRows
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function classifyAgentSpendFamily(displayKey, groupRows) {
// @ts-ignore -- retained reporting helper is dynamically typed
  const probe = [displayKey, ...groupRows.flatMap(row => [row.model, row.implementer, row.provider])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/codex|openai/.test(probe)) {return 'usage';}
  if (/claude|anthropic/.test(probe)) {return 'cost';}
  if (/mistral/.test(probe)) {return 'cost';}
  return 'duration';
}

/**
 * Builds the current-week per-agent stage-spend breakdown behind the new
 * weekly stats table (architecture migration). Reuses the exact same mission dedup and
 * display-key grouping as `summarizeAgentWindow()` (so rows/ordering match
 * `Agent performance this week`), then fans back out over every raw window
 * row (not just the deduped mission winner) to sum each stage's spend metric,
 * since draft/execute/review/follow-up/default are stored as separate rows
 * per mission.
 *
 * @param {StatsRow[]} rows
 * @param {{start: Date, end: Date}} window
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function summarizeAgentStageSpend(rows, window) {
  const { allValidWindowRows, groups, missionKeyToDisplayKey } = computeAgentMissionGroups(rows, window);

  /** @type {Record<string, StatsRow[]>} */
  const rawRowsByDisplayKey = {};
  for (const row of allValidWindowRows) {
// @ts-ignore -- retained reporting helper is dynamically typed
    const displayKey = missionKeyToDisplayKey[statisticsMissionKey(row)];
    if (!displayKey) {continue;}
// @ts-ignore -- retained reporting helper is dynamically typed
    if (!rawRowsByDisplayKey[displayKey]) {rawRowsByDisplayKey[displayKey] = [];}
// @ts-ignore -- retained reporting helper is dynamically typed
    rawRowsByDisplayKey[displayKey].push(row);
  }

  const knownStages = new Set(AGENT_SPEND_STAGE_COLUMNS.map(entry => entry.stage));

  return Object.keys(groups)
    .sort((a, b) => a.localeCompare(b))
    .map(displayKey => {
// @ts-ignore -- retained reporting helper is dynamically typed
      const family = classifyAgentSpendFamily(displayKey, groups[displayKey]);
      /** @type {Record<string, number>} */
      const byStage = {};
// @ts-ignore -- retained reporting helper is dynamically typed
      for (const { stage } of AGENT_SPEND_STAGE_COLUMNS) {byStage[stage] = 0;}
// @ts-ignore -- retained reporting helper is dynamically typed
      for (const row of (rawRowsByDisplayKey[displayKey] || [])) {
        const rawStage = String(row.stage || 'default').trim().toLowerCase() || 'default';
        const bucket = knownStages.has(rawStage) ? rawStage : 'default';
        const value = family === 'usage' ? (Number.parseInt(String(row.openai_usage_after), 10) || 0)
          : family === 'cost' ? (Number.parseFloat(String(row.cost_usd)) || 0)
          : (Number.parseInt(String(row.duration_minutes), 10) || 0);
// @ts-ignore -- retained reporting helper is dynamically typed
        byStage[bucket] += value;
      }
// @ts-ignore -- retained reporting helper is dynamically typed
      const total = AGENT_SPEND_STAGE_COLUMNS.reduce((sum, { stage }) => sum + byStage[stage], 0);
      return { implementer: displayKey, family, byStage, total };
    });
}

/**
 * Formats one spend-table cell as `<metric> (<share %>)`, matching the
 * backlog request's example (`1$ (10%)`). Renders a stable empty-state value
 * instead of misleading `0%` share math when the row has no non-zero spend
 * for its metric family (architecture migration, SC-6).
 *
 * @param {number} value
 * @param {number} total
 * @param {'usage'|'cost'|'duration'} family
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function formatAgentSpendCell(value, total, family) {
  if (!total) {return '—';}
  const pct = Math.round((value / total) * 100);
  if (family === 'usage') {return `${value}% (${pct}%)`;}
  if (family === 'cost') {
    const rounded = Math.round(value * 100) / 100;
    return `$${rounded} (${pct}%)`;
  }
  return `${value}m (${pct}%)`;
}

/**
 * @param {MissionStats[]} rows
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function colorAverageFixRounds(rows) {
  const values = rows
// @ts-ignore -- retained reporting helper is dynamically typed
    .map(row => Number.parseFloat(row.averageFixRounds))
// @ts-ignore -- retained reporting helper is dynamically typed
    .filter(value => Number.isFinite(value));

  if (values.length === 0) {
// @ts-ignore -- retained reporting helper is dynamically typed
    return rows.map(row => row.averageFixRounds);
  }

  const best = Math.min(...values);
  const worst = Math.max(...values);

// @ts-ignore -- retained reporting helper is dynamically typed
  return rows.map(row => {
    const value = Number.parseFloat(row.averageFixRounds);
    if (!Number.isFinite(value)) {return row.averageFixRounds;}
    if (best === worst) {
      return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.green), row.averageFixRounds);
    }
    if (value === best) {
      return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.green), row.averageFixRounds);
    }
    if (value === worst) {
      return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.red), row.averageFixRounds);
    }
    return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.yellow), row.averageFixRounds);
  });
}

/**
 * @param {MissionStats[]} rows
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function colorMissionCounts(rows) {
  const values = rows
// @ts-ignore -- retained reporting helper is dynamically typed
    .map(row => Number.parseInt(String(row.missions), 10))
// @ts-ignore -- retained reporting helper is dynamically typed
    .filter(value => Number.isFinite(value));

  if (values.length === 0) {
// @ts-ignore -- retained reporting helper is dynamically typed
    return rows.map(row => String(row.missions));
  }

  const best = Math.max(...values);
  const worst = Math.min(...values);

// @ts-ignore -- retained reporting helper is dynamically typed
  return rows.map(row => {
    const value = Number.parseInt(String(row.missions), 10);
    if (!Number.isFinite(value)) {return String(row.missions);}
    if (best === worst) {
      return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.green), String(row.missions));
    }
    if (value === best) {
      return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.green), String(row.missions));
    }
    if (value === worst) {
      return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.red), String(row.missions));
    }
    return fmt.colorize(/** @type {import('node:util').InspectColor} */(fmt.colors.yellow), String(row.missions));
  });
}

// Maps the stored `stage` value to the phase label used in the mission report.
const MISSION_PHASE_ORDER = [
  { stage: 'draft', label: 'draft' },
  { stage: 'active', label: 'execute' },
  { stage: 'review', label: 'review' },
  { stage: 'follow-up', label: 'follow-up' },
];

/**
 * Render a single-mission, per-phase telemetry breakdown.
 * Delegates to stats-report.ts (task-2217 extraction).
 *
 * @param {StatsRow[]} rows
 * @param {string} slug
 * @param {StatsOptions} options
 */
// @ts-ignore -- retained reporting helper is dynamically typed
function renderMissionPhaseReport(rows, slug, options = {}) {
  const opts = options || {};
  // Same identity `resolveStatsRepoName()` in stats.ts resolves; called directly
  // here so this module stays a leaf (no import back into stats.ts). An
  // explicit repo option takes precedence and skips the git-based resolution.
// @ts-ignore -- retained reporting helper is dynamically typed
  const repo = opts.repo || resolveCanonicalRepositoryId(opts.rootDir || process.cwd());
  return _renderMissionPhaseReport(rows, slug, {
    ...opts,
// @ts-ignore -- retained reporting helper is dynamically typed
    repo,
    repos: [repo],
  });
}

export {
  formatDate,
  parseBooleanish,
  normalizeRow,
  normalizeRows,
  statsMissionKey,
  modelBelongsToImplFamily,
  groupBy,
  computeImplStats,
  computePeriodStats,
  generateMarkdownReport,
  isValidClassification,
  normalizeClassification,
  rowInWindow,
  summarizeMissionWindow,
  computeAgentMissionGroups,
  summarizeAgentWindow,
  summarizeAgentStageSpend,
  classifyAgentSpendFamily,
  formatAgentSpendCell,
  colorAverageFixRounds,
  colorMissionCounts,
  AGENT_SPEND_STAGE_COLUMNS,
  MISSION_PHASE_ORDER,
  renderMissionPhaseReport,
};
