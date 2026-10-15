import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ResponsibilityViolation } from './boundary-guards.js';

export type WorkflowControl = 'lifecycle' | 'retry' | 'recovery' | 'phase-gate' | 'agent-launch' | 'review-round';

/**
 * Workflow-control operations, keyed by the adapter module a caller imports them
 * from. Invoking one decides what the product workflow does next, which is an
 * application responsibility once an adapter has an application entry.
 */
export const workflowControlOperations: Readonly<Record<string, Readonly<Record<string, WorkflowControl>>>> = {
  'src/adapters/agents/agents.ts': { startAgent: 'agent-launch' },
  'src/adapters/backlog/backlog.ts': { transitionTask: 'lifecycle' },
  'src/adapters/config/repository-gates.ts': { runPhaseGates: 'phase-gate' },
  'src/adapters/review/review-commands.ts': { submitForReview: 'lifecycle', resumeIntervenedReview: 'recovery' },
  'src/adapters/review/review-gate-handling.ts': { runPreReviewGate: 'phase-gate', reboundPreReviewFailure: 'retry' },
  'src/adapters/review/review-loop.ts': { startReviewLoop: 'review-round' },
  'src/adapters/review/review-state.ts': { reconcileInterruptedHandoff: 'recovery' },
};

/** Blanks comments and string contents, preserving offsets, so braces and calls are code. */
const codeOnly = (source: string): string => source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, token => token.replace(/[^\n]/g, ' '));

/**
 * Follow direct bindings and injected defaults rooted in an imported control
 * operation. This is a syntactic invariant, not arbitrary callback/data-flow
 * analysis: names passed through unrelated objects or higher-order functions
 * are outside its claim. Chained defaults remain control operations.
 */
function controlAliases(code: string, imported: string): string[] {
  const names = new Set([imported.replace(/\\s\*/g, '').replace(/\\\./g, '.')]);
  const bindings = [...code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*=\s*(?:([\w$]+(?:\s*\.\s*[\w$]+)*)\s*(?:\?\?|\|\|)\s*)?([\w$]+(?:\s*\.\s*[\w$]+)*)(?=\s*[,;)}\n])/g)];
  let changed = true;
  while (changed) {
    changed = false;
    for (const binding of bindings) {
      const sources = [binding[2], binding[3]].filter(Boolean).map(value => value.replace(/\s/g, ''));
      if (!names.has(binding[1]) && sources.some(value => names.has(value))) {
        names.add(binding[1]);
        changed = true;
      }
    }
  }
  return [...names].map(name => name.replace(/\./g, '\\s*\\.\\s*'));
}

/** Import clauses with extensionless local targets, resolved lexically so the scan reads no other file. */
function importClauses(file: string, source: string): { clause: string; target: string | null; typeOnly: boolean }[] {
  return [...source.matchAll(/import\s+(type\s+)?([^'";]*?)\s+from\s+['"]([^'"]+)['"]/g)].map(match => ({ clause: match[2], typeOnly: Boolean(match[1]),
    target: match[3].startsWith('.') ? path.resolve(path.dirname(file), match[3].replace(/\.(?:[cm]?js|tsx?)$/, '')) : null }));
}

/** How a brace block is entered: a branch, a typed application-port binding, or neither. */
function blockKind(code: string, open: number, ports: ReadonlySet<string>): 'branch' | 'port' | 'plain' {
  const before = code.slice(Math.max(0, open - 300), open);
  const port = /(?::\s*(?:Promise<)?|satisfies\s+)([A-Za-z_$][\w$]*)(?:<[^>]*>)?>?\s*=?\s*$/.exec(before);
  if (port && ports.has(port[1])) {return 'port';}
  if (!/(?:\belse|\))\s*$/.test(before)) {return 'plain';}
  if (/\belse\s*$/.test(before)) {return 'branch';}
  let depth = 0;
  for (let index = code.lastIndexOf(')', open); index >= 0; index -= 1) {
    depth += code[index] === ')' ? 1 : code[index] === '(' ? -1 : 0;
    if (depth === 0) {return /\b(?:if|for|while|switch|catch)\s*$/.test(code.slice(Math.max(0, index - 10), index)) ? 'branch' : 'plain';}
  }
  return 'plain';
}

