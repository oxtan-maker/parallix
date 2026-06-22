const fs = require('fs');
const path = require('path');
const { git } = require('../core/git');
const { WORKFLOW_AGENT_NAMES } = require('../agents/agents');
const fmt = require('../core/fmt');

function getSupportedAgents() {
  return WORKFLOW_AGENT_NAMES;
}

function findTaskFiles(slug, rootDir = process.cwd()) {
  const tasksDir = path.join(rootDir, 'backlog', 'tasks');
  const completedDir = path.join(rootDir, 'backlog', 'completed');
  const archivedDir = path.join(rootDir, 'backlog', 'archive', 'tasks');
  const sortByBacklogState = (filePath) => {
    if (filePath.startsWith(tasksDir + path.sep)) return 0;
    if (filePath.startsWith(completedDir + path.sep)) return 1;
    if (filePath.startsWith(archivedDir + path.sep)) return 2;
    return 3;
  };

  const scan = (dir) => {
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir);
    const normalizedSlug = slug.toLowerCase();
    return files
      .filter(f => f.toLowerCase().startsWith(normalizedSlug))
      .map(f => path.join(dir, f));
  };

  const matches = [...scan(tasksDir), ...scan(completedDir), ...scan(archivedDir)];
  return matches.sort((a, b) => sortByBacklogState(a) - sortByBacklogState(b) || a.localeCompare(b));
}

function resolveTaskFile(slug, rootDir = process.cwd()) {
  let matches = findTaskFiles(slug, rootDir);
  const normalizedId = slug.toUpperCase();
  const archivedDir = path.join(rootDir, 'backlog', 'archive', 'tasks');
  const preferSameTaskInHigherPriorityDir = (candidateMatches) => {
    if (candidateMatches.length < 2) return null;
    const [preferred, ...rest] = candidateMatches;
    return rest.every(match => path.basename(match) === path.basename(preferred)) ? preferred : null;
  };

  const findById = (candidateFiles, targetId) => {
    return candidateFiles.filter(f => {
      try {
        const content = fs.readFileSync(f, 'utf8');
        const idMatch = content.match(/^id:\s*([^\r\n]+)/m);
        return idMatch && idMatch[1].trim().toUpperCase() === targetId;
      } catch (_) {
        return false;
      }
    });
  };

  if (matches.length === 0) {
    // Hardening: If no prefix match, search ALL task files for an exact ID match
    const tasksDir = path.join(rootDir, 'backlog', 'tasks');
    const completedDir = path.join(rootDir, 'backlog', 'completed');
    const allFiles = [
      ...(fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir).map(f => path.join(tasksDir, f)) : []),
      ...(fs.existsSync(completedDir) ? fs.readdirSync(completedDir).map(f => path.join(completedDir, f)) : []),
      ...(fs.existsSync(archivedDir) ? fs.readdirSync(archivedDir).map(f => path.join(archivedDir, f)) : []),
    ].filter(f => f.endsWith('.md'));

    const idMatches = findById(allFiles, normalizedId);
    if (idMatches.length === 1) {
      return { ok: true, taskFile: idMatches[0], matches: idMatches };
    }

    // Still no match? Try base task ID if slug has a suffix (e.g., task-1004-modern -> TASK-1004)
    const baseTaskMatch = slug.match(/^(task-\d+)/i);
    if (baseTaskMatch) {
      const baseId = baseTaskMatch[1].toUpperCase();
      const baseMatches = findById(allFiles, baseId);
      if (baseMatches.length === 1) {
        return { ok: true, taskFile: baseMatches[0], matches: baseMatches };
      }
      if (baseMatches.length > 1) {
        const preferred = preferSameTaskInHigherPriorityDir(baseMatches);
        if (preferred) {
          return { ok: true, taskFile: preferred, matches: baseMatches };
        }
        return { ok: false, reason: 'ambiguous', matches: baseMatches };
      }
    }

    return { ok: false, reason: 'missing', matches: idMatches };
  }

  if (matches.length === 1) {
    // Even if one prefix match exists, verify it doesn't conflict with another ID match
    // or just return it if it's the only one.
    return { ok: true, taskFile: matches[0], matches };
  }

  // Preference 1: Exact frontmatter id: match (e.g., id: TASK-093)
  const idMatches = findById(matches, normalizedId);

  if (idMatches.length === 1) {
    return { ok: true, taskFile: idMatches[0], matches: idMatches };
  }
  if (idMatches.length > 1) {
    const preferred = preferSameTaskInHigherPriorityDir(idMatches);
    if (preferred) {
      return { ok: true, taskFile: preferred, matches: idMatches };
    }
    return { ok: false, reason: 'ambiguous', matches: idMatches };
  }

  // Fallback: If no ID matches but we have filename-prefix matches, 
  // we only allow it if it's unambiguous.
  return { ok: false, reason: 'ambiguous', matches };
}

