// `aymu login` (MCP_PROTOCOL 11; ARCHITECTURE ADR-14): OAuth 2.1 authorization code + PKCE through a loopback redirect
// (RFC 8252), resource `https://mcp.[DOMAIN]/install`, scope `cli:install offline_access`. The CLI binds
// `127.0.0.1:0`, opens the browser at `/authorize`, checks `state` and `iss` on return, and exchanges the code.
// Client identity: the first-party CIMD document `https://[DOMAIN]/cli/client-metadata.json`; against a loopback dev
// server (which cannot fetch CIMD documents, `global_fetch_strictly_public`) it registers through DCR instead.
// Token storage (SECURITY_MODEL 11 C4): no OS credential-store library is a dependency of this package, so tokens are
// kept in memory for this run only, and the CLI says so. Nothing is written to the project or the home directory.
import { randomToken, s256Challenge } from '@aymu/domain';
import { createServer } from 'node:http';
import { CliError, EXIT } from './errors';
import { isLoopbackOrigin, webOriginOf } from './config';
import type { Io } from './io';

export interface LoopbackListener {
  readonly port: number;
  /** Resolves with the callback query once the browser returns, or rejects on timeout. */
  waitForCallback(timeoutMs: number): Promise<URLSearchParams>;
  close(): Promise<void>;
}

export type ListenLoopback = () => Promise<LoopbackListener>;

/** The real listener: `127.0.0.1:0`, path `/callback`, one request, a short plain-text page. */
export const listenLoopback: ListenLoopback = () =>
  new Promise((resolveListener, reject) => {
    let deliver: ((q: URLSearchParams) => void) | null = null;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('You can close this tab and return to the terminal.\n');
      deliver?.(url.searchParams);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('no loopback port'));
        return;
      }
      resolveListener({
        port: address.port,
        waitForCallback: (timeoutMs) =>
          new Promise((res, rej) => {
            const timer = setTimeout(
              () => rej(new CliError(EXIT.access, 'login_timeout', 'Sign-in timed out.')),
              timeoutMs,
            );
            deliver = (q) => {
              clearTimeout(timer);
              res(q);
            };
          }),
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });

export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string | null;
}

async function clientIdFor(io: Io, origin: string, redirectUri: string): Promise<string> {
  if (!isLoopbackOrigin(origin)) return `${webOriginOf(origin)}/cli/client-metadata.json`;
  const res = await io.fetch(`${origin}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Aymu CLI (local development)',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'native',
    }),
  });
  if (!res.ok)
    throw new CliError(EXIT.access, 'registration_failed', 'Could not register the CLI with the local server.');
  const body = (await res.json()) as { client_id?: unknown };
  if (typeof body.client_id !== 'string')
    throw new CliError(EXIT.access, 'registration_failed', 'No client id returned.');
  return body.client_id;
}

export async function login(io: Io, origin: string, listen: ListenLoopback = listenLoopback): Promise<Session> {
  const listener = await listen();
  try {
    const redirectUri = `http://127.0.0.1:${listener.port}/callback`;
    const clientId = await clientIdFor(io, origin, redirectUri);
    const verifier = randomToken();
    const state = randomToken();
    const url = new URL('/authorize', origin);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'cli:install offline_access');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', await s256Challenge(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('resource', `${origin}/install`);
    io.err('Opening your browser to sign in. If it does not open, visit:');
    io.err(url.toString());
    await io.openBrowser(url.toString());
    const query = await listener.waitForCallback(5 * 60 * 1000);
    if (query.get('state') !== state) throw new CliError(EXIT.access, 'login_state', 'Sign-in state did not match.');
    // RFC 9207: the server advertises `authorization_response_iss_parameter_supported`, so `iss` is required (P11 CLI-3).
    if (query.get('iss') !== origin) {
      throw new CliError(EXIT.access, 'login_issuer', 'Sign-in came back from an unexpected issuer.');
    }
    if (query.get('error')) throw new CliError(EXIT.access, 'access_denied', 'Sign-in was declined.');
    const code = query.get('code');
    if (!code) throw new CliError(EXIT.access, 'login_failed', 'Sign-in returned no code.');
    const res = await io.fetch(`${origin}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        resource: `${origin}/install`,
      }).toString(),
    });
    if (!res.ok) throw new CliError(EXIT.access, 'login_failed', 'The token exchange failed.');
    const token = (await res.json()) as { access_token?: unknown; refresh_token?: unknown };
    if (typeof token.access_token !== 'string')
      throw new CliError(EXIT.access, 'login_failed', 'No access token returned.');
    io.err('Signed in. Tokens are kept in memory for this run only (no OS credential store is configured).');
    return {
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : null,
    };
  } finally {
    await listener.close();
  }
}
