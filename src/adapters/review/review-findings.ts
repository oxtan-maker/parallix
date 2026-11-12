import { reviewFindingId, type ReviewFinding } from '../../domain/review.js';

/** Reviewer headings such as `## F1 (blocking): summary`. */
const FINDING_HEADING_PREFIX = /^#{2,4}[ \t]*(F\d+[a-z]?)/i;

function findingHeading(line: string): { id: string; summary: string } | null {
  const match = FINDING_HEADING_PREFIX.exec(line);
  if (!match) { return null; }
  const boundary = line[match[0].length];
  if (boundary && /[a-z0-9_]/i.test(boundary)) { return null; }
  let remainder = line.slice(match[0].length).trimStart();
  if (remainder.startsWith('(')) {
    const close = remainder.indexOf(')');
    if (close >= 0) { remainder = remainder.slice(close + 1).trimStart(); }
  }
  if (remainder && ':.—-'.includes(remainder[0])) { remainder = remainder.slice(1).trimStart(); }
  const summary = remainder.replace(/[`*]/g, '').trim();
  return summary ? { id: match[1].toUpperCase(), summary } : null;
}

export function parseReviewFindings(markdown: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split(/\r?\n/)) {
    const heading = findingHeading(line);
    if (!heading || seen.has(heading.id)) { continue; }
    seen.add(heading.id);
    findings.push({ id: reviewFindingId(heading.id), summary: heading.summary, location: null });
  }
  return findings;
}

/** Preserve structured findings or a reviewer's first plain-text change request. */
export function reviewFindingsFromMessage(message: string): ReviewFinding[] {
  const parsed = parseReviewFindings(message);
  const summary = message.split('\n').find(line => line.trim())?.trim();
  return parsed.length > 0 || !summary ? parsed : [{ id: reviewFindingId('F1'), summary, location: null }];
}