function findTaskFile(slug, rootDir = process.cwd()) {
  const result = resolveTaskFile(slug, rootDir);
  return result.ok ? result.taskFile : null;
}

function reportTaskResolution(result, slug, log = fmt.log.plain) {
  if (result.ok) return;

  if (result.reason === 'ambiguous') {
    log(fmt.status('FAIL', `Backlog task resolution is ambiguous for slug: ${fmt.slug(slug)}`));
    log(fmt.status('INFO', 'Multiple candidates found:'));
    result.matches.forEach(m => log(`  - ${m}`));
    log(fmt.status('INFO', 'Repair: Ensure only one task has the filename prefix or matching "id:" frontmatter.'));
  } else {
    log(fmt.status('FAIL', `Backlog task for ${fmt.slug(slug)} not found in backlog/tasks/ or backlog/completed/.`));
    log(fmt.status('INFO', `Repair: Create the task file first. Example: ${fmt.command(`backlog_task_create --title "Mission: ${slug}"`)}`));
  }
}

function checkBacklogIntegrity(rootDir = process.cwd(), slug = null) {
  const tasksDir = path.join(rootDir, 'backlog', 'tasks');
  const completedDir = path.join(rootDir, 'backlog', 'completed');
  const issues = [];
  const normalizedSlug = slug ? slug.toLowerCase() : null;

  const scan = (dir) => {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      if (normalizedSlug && !file.toLowerCase().startsWith(normalizedSlug)) {
        continue;
      }
      const filePath = path.join(dir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');

        // Extract ID from filename prefix (e.g., task-093 or task-093.01)
        const filenameMatch = file.match(/^(task-\d+(?:\.\d+)?)/i);
        if (!filenameMatch) continue;

        const filenameId = filenameMatch[1].toUpperCase();

        // Extract ID from frontmatter
        const idMatch = content.match(/^id:\s*([^\r\n]+)/m);
        if (idMatch) {
          const frontmatterId = idMatch[1].trim().toUpperCase();
          if (frontmatterId !== filenameId) {
            issues.push({
              file: path.relative(rootDir, filePath),
              type: 'id-mismatch',
              filenameId,
              frontmatterId
            });
          }
        }
      } catch (_) {
        // ignore read errors
      }
    }
  };

  scan(tasksDir);
  scan(completedDir);
  return issues;
}

function getTaskStatus(taskFilePath) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) return null;
  const content = fs.readFileSync(taskFilePath, 'utf8');

  // Try YAML first
  const yamlMatch = content.match(/^status:\s*([^\r\n]+)/m);
  if (yamlMatch) {
    return yamlMatch[1].trim().toLowerCase();
  }

  // Try rendered format
  const statusMatch = content.match(/^Status:\s*(.*)$/m);
  if (statusMatch) {
    return statusMatch[1].replace(/^[○●\(\)\s]+/, '').trim().toLowerCase();
  }

  return null;
}

function setTaskStatus(taskFilePath, newStatus) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) return false;
  let content = fs.readFileSync(taskFilePath, 'utf8');

  // Update YAML
  const yamlMatch = content.match(/^status:\s*([^\r\n]+)/m);
  if (yamlMatch) {
    content = content.replace(/^status:\s*.*$/m, `status: ${newStatus}`);
  }

  // Update rendered status line (e.g., "Status: ○ backlog")
  // Map internal status to display markers if needed, but for now just text update
  const statusMatch = content.match(/^Status:\s*(.*)$/m);
  if (statusMatch) {
    const original = statusMatch[1];
    // Keep markers like ○ if they exist
    const markerMatch = original.match(/^([○●\(\)\s]+)/);
    const marker = markerMatch ? markerMatch[1] : '';
    content = content.replace(/^Status:\s*.*$/m, `Status: ${marker}${newStatus}`);
  }

  fs.writeFileSync(taskFilePath, content, 'utf8');
  return true;
}

