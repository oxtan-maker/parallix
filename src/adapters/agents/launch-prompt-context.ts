import fs from 'node:fs';
import path from 'node:path';
import { resolvePromptConfiguration } from '../config/product-config.js';

/** Graph discovery belongs to the harness, not to each launched agent. */
export function renderGraphifyLaunchGuidance(prompt: string, root: string): string {
  const graph = path.join(root, 'graphify-out', 'graph.json');
  return prompt.split('\n').filter(line => !line.includes('Graphify-first:') || fs.existsSync(graph))
    .map(line => line.includes('Graphify-first:')
      ? line.replace(/before (?:drafting|executing|reviewing), check if `graphify-out\/graph.json` exists\. If it does, (?:run )?/, 'graphify-out/graph.json exists at launch. ')
      : line).join('\n');
}

/** Keep the harness-pinned CLI ahead of any globally installed px. */
export function pinnedAgentPath(cli: string | undefined, searchPath: string): string {
  if (!cli) { return searchPath; }
  const directory = path.dirname(cli);
  return [directory, ...searchPath.split(path.delimiter).filter(part => part !== directory)].join(path.delimiter);
}


/** A runtime must confirm its compaction capability before showing recovery guidance. */
export function renderRunnerContextRecovery(prompt: string, compactionEnabled: boolean): string {
  const body = prompt.split('\n').filter(line => !line.startsWith('Context recovery after runner compaction:')).join('\n');
  return compactionEnabled && prompt.includes('Mode: execute after lock.') ? `${body}\n\nContext recovery after runner compaction: if Mission context is missing after automatic compaction, read px status to recover the locked goal, scope, criteria, checkpoint plan and recorded evidence. Keep failed-gate diagnostics.` : body;
}

/** Run inside the final shell body, after login/interactive profiles have loaded. */
export function pinnedCliBootstrap(cli: string): string {
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  return `unalias px 2>/dev/null || :\nexport PATH=${quote(path.dirname(cli))}:"$PATH"\npx() { command ${quote(cli)} "$@"; }`;
}

export function renderPinnedCliGuidance(prompt: string, cli: string | undefined): string {
  if (!cli) { return prompt; }
  return `${prompt}\n\nPinned CLI shell bootstrap: prefix every shell-tool invocation that uses px with the following bootstrap. Put it inside the final shell body, including nested login or interactive shells, after profiles load. Then use the short px commands below; the function overrides profile aliases/functions and PATH resets.\n\n\`\`\`sh\n${pinnedCliBootstrap(cli)}\n\`\`\``;
}

/** Claude and Codex compact natively; Pi confirms its capability in the SDK runtime. */
export function nativeRunnerRecoveryEnabled(family: string, root: string): boolean {
  return ['claude', 'codex'].includes(family) && resolvePromptConfiguration(root).contextCompaction;
}
