import * as http from 'node:http';
import * as https from 'node:https';
import { spawnSync } from 'node:child_process';
import type { IncomingMessage } from 'node:http';
import { resolveForgejoSettings } from './forgejo-auth.js';
import type { ForgejoApiOptions, ForgejoApiResult } from './forgejo-types.js';

export type { ForgejoApiCall, ForgejoApiOptions, ForgejoApiResult, ForgejoAsyncApiCall } from './forgejo-types.js';

const HTTP_REQUEST_TIMEOUT = 5000;

function codexSandboxHint(): string {
  return 'Codex runtime cannot reach local Forgejo from Node subprocesses. Use the repo-local Codex config/profile that allows the workflow network path.';
}

/**
 * Synchronous Forgejo API call via Curl.
 *
 * `T` names the endpoint's response payload; the parsed JSON body is validated
 * against it only by the caller's own narrowing, so callers must keep the
 * endpoint type honest.
 */
function forgejoApi<T = unknown>(
  method: string,
  apiPath: string,
  token: string | undefined,
  body?: unknown,
  options: ForgejoApiOptions = {}
): ForgejoApiResult<T> {
  const { rootDir = process.cwd() } = options;
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir, options.configuration);
  const url = `${forgejoUrl}/api/v1/repos/${forgejoRepo}${apiPath}`;
  const args = ['-s', '-X', method,
    '-H', `Authorization: token ${token}`,
    '-H', 'Content-Type: application/json',
    '-w', '\\n%{http_code}'
  ];

  if (body) {
    args.push('--data-binary', '@-');
  }
  args.push(url);

  const result = spawnSync('curl', args, {
    encoding: 'utf8',
    input: body ? JSON.stringify(body) : undefined
  });

  if (result.status !== 0 || !result.stdout) {
    return {
      ok: false,
      data: null,
      status: result.status,
      statusCode: null,
      stderr: result.stderr,
      error: result.status === 7 ? codexSandboxHint() : null
    };
  }

  const output = result.stdout.trim();
  const lastLineIndex = output.lastIndexOf('\n');
  const statusCodeStr = lastLineIndex === -1 ? output : output.substring(lastLineIndex + 1);
  const responseBody = lastLineIndex === -1 ? '' : output.substring(0, lastLineIndex).trim();

  const statusCode = parseInt(statusCodeStr, 10);

  let data: T | null = null;
  if (responseBody) {
    try {
      data = JSON.parse(responseBody) as T;
    } catch (_) {
      // Not JSON
    }
  }

  return {
    ok: statusCode >= 200 && statusCode < 300,
    data,
    status: result.status,
    statusCode,
    stderr: result.stderr || null,
    error: null
  };
}

/**
 * Asynchronous Forgejo API call via Node http/https.
 */
async function forgejoApiAsync<T = unknown>(
  method: string,
  apiPath: string,
  token: string | undefined,
  body?: unknown,
  options: ForgejoApiOptions = {}
): Promise<ForgejoApiResult<T>> {
  const {
    rootDir = process.cwd(),
    timeout = HTTP_REQUEST_TIMEOUT
  } = options;
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir, options.configuration);

  const url = new URL(`${forgejoUrl}/api/v1/repos/${forgejoRepo}${apiPath}`);
  const transport = url.protocol === 'https:' ? https : http;
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ForgejoApiResult<T>) => {
      if (settled) { return; }
      settled = true;
      resolve(result);
    };

    const req = transport.request(url, {
      method,
      timeout,
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res: IncomingMessage) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string | Buffer) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        let data: T | null = null;
        if (responseBody) {
          try {
            data = JSON.parse(responseBody) as T;
          } catch (_) {
            data = null;
          }
        }
        finish({
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          data,
          status: 0,
          statusCode: res.statusCode ?? null,
          stderr: null,
          error: null
        });
      });
    });

    req.on('error', (error: Error & { code?: string }) => {
      finish({
        ok: false,
        data: null,
        status: null,
        statusCode: null,
        stderr: error.message || null,
        error: ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(error.code || '') ? codexSandboxHint() : null
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('request timeout'));
      finish({
        ok: false,
        data: null,
        status: null,
        statusCode: null,
        stderr: 'request timeout',
        error: null
      });
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

export { forgejoApi, forgejoApiAsync };
export { HTTP_REQUEST_TIMEOUT, codexSandboxHint };
