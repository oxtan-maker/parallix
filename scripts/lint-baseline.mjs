import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function countBaselineViolations(eslintResults, baseline) {
  const counts = Object.fromEntries(Object.keys(baseline).map((rule) => [rule, 0]));
  for (const result of eslintResults) {
    for (const message of result.messages ?? []) {
      if (message.ruleId in counts) { counts[message.ruleId] += 1; }
    }
  }
  return counts;
}

export function checkLintBaseline(eslintResults, baseline) {
  const counts = countBaselineViolations(eslintResults, baseline);
  const increased = [];
  const decreased = [];
  for (const [rule, expected] of Object.entries(baseline)) {
    const actual = counts[rule];
    if (actual > expected) { increased.push({ rule, expected, actual }); }
    if (actual < expected) { decreased.push({ rule, expected, actual }); }
  }
  return { counts, increased, decreased, ok: increased.length === 0 && decreased.length === 0 };
}

function formatChange(kind, changes) {
  return changes.map(({ rule, expected, actual }) => `${kind}: ${rule} is ${actual}; baseline is ${expected}`).join('\n');
}

export function isLintBaselineCli(moduleUrl, argv = process.argv) {
  return typeof argv[1] === 'string' && moduleUrl === pathToFileURL(argv[1]).href;
}

if (isLintBaselineCli(import.meta.url)) {
  const baselinePath = process.argv[2];
  if (!baselinePath) {
    console.error('Usage: node scripts/lint-baseline.mjs <baseline.json> < eslint.json');
    process.exitCode = 2;
  } else {
    try {
      const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      const result = checkLintBaseline(JSON.parse(fs.readFileSync(0, 'utf8')), baseline);
      if (result.ok) {
        console.log(`PASS: lint baseline holds (${Object.entries(result.counts).map(([rule, count]) => `${rule}=${count}`).join(', ')})`);
      } else {
        if (result.increased.length > 0) { console.error(formatChange('FAIL', result.increased)); }
        if (result.decreased.length > 0) {
          console.error(formatChange('RATCHET', result.decreased));
          console.error('Lower config/lint-baseline.json in the same change after confirming the reduction is intentional.');
        }
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(`FAIL: could not verify lint baseline: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 2;
    }
  }
}
