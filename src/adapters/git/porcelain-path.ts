// git status --porcelain wraps any path containing a space or other unusual
// byte in double quotes and C-escapes the contents (\\, \", \t, \n, \r, and
// \NNN octal for bytes >= 0x80 under the default core.quotePath). Those quotes
// and escapes are display syntax, not part of the on-disk path, so they must be
// decoded before the value is handed to `git add --` — otherwise git treats the
// quote-wrapped string as a pathspec that matches no file and aborts staging.

export function unquoteGitStatusPath(rawPath: string) {
  if (rawPath.length < 2 || rawPath[0] !== '"' || rawPath[rawPath.length - 1] !== '"') {
    return rawPath;
  }
  const inner = rawPath.slice(1, -1);
  const simple = { a: 0x07, b: 0x08, t: 0x09, n: 0x0a, v: 0x0b, f: 0x0c, r: 0x0d, '"': 0x22, '\\': 0x5c };
  const chunks: Buffer[] = [];
  let literal = '';
  const flush = () => {
    if (literal) {
      chunks.push(Buffer.from(literal, 'utf8'));
      literal = '';
    }
  };
  let offset = 0;
  while (offset < inner.length) {
    const ch = inner[offset];
    if (ch !== '\\') {
      literal += ch;
      offset++;
      continue;
    }
    const next = inner[offset + 1];
    if (next >= '0' && next <= '7') {
      const { octal, end } = readOctalEscape(inner, offset + 1);
      flush();
      chunks.push(Buffer.from([Number.parseInt(octal, 8) & 0xff]));
      offset = end;
      continue;
    }
    const decoded = decodeSimpleEscape(simple, next);
    if (decoded === null) { literal += next === undefined ? '\\' : next; offset += 1 + Number(next !== undefined); }
    else { flush(); chunks.push(Buffer.from([decoded])); offset += 2; }
  }
  flush();
  return Buffer.concat(chunks).toString('utf8');
}

function readOctalEscape(text: string, start: number) {
  let end = start;
  while (end < text.length && end - start < 3 && text[end] >= '0' && text[end] <= '7') { end++; }
  return { octal: text.slice(start, end), end };
}

function decodeSimpleEscape(simple: Record<string, number>, value: string) {
  return Object.prototype.hasOwnProperty.call(simple, value) ? simple[value] : null;
}
