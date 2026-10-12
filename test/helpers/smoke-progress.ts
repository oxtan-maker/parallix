import { scrubCredentials } from '../../src/application/recovery-evidence.js';

/** Forward only existing phase and tool presentation, never model prose/results. */
export function smokeProgress(write: (line: string) => void = line => process.stdout.write(line)) {
  let pending = '';
  let phase = 'starting';
  const line = (raw: string) => {
    const text = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();
    const next = /^.*Running \S+ to write the mission contract/.test(text) ? 'drafting'
      : (/^Launching execute agent/.test(text) || /^\[INFO\] Selected agent for step "active":/.test(text)
        || /^\[INFO\] Implementer:/.test(text)
        || /Round \d+: launching implementer \(/.test(text)) ? 'implementing'
      : /Round \d+: launching reviewer \(/.test(text) ? 'reviewing' : null;
    if (next) {
      phase = next;
      write(`[agent-smoke] phase=${phase} state=model\n`);
    } else if (/^⚒/.test(text)) {
      write(`[agent-smoke] phase=${phase} state=tool command=${scrubCredentials(text.slice(1).trim())}\n`);
    } else if (/^[✓✗●]/.test(text)) {
      write(`[agent-smoke] phase=${phase} state=model\n`);
    }
  };
  return {
    push(chunk: string) {
      pending += chunk;
      let cut: number;
      while ((cut = pending.indexOf('\n')) >= 0) {
        line(pending.slice(0, cut));
        pending = pending.slice(cut + 1);
      }
      // Model prose can be arbitrarily long; retain only a bounded partial line.
      if (pending.length > 8192) { pending = ''; }
    },
    end() { if (pending) { line(pending); } pending = ''; }
  };
}