function completeTask(slug, rootDir = process.cwd()) {
  const resolution = resolveTaskFile(slug, rootDir);
  if (!resolution.ok) return false;

  const taskFilePath = resolution.taskFile;
  const fileName = path.basename(taskFilePath);
  const tasksDir = path.join(rootDir, 'backlog', 'tasks');
  const completedDir = path.join(rootDir, 'backlog', 'completed');

  if (!taskFilePath.includes(tasksDir)) {
    // Already in completed or somewhere else
    setTaskStatus(taskFilePath, 'done');
    return true;
  }

  if (!fs.existsSync(completedDir)) {
    fs.mkdirSync(completedDir, { recursive: true });
  }

  const targetPath = path.join(completedDir, fileName);

  // Set status before moving
  setTaskStatus(taskFilePath, 'done');

  fs.renameSync(taskFilePath, targetPath);
  return true;
}

/**
 * Internal helper to parse assignee families from YAML frontmatter content.
 * Supports inline array, simple inline, and block formats.
 */
function parseAssigneeFamilies(content) {
  let families = [];
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
        .map(s => s.trim().replace(/^['"]|['"]$/g, '').replace(/^@/, ''))
        .filter(s => s.length > 0);
    }
  }

  if (!matched) {
    // Try block form
    const blockMatch = content.match(/^assignee:[ \t]*[\r\n]+((?:\s+-\s+.+[\r\n]*)+)/m);
    if (blockMatch) {
      matched = true;
      families = blockMatch[1].split(/[\r\n]+/)
        .map(line => line.trim())
        .filter(line => line.startsWith('-'))
        .map(line => line.substring(1).trim().replace(/^['"]|['"]$/g, '').replace(/^@/, ''))
        .filter(s => s.length > 0);
    }
  }

  return { matched, families };
}

function commitTaskFileUpdate(taskFilePath, message, rootDir = process.cwd()) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) return;
  // Run `git add/commit` against the worktree the caller intended (rootDir),
  // not whichever branch process.cwd() happens to have checked out. All
  // worktrees share one git object store, so the only thing that pins the
  // commit to the correct mission branch is the `-C <rootDir>` working dir.
  // Fall back to the task file's directory if rootDir isn't supplied or the
  // task file lives outside it (defensive: keeps the add/commit consistent).
  const gitDir = (rootDir && taskFilePath.startsWith(path.resolve(rootDir) + path.sep))
    ? rootDir
    : path.dirname(taskFilePath);
  const relativeTaskPath = path.relative(gitDir, taskFilePath);
  try {
    git(['-C', gitDir, 'add', relativeTaskPath]);
    const result = git(['-C', gitDir, 'commit', '-m', message]);
    if (result.status !== 0) {
      // If there's nothing to commit (e.g. no change), git commit exits with status 1
      // but we should check if it was really a failure or just no-op.
      const statusResult = git(['-C', gitDir, 'status', '--porcelain', relativeTaskPath]);
      if (statusResult.stdout.trim() === '') {
        return true; // No-op is success
      }
      fmt.log.warn(`Failed to commit task update: ${result.stderr}`);
      return false;
    }
    return true;
  } catch (e) {
    fmt.log.fail(`Git error during task update: ${e.message}`);
    return false;
  }
}

function clearTaskAgentAssignee(taskFilePath) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) return false;
  let content = fs.readFileSync(taskFilePath, 'utf8');
  if (!content.match(/^assignee:/m)) return false;

  const { families } = parseAssigneeFamilies(content);
  const supportedAgents = getSupportedAgents();

  // Separate agent families from human assignees
  const agentFamilies = families.filter(f => supportedAgents.includes(f.toLowerCase()));
  const humanFamilies = families.filter(f => !supportedAgents.includes(f.toLowerCase()));

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
        newAssigneeLine = 'assignee:\n' + humanFamilies.map(f => `  - ${f}`).join('\n') + '\n';
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
        if (!m) return line.trim() === '';
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

/**
 * Transition a task to a new status, optionally enforcing an implementer,
 * restoring a prior assignee, or clearing agent assignees,
 * and commit the change to the mission branch.
 */
function transitionTask(slug, newStatus, { implementer = null, clearAssignee = false, rootDir = process.cwd(), log = fmt.log.plain } = {}) {
  const resolution = resolveTaskFile(slug, rootDir);
  if (!resolution.ok) {
    log(fmt.status('WARN', `Could not transition task ${fmt.slug(slug)}: ${resolution.reason}`));
    return false;
  }

  const taskFile = resolution.taskFile;

  // Guard: reject suffixed slugs (e.g. "task-1048-regress") to prevent
  // resolveTaskFile's base-ID fallback from silently committing to the
  // wrong task file when the slug's base ID does not match the resolved
  // file's frontmatter id.  See TASK-1265 for the original incident.
  const slugHasSuffix = /^(task-\d+)-/i.test(slug);
  if (slugHasSuffix) {
    log(fmt.status('WARN',
      `Task ${fmt.slug(slug)} rejected: slug "${slug}" has a suffix; ` +
      'use the exact task id instead to avoid committing to the wrong file.'));
    return false;
  }

  let changed = false;

  if (implementer) {
    if (enforceTaskAssignee(taskFile, implementer)) {
      changed = true;
    }
  } else if (clearAssignee) {
    if (clearTaskAgentAssignee(taskFile)) {
      changed = true;
    }
  }

  const currentStatus = getTaskStatus(taskFile);
  if (currentStatus !== newStatus) {
    if (setTaskStatus(taskFile, newStatus)) {
      changed = true;
    }
  }

  if (changed) {
    let msg = `backlog(${slug}): transition to ${newStatus}`;
    if (implementer) msg += ` and implementer=${implementer}`;
    
    if (commitTaskFileUpdate(taskFile, msg, rootDir)) {
      log(fmt.status('PASS', `Task ${fmt.slug(slug)} transitioned to ${newStatus}${implementer ? ' (assignee=' + fmt.agent(implementer) + ')' : ''} and committed.`));
      return true;
    }
    return false;
  }

  return true; // Already in the desired state
}

function getTaskAssignee(taskFilePath) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) return null;
  const content = fs.readFileSync(taskFilePath, 'utf8');
  const { families } = parseAssigneeFamilies(content);
  return families.length > 0 ? families[0] : null;
}

