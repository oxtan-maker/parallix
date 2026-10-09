import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import fs from 'node:fs';
import path from 'node:path';
import { isSea } from 'node:sea';
import { createHash, randomUUID } from 'node:crypto';
import { resolveParallixHome } from './storage.js';

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

/** Child agents invoking `px` must use the CLI that launched them. */
export function pinChildCli(
  entry: string,
  options: { node?: string; nodeArgs?: readonly string[]; stateHome?: string; env?: NodeJS.ProcessEnv; native?: boolean; configuration?: ParallixConfiguration } = {},
): string {
  const configuration = options.configuration ?? DEFAULT_CONFIGURATION;
  const childEnvironment = options.env ?? { ...configuration.forwardedEnvironment };
  const command = (options.native ?? isSea())
    ? [options.node ?? process.execPath]
    : [options.node ?? process.execPath, ...(options.nodeArgs ?? process.execArgv), path.resolve(entry)];
  const content = `#!/bin/sh\nexec ${command.map(shellQuote).join(' ')} "$@"\n`;
  const identity = createHash('sha256').update(content).digest('hex');
  const directory = path.join(options.stateHome ?? resolveParallixHome({ ensureDir: true, configuration }), 'cli', identity);
  const wrapper = path.join(directory, 'px');
  if (!fs.existsSync(wrapper) || fs.readFileSync(wrapper, 'utf8') !== content) {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${wrapper}.${process.pid}.${randomUUID()}`;
    fs.writeFileSync(temporary, content, { mode: 0o700 });
    fs.renameSync(temporary, wrapper);
  }
  childEnvironment.PATH = [directory, ...configuration.agents.searchPath.split(path.delimiter).filter(part => part !== directory)].join(path.delimiter);
  childEnvironment.PARALLIX_CLI_ENTRYPOINT = command.at(-1);
  childEnvironment.PARALLIX_CLI_COMMAND = wrapper;
  return wrapper;
}
