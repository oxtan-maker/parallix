import fs from 'node:fs';
import path from 'node:path';

// Read retained Pi transcripts without printing prompts, tool results or credentials.
// Usage: node scripts/measure-pi-smoke.mjs /tmp/<retained-fixture>/pi-agent/sessions
const root = process.argv[2];
if (!root) { throw new Error('Pass the retained Pi sessions directory'); }
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : entry.name.endsWith('.jsonl') ? [target] : [];
  });
}
const sessions = files(root).map(file => {
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const messages = rows.filter(row => row.type === 'message').map(row => row.message);
  const userText = messages.filter(message => message.role === 'user')
    .flatMap(message => message.content).map(part => typeof part === 'string' ? part : part.text ?? '').join('\n');
  const phase = /Mode: draft/.test(userText) ? 'draft' : /Mode: execute/.test(userText) ? 'execute'
    : /Mode: review\./.test(userText) ? 'review' : 'other';
  const assistants = messages.filter(message => message.role === 'assistant');
  const tools = assistants.flatMap(message => message.content).filter(part => part.type === 'toolCall');
  const commands = tools.map(tool => tool.arguments?.command ?? '');
  const model = rows.find(row => row.type === 'model_change');
  return { file: path.basename(file), phase, runner: 'pi', provider: model?.provider, model: model?.modelId,
    reasoning: rows.find(row => row.type === 'thinking_level_change')?.thinkingLevel,
    model_calls: assistants.length, tool_calls: tools.length,
    output_tokens: assistants.reduce((sum, message) => sum + (message.usage?.output ?? 0), 0),
    elapsed_ms: Date.parse(rows.at(-1).timestamp) - Date.parse(rows[0].timestamp),
    status_reads: commands.filter(command => /(?:^|&&|;|\n)\s*(?:'[^']*\/px'|"[^"]*\/px"|px)\s+status(?:\s|$)/.test(command)).length,
    help_reads: commands.filter(command => /--help/.test(command)).length,
    gate_runs: commands.filter(command => /(?:^|&&|;|\n)\s*\.\/scripts\/verify-local\.sh/.test(command)).length };
}).sort((a, b) => a.file.localeCompare(b.file));
console.log(JSON.stringify({ sessions, total: Object.fromEntries(['model_calls', 'tool_calls', 'output_tokens', 'elapsed_ms']
  .map(key => [key, sessions.reduce((sum, session) => sum + session[key], 0)])) }, null, 2));
