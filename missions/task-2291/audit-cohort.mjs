import fs from 'node:fs';
import path from 'node:path';

const ledger = JSON.parse(fs.readFileSync('missions/task-2291/cohort-ledger.json', 'utf8'));
const cohort = ledger.cohort.map((r) => r.id);

const stores = ['backlog/tasks', 'backlog/completed', 'backlog/archive', 'backlog/archive/tasks'];
const files = [];
for (const s of stores) {
  if (!fs.existsSync(s)) continue;
  for (const f of fs.readdirSync(s)) {
    if (!f.endsWith('.md')) continue;
    const p = path.join(s, f);
    if (fs.statSync(p).isFile()) files.push(p);
  }
}

const warnings = [];
const aborts = [];
const byId = new Map();

for (const p of files) {
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split('\n');
  if (lines[0] !== '---') { continue; }
  const end = lines.indexOf('---', 1);
  if (end < 0) { warnings.push(`${p}: unterminated frontmatter`); continue; }
  const fm = lines.slice(1, end);
  const idLine = fm.findIndex((l) => /^id:\s*/.test(l));
  if (idLine < 0) { warnings.push(`${p}:1 missing id field`); continue; }
  const idRaw = fm[idLine].replace(/^id:\s*/, '').trim().replace(/^['"]|['"]$/g, '');
  if (!/^TASK-[0-9]+(\.[0-9]+)?$/.test(idRaw)) { aborts.push(`${p}:${idLine + 2} ambiguous id "${idRaw}"`); continue; }
  const fnMatch = path.basename(p).match(/^task-([0-9]+(?:\.[0-9]+)?) - /);
  if (!fnMatch) { warnings.push(`${p}: filename does not encode a task id`); }
  else if (`TASK-${fnMatch[1]}` !== idRaw) { aborts.push(`${p}:${idLine + 2} filename id TASK-${fnMatch[1]} != frontmatter id ${idRaw}`); continue; }

  // labels: block list under `labels:`
  const labels = [];
  const li = fm.findIndex((l) => /^labels:/.test(l));
  let labelLine = null;
  if (li >= 0) {
    labelLine = li + 2;
    const inline = fm[li].replace(/^labels:\s*/, '').trim();
    if (inline.startsWith('[')) {
      for (const part of inline.slice(1, -1).split(',')) {
        const v = part.trim().replace(/^['"]|['"]$/g, '');
        if (v) labels.push(v);
      }
    } else if (inline) {
      aborts.push(`${p}:${li + 2} unparseable labels scalar "${inline}"`);
      continue;
    } else {
      for (let i = li + 1; i < fm.length; i += 1) {
        const l = fm[i];
        if (/^\s+-\s+/.test(l)) labels.push(l.replace(/^\s+-\s+/, '').trim().replace(/^['"]|['"]$/g, ''));
        else if (/^\S/.test(l)) break;
        else if (l.trim() === '') continue;
        else { aborts.push(`${p}:${i + 2} unparseable label line "${l}"`); break; }
      }
    }
  }
  const statusLine = fm.findIndex((l) => /^status:/.test(l));
  const status = statusLine >= 0 ? fm[statusLine].replace(/^status:\s*/, '').trim() : null;

  if (!byId.has(idRaw)) byId.set(idRaw, []);
  byId.get(idRaw).push({ path: p, idLine: idLine + 2, labels, labelLine, status, statusLine: statusLine + 2, store: p.startsWith('backlog/completed') ? 'completed' : p.startsWith('backlog/archive') ? 'archive' : 'tasks' });
}

const rows = [];
for (const id of cohort) {
  const copies = byId.get(id) ?? [];
  if (copies.length === 0) { aborts.push(`${id}: no task record found in any store`); continue; }
  const union = new Set();
  for (const c of copies) for (const l of c.labels) union.add(l);
  const isBug = union.has('bug');
  const completedCopies = copies.filter((c) => c.store === 'completed');
  if (completedCopies.length === 0) aborts.push(`${id}: no completed-store copy at report time`);
  rows.push({
    id,
    copies: copies.length,
    copyPaths: copies.map((c) => `${c.path}:${c.idLine}`),
    labelUnion: [...union].sort(),
    labelEvidence: completedCopies[0] ? `${completedCopies[0].path}:${completedCopies[0].labelLine}` : null,
    statusEvidence: completedCopies[0] ? `${completedCopies[0].path}:${completedCopies[0].statusLine}` : null,
    status: completedCopies[0]?.status ?? null,
    bug: isBug,
  });
}

const bug = rows.filter((r) => r.bug);
const nonBug = rows.filter((r) => !r.bug);
const total = rows.length;

const result = {
  cutoff: ledger.boundary,
  total,
  bug: bug.length,
  nonBug: nonBug.length,
  bugOverTotal: bug.length / total,
  bugPer100NonBug: (100 * bug.length) / nonBug.length,
  baseline: { bug: 39, total: 129, nonBug: 90, bugOverTotal: 39 / 129, bugPer100NonBug: (100 * 39) / 90, source: 'docs/adr/0051-ui-neutral-application-boundary.md:79' },
  bugIds: bug.map((r) => r.id),
  nonBugIds: nonBug.map((r) => r.id),
  warnings,
  aborts,
  rows,
};
fs.writeFileSync('/tmp/2291_result.json', JSON.stringify(result, null, 2));
console.log('total', total, 'bug', bug.length, 'nonBug', nonBug.length);
console.log('bug/total', (100 * result.bugOverTotal).toFixed(1) + '%');
console.log('100*bug/nonBug', result.bugPer100NonBug.toFixed(1));
console.log('baseline 39/129 =', (100 * 39 / 129).toFixed(1) + '%', ' per100 =', (100 * 39 / 90).toFixed(1));
console.log('ABORTS', aborts);
console.log('WARNINGS', warnings);
console.log('bug ids', result.bugIds.join(', '));
console.log('multi-copy ids', rows.filter((r) => r.copies > 1).map((r) => `${r.id}(${r.copies})`));
