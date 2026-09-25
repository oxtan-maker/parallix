#!/usr/bin/env node
// Render the canonical LCOV artifact for humans; coverage generation remains
// owned by the CI-safe test execution.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

type Metric = { covered: number, total: number };

function integer(value: string, positive = false): number | undefined {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) { return undefined; }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && (!positive || parsed > 0) ? parsed : undefined;
}

function formatMetric(name: string, metric: Metric): string {
  const percentage = metric.total === 0 ? 0 : (metric.covered / metric.total) * 100;
  return `| ${name} | ${metric.covered.toLocaleString('en-US')} | ${metric.total.toLocaleString('en-US')} | ${percentage.toFixed(1)}% |`;
}

export function renderLcovSummary(lcov: string, source: string, revision?: string): string {
  const lines = new Map<string, Map<number, number>>();
  const functions = new Map<string, number>();
  const branches = new Map<string, number>();
  let currentSource: string | undefined;

  for (const record of lcov.split(/\r?\n/)) {
    if (record.startsWith('SF:')) {
      currentSource = record.slice(3);
      continue;
    }
    if (!currentSource) { continue; }
    const line = /^DA:(\d+),(\d+)(?:,.+)?$/.exec(record);
    if (line) {
      const number = integer(line[1], true);
      const hits = integer(line[2]);
      if (number !== undefined && hits !== undefined) {
        const sourceLines = lines.get(currentSource) ?? new Map<number, number>();
        sourceLines.set(number, Math.max(sourceLines.get(number) ?? 0, hits));
        lines.set(currentSource, sourceLines);
      }
      continue;
    }
    const fn = /^FNDA:(\d+),(.+)$/.exec(record);
    if (fn) {
      const hits = integer(fn[1]);
      if (hits !== undefined) { functions.set(`${currentSource}\0${fn[2]}`, Math.max(functions.get(`${currentSource}\0${fn[2]}`) ?? 0, hits)); }
      continue;
    }
    const branch = /^BRDA:(\d+),(\d+),(\d+),(\d+)$/.exec(record);
    if (branch) {
      const values = branch.slice(1).map(value => integer(value));
      if (values.every((value): value is number => value !== undefined)) {
        const [lineNumber, block, branchNumber, hits] = values;
        branches.set(`${currentSource}\0${lineNumber}\0${block}\0${branchNumber}`, Math.max(branches.get(`${currentSource}\0${lineNumber}\0${block}\0${branchNumber}`) ?? 0, hits));
      }
    }
  }

  const metric = (values: Iterable<number>): Metric => {
    const hits = [...values];
    return { covered: hits.filter(hit => hit > 0).length, total: hits.length };
  };
  const rows = [formatMetric('Lines', metric([...lines.values()].flatMap(sourceLines => [...sourceLines.values()])))];
  if (functions.size) { rows.push(formatMetric('Functions', metric(functions.values()))); }
  if (branches.size) { rows.push(formatMetric('Branches', metric(branches.values()))); }

  return [
    '## Whole-report CI-safe LCOV coverage',
    '',
    '| Metric | Covered | Total | Coverage |',
    '| --- | ---: | ---: | ---: |',
    ...rows,
    '',
    revision ? `Revision: ${revision}` : undefined,
    `Coverage source: \`${source}\``,
    'SonarQube quality gate: reported separately below.',
    '',
  ].filter((line): line is string => line !== undefined).join('\n');
}

export function renderLcovFile(source: string, revision?: string): string {
  try {
    return renderLcovSummary(fs.readFileSync(source, 'utf8'), source, revision);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`[lcov-summary] cannot read LCOV report \`${source}\`: ${detail}`);
  }
}

function main(): void {
  const [source, revision] = process.argv.slice(2);
  if (!source) {
    console.error('[lcov-summary] usage: render-lcov-summary.ts <coverage/lcov.info> [revision]');
    process.exitCode = 1;
    return;
  }
  try {
    process.stdout.write(renderLcovFile(source, revision));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { main(); }