function getTaskImplementer(taskFilePath) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) return null;
  const content = fs.readFileSync(taskFilePath, 'utf8');
  const { families } = parseAssigneeFamilies(content);

  const normalizedFamilies = families.map(f => f.toLowerCase());
  const supportedAgents = getSupportedAgents();
  return normalizedFamilies.find(f => supportedAgents.includes(f)) || null;
}

function getTaskFrontmatterValue(taskFilePath, field) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) return null;
  const content = fs.readFileSync(taskFilePath, 'utf8');
  const pattern = new RegExp(`^${field}:\\s*([^\\r\\n]+)`, 'mi');
  const match = content.match(pattern);
  if (!match) return null;
  const value = match[1].trim().replace(/^['"]|['"]$/g, '');
  return value || null;
}

function getTaskClassification(taskFilePath) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) return null;
  const content = fs.readFileSync(taskFilePath, 'utf8');
  const matches = new Set();

  const blockMatch = content.match(/^labels:[ \t]*[\r\n]+((?:\s+-\s+.+[\r\n]*)+)/m);
  if (blockMatch) {
    const labels = blockMatch[1].split(/[\r\n]+/)
      .map(line => line.trim())
      .filter(line => line.startsWith('-'))
      .map(line => line.substring(1).trim().replace(/^['"]|['"]$/g, ''))
      .map(s => s.toLowerCase());
    if (labels.includes('ai_sdlc')) matches.add('ai_sdlc');
    if (labels.includes('user_value')) matches.add('user_value');
  }

  const inlineMatch = content.match(/^labels:[ \t]*\[(.*?)\]/m);
  if (inlineMatch) {
    const labels = inlineMatch[1].split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
      .map(s => s.toLowerCase());
    if (labels.includes('ai_sdlc')) matches.add('ai_sdlc');
    if (labels.includes('user_value')) matches.add('user_value');
  }

  return matches.size === 1 ? [...matches][0] : null;
}


function setTaskAssignee(taskFilePath, agentFamily, { promote = true } = {}) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) return false;
  let content = fs.readFileSync(taskFilePath, 'utf8');

  const { matched, families } = parseAssigneeFamilies(content);

  if (matched) {
    const lowerAgentFamily = agentFamily.toLowerCase();
    const existingIndex = families.findIndex(f => f.toLowerCase() === lowerAgentFamily);

    if (existingIndex !== 0) {
      if (existingIndex !== -1) {
        if (!promote) return false; // Already in the list, and we don't want to move it
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
  if (insertMatch) {
    const insertPos = insertMatch.index + insertMatch[0].length;
    const newLine = '\nassignee: [' + agentFamily + ']';
    content = content.slice(0, insertPos) + newLine + content.slice(insertPos);
    fs.writeFileSync(taskFilePath, content, 'utf8');
    return true;
  }

  return false;
}

function setTaskImplementer(taskFilePath, agentFamily) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) return false;
  let content = fs.readFileSync(taskFilePath, 'utf8');

  const { matched, families } = parseAssigneeFamilies(content);
  // Separate humans from recognized agents
  const supportedAgents = getSupportedAgents();
  const preservedFamilies = families.filter(f => !supportedAgents.includes(f.toLowerCase()));
  // To ensure the new implementer is authoritative for getTaskImplementer(),
  // it MUST be the first recognized agent in the list.
  const nextFamilies = [agentFamily, ...preservedFamilies];

  if (matched) {
    const normalizedCurrent = families.map(f => f.toLowerCase());
    const normalizedNext = nextFamilies.map(f => f.toLowerCase());
    // Check if the first agent is already the one we want to set
    if (normalizedCurrent.length > 0 && normalizedCurrent[0] === agentFamily.toLowerCase()) {
      // If the rest of the list is also the same, it's a no-op
      if (normalizedCurrent.length === normalizedNext.length &&
          normalizedCurrent.every((f, i) => f === normalizedNext[i])) {
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
  if (insertMatch) {
    const insertPos = insertMatch.index + insertMatch[0].length;
    const newLine = '\nassignee: [' + agentFamily + ']';
    content = content.slice(0, insertPos) + newLine + content.slice(insertPos);
    fs.writeFileSync(taskFilePath, content, 'utf8');
    return true;
  }

  return false;
}

function enforceTaskAssignee(taskFilePath, agentFamily) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) return false;
  let content = fs.readFileSync(taskFilePath, 'utf8');

  const { families } = parseAssigneeFamilies(content);
  if (families.length === 1 && families[0] === agentFamily) return true;

  const newAssignee = `assignee: [${agentFamily}]`;

  if (content.match(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m)) {
    content = content.replace(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m, newAssignee + '\n');
  } else if (content.match(/^assignee:[ \t]*.*$/m)) {
    content = content.replace(/^assignee:[ \t]*.*$/m, newAssignee);
  } else {
    const insertMatch = content.match(/^(id:.*)/m);
    if (!insertMatch) return false;
    const insertPos = insertMatch.index + insertMatch[0].length;
    content = content.slice(0, insertPos) + '\n' + newAssignee + content.slice(insertPos);
  }

  fs.writeFileSync(taskFilePath, content, 'utf8');
  return true;
}

function getAcceptanceCriteria(taskFilePath) {
  if (!taskFilePath || !fs.existsSync(taskFilePath)) return [];
  const content = fs.readFileSync(taskFilePath, 'utf8');
  const sectionMatch = content.match(/## Acceptance Criteria\s*\n([\s\S]*?)(?:\n## |\nDefinition of Done:|\n---\n|$)/);
  if (!sectionMatch) return [];

  return sectionMatch[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^- \[[ xX]\]/.test(line));
}

module.exports = {
  findTaskFiles,
  findTaskFile,
  resolveTaskFile,
  reportTaskResolution,
  checkBacklogIntegrity,
  getTaskStatus,
  setTaskStatus,
  transitionTask,
  commitTaskFileUpdate,
  completeTask,
  getTaskAssignee,
  getTaskImplementer,
  getTaskFrontmatterValue,
  getTaskClassification,
  setTaskAssignee,
  setTaskImplementer,
  enforceTaskAssignee,
  getAcceptanceCriteria,
   parseAssigneeFamilies,
   clearTaskAgentAssignee
};
