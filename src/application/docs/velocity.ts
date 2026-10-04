import type { MissionOutcome } from '../../domain/usage.js';

export interface VelocityWeek { readonly weekOf: string; readonly completedCount: number; }
const DAY = 86_400_000;
function mondayUtc(value: string): Date { const d = new Date(value); if (Number.isNaN(d.getTime())) { throw new Error(`Invalid completion timestamp: ${value}`); } const day = d.getUTCDay() || 7; return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 1)); }

/** Completed lifecycle outcomes grouped into full Monday-to-Sunday UTC weeks. */
export function weeklyComparableOutcomes(outcomes: readonly MissionOutcome[], now: string): readonly VelocityWeek[] {
  const through = mondayUtc(now).getTime();
  const selected = outcomes.filter(o => mondayUtc(o.closedAt).getTime() < through);
  if (!selected.length) { return []; }
  const start = Math.min(...selected.map(o => mondayUtc(o.closedAt).getTime()));
  const counts = new Map<number, number>();
  for (const o of selected) { const at = mondayUtc(o.closedAt).getTime(); counts.set(at, (counts.get(at) ?? 0) + 1); }
  const weeks: VelocityWeek[] = [];
  for (let at = start; at < through; at += DAY * 7) {weeks.push({ weekOf: new Date(at).toISOString().slice(0, 10), completedCount: counts.get(at) ?? 0 });}
  return weeks;
}

export function assertVelocitySnapshot(snapshot: any): void {
  if (snapshot?.metric?.classification !== 'all') { throw new Error('Velocity snapshot must include all mission classifications.'); }
  const baseline = snapshot?.manualBaseline;
  if (baseline?.kind !== 'aggregate-rate' || !Number.isFinite(baseline?.unitsPerWeek)) { throw new Error('Velocity snapshot must contain an aggregate manual baseline rate.'); }
  const count = baseline?.observations?.count, days = baseline?.observationPeriod?.days;
  if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(days) || days <= 0) { throw new Error('Velocity baseline must contain positive observation count and days.'); }
  const derivedRate = count / days * 7;
  if (Math.abs(baseline.unitsPerWeek - derivedRate) > Number.EPSILON) { throw new Error(`Velocity baseline rate must equal observations.count / observationPeriod.days * 7 (${derivedRate}).`); }
  const evidencePath = baseline?.source?.path;
  if (typeof evidencePath !== 'string' || !evidencePath.startsWith('docs/') || evidencePath.split('/').includes('..')) { throw new Error('Velocity baseline must reference a retained public evidence path.'); }
  if (snapshot?.metric?.week?.currentPartialWeek !== 'excluded') { throw new Error('Velocity snapshot must exclude the current partial week.'); }
  if (!Array.isArray(snapshot?.parallix?.weeks)) { throw new Error('Velocity snapshot must contain weekly Parallix outcomes.'); }
  for (const week of snapshot.parallix.weeks) { if (!/^\d{4}-\d{2}-\d{2}$/.test(week.weekOf) || !Number.isInteger(week.completedCount) || week.completedCount < 0) { throw new Error('Velocity snapshot contains an invalid weekly outcome.'); } }
}

/** The exporter reports ambiguous completed work instead of silently counting it. */
export function assertVelocityOutcomesAreUnambiguous(outcomes: readonly MissionOutcome[]): void {
  const unknown = outcomes.filter(outcome => outcome.labels.some(label => label === 'unknown')).map(outcome => outcome.missionId);
  if (unknown.length > 0) { throw new Error(`Velocity export cannot publish completed missions with unresolved classification: ${unknown.join(', ')}.`); }
}
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!));

/** Stable, dependency-free SVG renderer; input is the committed snapshot only. */
export function renderVelocitySvg(snapshot: any): string {
  assertVelocitySnapshot(snapshot);
  const weeks: readonly VelocityWeek[] = snapshot.parallix.weeks;
  const width = 960, height = 480, left = 64, right = 32, top = 108, bottom = 80;
  const pw = width - left - right, ph = height - top - bottom;
  const baseline = snapshot.manualBaseline.unitsPerWeek as number;
  const peak = Math.max(1, baseline, ...weeks.map(w => w.completedCount));
  const magnitude = 10 ** Math.floor(Math.log10(peak / 4));
  const step = [1, 2, 5, 10].map(n => n * magnitude).find(n => n >= peak / 4)!;
  const maximum = Math.ceil(peak / step) * step;
  const y = (v: number) => top + ph - v / maximum * ph;
  const slot = pw / Math.max(1, weeks.length);
  const x = (i: number) => left + slot * (i + 0.5);
  const grid = Array.from({ length: Math.round(maximum / step) + 1 }, (_, i) => {
    const v = i * step;
    return `<path d="M${left} ${y(v)}H${width-right}" class="grid"/><text x="${left-14}" y="${y(v)+5}" text-anchor="end">${v}</text>`;
  }).join('');
  const stride = Math.max(1, Math.ceil(weeks.length / 7));
  const labels = weeks.map((w, i) => i % stride === 0 ? `<text x="${x(i)}" y="${height-48}" text-anchor="middle">${new Date(w.weekOf).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</text>` : '').join('');
  const bars = weeks.map((w, i) => `<rect x="${x(i)-slot*0.3}" y="${y(w.completedCount)}" width="${slot*0.6}" height="${y(0)-y(w.completedCount)}" rx="3" fill="#2563eb"><title>Week of ${esc(w.weekOf)}: ${w.completedCount} completed missions</title></rect>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">Weekly Parallix delivery throughput</title><desc id="desc">All completed Parallix missions per full UTC week, including user_value and ai_sdlc. Manual proxy: ${Math.round(baseline)} missions/week.</desc><style>text{font:14px system-ui,sans-serif;fill:#64748b}.grid{stroke:#e2e8f0;stroke-width:1}.heading{font-size:24px;font-weight:650;fill:#0f172a}.legend{font-size:13px}.baseline{stroke:#d97706;stroke-width:2;stroke-dasharray:6 5}</style><rect width="100%" height="100%" rx="12" fill="#ffffff"/><text x="${left}" y="38" class="heading">Parallix delivery throughput</text><text x="${left}" y="64">Completed missions / week</text><rect x="${left}" y="81" width="12" height="12" rx="2" fill="#2563eb"/><text x="${left+20}" y="92" class="legend">Parallix missions</text><path d="M${left+190} 87h28" class="baseline"/><text x="${left+226}" y="92" class="legend">Manual proxy: ${Math.round(baseline)} missions/week</text>${grid}${bars}<path d="M${left} ${y(baseline)}H${width-right}" class="baseline"/>${labels}<text x="${width/2}" y="${height-16}" text-anchor="middle">Week beginning (UTC Monday)</text></svg>\n`;
}
