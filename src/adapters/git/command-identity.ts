import path from 'node:path';

// Presentation only: never parse or rewrite the arguments passed to the process.
// Hide the whole text on credential indicators rather than guessing where a
// shell-quoted secret ends. Git arguments are never displayed.
function readable(value: string): string {
  if (/:\/\/[^\s/]*@|(?:token|password|passwd|secret|authorization|api[-_]?key|credential|extraheader|cookie|access[-_]?key[-_]?id)["']?\s*(?:[=:]|\s)|(?:^|\s)(?:-u(?:\s|[^\s]+)|--user(?:=|\s))|\bBearer\s/i.test(value)) {
    return '[redacted sensitive command]';
  }
  return JSON.stringify(value).slice(1, -1)
    .replace(/[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
      character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function scriptIdentity(script: string): string {
  const display = readable(script);
  return /[\s"\\]/.test(script) ? `"${display}"` : display;
}

export function commandProgressLabel(command: string, args: string[], explicit?: string): string {
  const executable = path.basename(command);
  let identity = readable(executable);
  if (executable === 'bash') {
    for (let index = 0; index < args.length; index++) {
      const argument = args[index];
      if (argument === '--') {
        if (args[index + 1]) { identity += ` ${scriptIdentity(args[index + 1])}`; }
        break;
      }
      if (/^-[^-]*c/.test(argument)) {
        identity += ` ${readable(argument)} "${readable(args[index + 1] ?? '')}"`;
        break;
      }
      if (['-o', '-O', '--rcfile', '--init-file'].includes(argument)) { index++; continue; }
      if (!argument.startsWith('-')) { identity += ` ${scriptIdentity(argument)}`; break; }
    }
  }
  return explicit === undefined
    ? `External command: ${identity}`
    : `${readable(explicit)}: ${identity}`;
}