/** Whether a control call at `at` is selected by a branch rather than bound into a typed port. */
function branchSelected(code: string, at: number, ports: ReadonlySet<string>): boolean {
  const statement = code.slice(Math.max(code.lastIndexOf(';', at), code.lastIndexOf('{', at), code.lastIndexOf('}', at)) + 1, at);
  const inlineBranch = /\b(?:if|else|while|for)\b|&&|\?/.test(statement.replace(/\?\?|\?\./g, ''));
  const enclosing: number[] = [];
  for (let index = 0; index < at; index += 1) { if (code[index] === '{') {enclosing.push(index);} else if (code[index] === '}') {enclosing.pop();} }
  const kinds = enclosing.map(open => blockKind(code, open, ports));
  return !kinds.includes('port') && (inlineBranch || kinds.includes('branch'));
}

/**
 * Workflow ownership: an adapter with an application entry (a value import from
 * `src/application/` other than ports and presentation) may bind typed ports and
 * delegate. Inside a typed port binding it may invoke any control operation —
 * the application decides when — but elsewhere it may invoke a control operation
 * only unconditionally. Choosing one under a branch selects the follow-on
 * workflow action, which belongs to the application entry.
 */
export function workflowOwnershipViolations(files: readonly string[], root: string): ResponsibilityViolation[] {
  const application = path.join(root, 'src', 'application');
  const inside = (target: string | null, dir: string) => Boolean(target?.startsWith(`${dir}${path.sep}`));
  const controlNames = Object.values(workflowControlOperations).flatMap(Object.keys);
  return files.flatMap(file => {
    const source = fs.readFileSync(file, 'utf8');
    const clauses = source.includes('/application/') && controlNames.some(name => source.includes(name)) ? importClauses(file, source) : [];
    const hasEntry = clauses.some(({ target, typeOnly }) => !typeOnly && inside(target, application) && !inside(target, path.join(application, 'ports')) && !inside(target, path.join(application, 'presentation')));
    if (!hasEntry) {return [];}
    const ports = new Set(clauses.filter(({ target }) => inside(target, path.join(application, 'ports')))
      .flatMap(({ clause }) => [...clause.matchAll(/(?:\bas\s+)?([A-Za-z_$][\w$]*)\s*(?=,|}|$)/g)].map(match => match[1])));
    let code: string | undefined;
    return clauses.flatMap(({ clause, target, typeOnly }) => {
      const operations = !typeOnly && target ? workflowControlOperations[`${path.relative(root, target).split(path.sep).join('/')}.ts`] : undefined;
      if (!operations) {return [];}
      const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause)?.[1];
      return Object.entries(operations).flatMap(([name, control]) => {
        const local = namespace || !clause.includes(name) ? null : new RegExp(`(?:^|[{,\\s])${name}(?:\\s+as\\s+([A-Za-z_$][\\w$]*))?\\s*(?=,|}|$)`).exec(clause);
        const callee = namespace ? `${namespace}\\s*\\.\\s*${name}` : local ? (local[1] ?? name) : null;
        if (!callee) {return [];}
        const masked = (code ??= codeOnly(source));
        return controlAliases(masked, callee).flatMap(alias => [...masked.matchAll(new RegExp(`(?<![\\w$.])${alias}\\s*\\)?\\s*\\(`, 'g'))])
          .filter(call => branchSelected(masked, call.index ?? 0, ports))
          .map(call => ({ file: path.relative(root, file), rule: 'adapter-owned-workflow-control' as const, expectedOwner: 'application' as const, actualOwner: 'adapters' as const,
            detail: `line ${masked.slice(0, call.index).split('\n').length} selects ${control} operation "${name}" under a branch outside a typed port binding; move that follow-on decision into the application entry` }));
      });
    });
  });
}
