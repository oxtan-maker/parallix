import * as http from 'node:http';
import * as https from 'node:https';
import { spawnSync } from 'node:child_process';
import { resolveForgejoSettings } from './forgejo-auth.js';

const HTTP_REQUEST_TIMEOUT = 5000;

function codexSandboxHint(): string {
  return 'Codex runtime cannot reach local Forgejo from Node subprocesses. Use the repo-local Codex config/profile that allows the workflow network path.';
}

/**
 * Synchronous Forgejo API call via Curl.
 *
 * @param {string} method
 * @param {string} apiPath
 * @param {string} token
 * @param {object} [body]
 * @param {{rootDir?: string}} [options]
 * @returns {{ok: boolean, data: any, status: number|null, statusCode: number|null, stderr: string|null, error: string|null}}
 */
function forgejoApi(
  method: string,
  apiPath: string,
  token: string,
  body: any,
  options: any = {}
): { ok: boolean, data: any, status: number | null, statusCode: number | null, stderr: string | null, error: string | null } {
  const { rootDir = process.cwd() } = options;
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir);
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

  let data = null;
  if (responseBody) {
    try {
      data = JSON.parse(responseBody);
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
 *
 * @param {string} method
 * @param {string} apiPath
 * @param {string} token
 * @param {object} [body]
 * @param {{rootDir?: string, timeout?: number}} [options]
 * @returns {Promise<{ok: boolean, data: any, status: number|null, statusCode: number|null, stderr: string|null, error: string|null}>}
 */
async function forgejoApiAsync(
  method: string,
  apiPath: string,
  token: string,
  body: any,
  options: any = {}
): Promise<{ ok: boolean, data: any, status: number | null, statusCode: number | null, stderr: string | null, error: string | null }> {
  const {
    rootDir = process.cwd(),
    timeout = HTTP_REQUEST_TIMEOUT
  } = options;
  const { url: forgejoUrl, repo: forgejoRepo } = resolveForgejoSettings(rootDir);

  const url = new URL(`${forgejoUrl}/api/v1/repos/${forgejoRepo}${apiPath}`);
  const transport = url.protocol === 'https:' ? https : http;
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: any) => {
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
    }, (res: any) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: any) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        let data = null;
        if (responseBody) {
          try {
            data = JSON.parse(responseBody);
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

    req.on('error', (error: any) => {
      finish({
        ok: false,
        data: null,
        status: null,
        statusCode: null,
        stderr: error.message || null,
        error: ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes((error as { code?: string }).code || '') ? codexSandboxHint() : null
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
