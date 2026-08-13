import fs from 'fs';
import { WORKFLOW_AGENT_NAMES } from '../agents/agents.js';
import { resolveBaseWorktree } from '../filesystem/mission-utils.js';
import { commitTaskFileUpdate, resolveTaskFile } from './task-file-io.js';

/** @returns {readonly string[]} */
function getSupportedAgents() {
  return WORKFLOW_AGENT_NAMES;
}
/**
 * Internal helper to parse assignee families from YAML frontmatter content.
 * Supports inline array, simple inline, and block formats.
 */
/**
 * @param {string} content
 * @returns {{matched: boolean, families: string[]}}
 */
function parseAssigneeFamilies(content: string) {
  let families: string[] = /** @type {string[]} */ ([]);
  let matched = false;

  const lineMatch = content.match(/^assignee:[ \t]*(.*)$/m);
  if (lineMatch) {
    const rest = lineMatch[1].trim();
    if (rest) {
      matched = true;
      // It's some kind of inline form
      const rawValues = rest.startsWith('[') && rest.endsWith(']')
        ? rest.slice(1, -1)
        : rest;

      families = rawValues.split(',')
        .map((s: string) => s.trim().replace(/^['"]|['"]$/g, '').replace(/^@/, ''))
        .filter((s: string) => s.length > 0);
    }
  }

  if (!matched) {
    // Try block form
    const blockMatch = content.match(/^assignee:[ \t]*[\r\n]+((?:\s+-\s+.+[\r\n]*)+)/m);
    if (blockMatch) {
      matched = true;
      families = blockMatch[1].split(/[\r\n]+/)
        .map((line: string) => line.trim())
        .filter((line: string) => line.startsWith('-'))
        .map((line: string) => line.substring(1).trim().replace(/^['"]|['"]$/g, '').replace(/^@/, ''))
        .filter((s: string) => s.length > 0);
    }
  }

  return { matched, families };
}
/** @param {string} taskFilePath @returns {boolean} */
function clearTaskAgentAssignee(taskFilePath: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return false;}
  let content = fs.readFileSync(taskFilePath, 'utf8');
  if (!content.match(/^assignee:/m)) {return false;}

  const { families } = parseAssigneeFamilies(content);
  const supportedAgents = getSupportedAgents();

  // Separate agent families from human assignees
  const agentFamilies = families.filter((f: string) => supportedAgents.includes(f.toLowerCase()));
  const humanFamilies = families.filter((f: string) => !supportedAgents.includes(f.toLowerCase()));

  // If there are no agent families to clear, nothing to do — preserve human assignees
  if (agentFamilies.length === 0) {
    // Write back the human-only assignee list
    if (humanFamilies.length > 0) {
      const hasBlockForm = content.match(/^assignee:[ \t]*[\r\n]+/);
      if (humanFamilies.length === families.length) {
        // All families were human; no change needed
        return false;
      }
      // Remove agent families and write back human-only
      let newAssigneeLine;
      if (hasBlockForm) {
        newAssigneeLine = 'assignee:\n' + humanFamilies.map((f: string) => `  - ${f}`).join('\n') + '\n';
      } else {
        newAssigneeLine = `assignee: [${humanFamilies.join(', ')}]`;
      }

      if (content.match(/^assignee:\s*\[.*?\]/m)) {
        content = content.replace(/^assignee:\s*\[.*?\]/m, newAssigneeLine);
      } else if (content.match(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m)) {
        content = content.replace(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m, newAssigneeLine);
      } else {
        content = content.replace(/^assignee:[ \t]*.*$/m, newAssigneeLine);
      }

      fs.writeFileSync(taskFilePath, content, 'utf8');
      return true;
    }
    return false;
  }

  const hasBlockForm = content.match(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m);

  if (!hasBlockForm) {
    // Inline array form: replace with human-only agents
    const newAssignee = humanFamilies.length > 0 ? `[${humanFamilies.join(', ')}]` : '[]';
    content = content.replace(/^assignee:\s*\[.*?\]/m, `assignee: ${newAssignee}`);
  } else {
    // Block form: remove agent lines, keep human lines
    let newBlock = content.replace(/^assignee:[ \t]*[\r\n]+/m, 'assignee:\n');
    const blockLines = newBlock.match(/^assignee:\n((?:\s+-\s+.+\n?)*)/m);
    if (blockLines) {
      const keptLines = blockLines[1].split('\n').filter(line => {
        const m = line.match(/^\s+-\s+(.+)/);
        if (!m) {return line.trim() === '';}
        const family = m[1].trim().replace(/^['"]|['"]$/g, '');
        return !supportedAgents.includes(family.toLowerCase());
      }).join('\n');
      newBlock = newBlock.replace(/^assignee:\n((?:\s+-\s+.+\n?)*)/m, 'assignee:\n' + keptLines);
      if (newBlock.endsWith('assignee:\n') || newBlock.endsWith('assignee: \n') || newBlock.endsWith('assignee:\n\n')) {
        newBlock = newBlock.replace(/assignee:\s*\n\s*$/, 'assignee: []\n');
      }
      content = newBlock;
    } else {
      content = content.replace(/^assignee:\s*\[.*?\]/m, `assignee: []`);
    }
  }

  fs.writeFileSync(taskFilePath, content, 'utf8');
  return true;
}
/** @param {string} taskFilePath @returns {string|null} */
function getTaskAssignee(taskFilePath: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return null;}
  const content = fs.readFileSync(taskFilePath, 'utf8');
  const { families } = parseAssigneeFamilies(content);
  return families.length > 0 ? families[0] : null;
}

/** @param {string} taskFilePath @returns {string|null} */
function getTaskImplementer(taskFilePath: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return null;}
  const content = fs.readFileSync(taskFilePath, 'utf8');
  const { families } = parseAssigneeFamilies(content);

  const normalizedFamilies = families.map((f: string) => f.toLowerCase());
  const supportedAgents = getSupportedAgents();
  return normalizedFamilies.find((f: string) => supportedAgents.includes(f)) || null;
}

const CLASSIFICATION_LABELS = new Set(['ai_sdlc', 'user_value', 'unknown']);

/**
 * Parse all labels from a task file's frontmatter, supporting both block
 * and inline YAML formats. Returns a lowercased array of label strings.
 * When both formats are present, block labels take precedence (inline is
 * treated as a fallback when no block labels are found).
 */
/** @param {string} taskFilePath */
function getTaskLabels(taskFilePath: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return [];}
  const content = fs.readFileSync(taskFilePath, 'utf8');

  const blockMatch = content.match(/^labels:[ \t]*[\r\n]+((?:\s+-\s+.+[\r\n]*)+)/m);
  if (blockMatch) {
    return blockMatch[1].split(/[\r\n]+/)
      .map(line => line.trim())
      .filter(line => line.startsWith('-'))
      .map(line => line.substring(1).trim().replace(/^['"]|['"]$/g, ''))
      .map(s => s.toLowerCase())
      .filter(s => s.length > 0);
  }

  const inlineMatch = content.match(/^labels:[ \t]*\[(.*?)\]/m);
  if (inlineMatch) {
    return inlineMatch[1].split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .map(s => s.toLowerCase())
      .filter(s => s.length > 0);
  }

  return [];
}

/** @param {string} taskFilePath */
function getTaskClassification(taskFilePath: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return null;}
  const labels = getTaskLabels(taskFilePath);
  const matches = new Set();
  for (const label of labels) {
    if (CLASSIFICATION_LABELS.has(label)) {matches.add(label);}
  }
  return matches.size === 1 ? [...matches][0] : null;
}

/** @param {string} taskFilePath */
function hasBugLabel(taskFilePath: string) {
  const labels = getTaskLabels(taskFilePath);
  return labels.includes('bug');
}

/**
 * Write a label array to a task file's `labels` frontmatter field.
 * Preserves the existing format (inline `labels: [a, b]` or block
 * `labels:\n  - a\n  - b`). If no `labels` field exists, inserts
 * an inline format field after `created_date`.
 *
 * @param {string} taskFilePath
 * @param {string[]} labels
 * @returns {boolean}
 */
function setTaskLabels(taskFilePath: string, labels: string[]) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return false;}
  let content = fs.readFileSync(taskFilePath, 'utf8');

  const inlinePattern = /^labels:[ \t]*\[.*\]$/m;
  const blockPattern = /^labels:[ \t]*[\r\n]+((?:\s+-\s+.+[\r\n]*)+)/m;

  if (inlinePattern.test(content)) {
    // Replace existing inline format
    const newInline = `labels: [${labels.join(', ')}]`;
    content = content.replace(inlinePattern, newInline);
  } else if (blockPattern.test(content)) {
    // Replace existing block format, preserving block style
    const newBlock = 'labels:\n' + labels.map((l: string) => `  - ${l}`).join('\n') + '\n';
    content = content.replace(blockPattern, newBlock);
  } else {
    // No labels field — insert after created_date (inline format)
    const createdDateMatch = content.match(/^created_date:.*$/m);
    if (createdDateMatch && createdDateMatch.index !== undefined) {
      const insertPos = createdDateMatch.index + createdDateMatch[0].length;
      const newLine = '\nlabels: [' + labels.join(', ') + ']';
      content = content.slice(0, insertPos) + newLine + content.slice(insertPos);
    } else {
      // Fallback: insert after the id field
      const idMatch = content.match(/^id:.*$/m);
      if (!idMatch || idMatch.index === undefined) {return false;}
      const insertPos = idMatch.index + idMatch[0].length;
      const newLine = '\nlabels: [' + labels.join(', ') + ']';
      content = content.slice(0, insertPos) + newLine + content.slice(insertPos);
    }
  }

  fs.writeFileSync(taskFilePath, content, 'utf8');
  return true;
}

/**
 * Sync classification labels from a mission worktree task file to the base
 * worktree task file. Reads labels from the mission worktree, writes them to
 * the base worktree using setTaskLabels, and commits the change.
 *
 * @param {string} slug - The mission slug (e.g., 'architecture migration')
 * @param {string} missionWorktree - Path to the mission worktree
 * @param {string} [baseRoot] - Optional base worktree root (resolved from missionWorktree if omitted)
 * @returns {boolean} - true if sync succeeded, false otherwise
 */
function syncTaskLabelsToBaseWorktree(slug: string, missionWorktree: string, baseRoot?: string) {
  try {
    const missionResolution = resolveTaskFile(slug, missionWorktree);
    if (!missionResolution.ok || !missionResolution.taskFile) {
      return false;
    }

    const missionLabels = getTaskLabels(missionResolution.taskFile);
    if (missionLabels.length === 0) {
      return false;
    }

    const baseWorktree = baseRoot || resolveBaseWorktree(slug, { rootDir: missionWorktree });
    const baseResolution = resolveTaskFile(slug, baseWorktree);
    if (!baseResolution.ok || !baseResolution.taskFile) {
      return false;
    }

    if (!setTaskLabels(baseResolution.taskFile, missionLabels)) {
      return false;
    }

    commitTaskFileUpdate(
      baseResolution.taskFile,
      `backlog(${slug}): sync classification labels from mission worktree`,
      baseWorktree
    );

    return true;
  } catch (_) {
    return false;
  }
}


/**
 * @param {string} taskFilePath
 * @param {string} agentFamily
 * @param {{promote?: boolean}} [opts]
 * @returns {boolean}
 */
function setTaskAssignee(taskFilePath: string, agentFamily: string, { promote = true }: { promote?: boolean } = {} as any) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return false;}
  let content = fs.readFileSync(taskFilePath, 'utf8');

  const { matched, families } = parseAssigneeFamilies(content);

  if (matched) {
    const lowerAgentFamily = agentFamily.toLowerCase();
    const existingIndex = families.findIndex((f: string) => f.toLowerCase() === lowerAgentFamily);

    if (existingIndex !== 0) {
      if (existingIndex !== -1) {
        if (!promote) {return false;} // Already in the list, and we don't want to move it
        // Remove existing to promote to first
        families.splice(existingIndex, 1);
      }

      if (promote) {
        families.unshift(agentFamily);
      } else {
        families.push(agentFamily);
      }

      const newAssignees = `assignee: [${families.join(', ')}]`;

      // Replace whatever form was there with a normalized inline array form
      if (content.match(/^assignee:\s*\[.*?\]/m)) {
        content = content.replace(/^assignee:\s*\[.*?\]/m, newAssignees);
      } else if (content.match(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m)) {
        content = content.replace(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m, newAssignees + '\n');
      } else {
        // Fallback for simple form
        content = content.replace(/^assignee:\s*.*$/m, newAssignees);
      }

      fs.writeFileSync(taskFilePath, content, 'utf8');
      return true;
    }
    return false; // Already authoritative (at index 0)
  }

  // No assignee line exists — insert one after the id frontmatter line
  const insertMatch = content.match(/^(id:.*)/m);
  if (insertMatch && insertMatch.index !== undefined) {
    const insertPos = insertMatch.index + insertMatch[0].length;
    const newLine = '\nassignee: [' + agentFamily + ']';
    content = content.slice(0, insertPos) + newLine + content.slice(insertPos);
    fs.writeFileSync(taskFilePath, content, 'utf8');
    return true;
  }

  return false;
}

/** @param {string} taskFilePath @param {string} agentFamily @returns {boolean} */
function setTaskImplementer(taskFilePath: string, agentFamily: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return false;}
  let content = fs.readFileSync(taskFilePath, 'utf8');

  const { matched, families } = parseAssigneeFamilies(content);
  // Separate humans from recognized agents
  const supportedAgents = getSupportedAgents();
  const preservedFamilies = families.filter(f => !supportedAgents.includes(f.toLowerCase()));
  // To ensure the new implementer is authoritative for getTaskImplementer(),
  // it MUST be the first recognized agent in the list.
  const nextFamilies = [agentFamily, ...preservedFamilies];

  if (matched) {
    const normalizedCurrent = families.map((f: string) => f.toLowerCase());
    const normalizedNext = nextFamilies.map((f: string) => f.toLowerCase());
    // Check if the first agent is already the one we want to set
    if (normalizedCurrent.length > 0 && normalizedCurrent[0] === agentFamily.toLowerCase()) {
      // If the rest of the list is also the same, it's a no-op
      if (normalizedCurrent.length === normalizedNext.length &&
          normalizedCurrent.every((f, /** @type {number} */ i) => f === normalizedNext[i])) {
        return false;
      }
    }

    const newAssignees = `assignee: [${nextFamilies.join(', ')}]`;

    if (content.match(/^assignee:\s*\[.*?\]/m)) {
      content = content.replace(/^assignee:\s*\[.*?\]/m, newAssignees);
    } else if (content.match(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m)) {
      content = content.replace(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m, newAssignees + '\n');
    } else {
      content = content.replace(/^assignee:\s*.*$/m, newAssignees);
    }

    fs.writeFileSync(taskFilePath, content, 'utf8');
    return true;
  }

  const insertMatch = content.match(/^(id:.*)/m);
  if (insertMatch && insertMatch.index !== undefined) {
    const insertPos = insertMatch.index + insertMatch[0].length;
    const newLine = '\nassignee: [' + agentFamily + ']';
    content = content.slice(0, insertPos) + newLine + content.slice(insertPos);
    fs.writeFileSync(taskFilePath, content, 'utf8');
    return true;
  }

  return false;
}

/** @param {string} taskFilePath @param {string} agentFamily @returns {boolean} */
function enforceTaskAssignee(taskFilePath: string, agentFamily: string) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) {return false;}
  let content = fs.readFileSync(taskFilePath, 'utf8');

  const { families } = parseAssigneeFamilies(content);
  if (families.length === 1 && families[0] === agentFamily) {return true;}

  const newAssignee = `assignee: [${agentFamily}]`;

  if (content.match(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m)) {
    content = content.replace(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m, newAssignee + '\n');
  } else if (content.match(/^assignee:[ \t]*.*$/m)) {
    content = content.replace(/^assignee:[ \t]*.*$/m, newAssignee);
  } else {
    const insertMatch = content.match(/^(id:.*)/m);
    if (!insertMatch || insertMatch.index === undefined) {return false;}
    const insertPos = insertMatch.index + insertMatch[0].length;
    content = content.slice(0, insertPos) + '\n' + newAssignee + content.slice(insertPos);
  }

  fs.writeFileSync(taskFilePath, content, 'utf8');
  return true;
}

export {
  CLASSIFICATION_LABELS,
  clearTaskAgentAssignee,
  enforceTaskAssignee,
  getSupportedAgents,
  getTaskAssignee,
  getTaskClassification,
  getTaskImplementer,
  getTaskLabels,
  hasBugLabel,
  parseAssigneeFamilies,
  setTaskAssignee,
  setTaskImplementer,
  setTaskLabels,
  syncTaskLabelsToBaseWorktree,
};

