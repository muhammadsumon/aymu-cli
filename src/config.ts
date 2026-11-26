// Which server the CLI talks to (ARCHITECTURE ADR-76). The production origin is fixed at build time
// (`AYMU_MCP_ORIGIN` when the package is built, `https://mcp.[DOMAIN]` until the owner sets the domain). It can be
// overridden only with a loopback origin (`--server http://127.0.0.1:8770`, or `AYMU_MCP_ORIGIN` at run time) for
// local development: a prompt-injected agent must never be able to point the CLI, and with it the grant code and the
// verifier, at another host.
import { CliError, EXIT } from './errors';

declare const __AYMU_MCP_ORIGIN__: string | undefined;

/** The origin baked into this build. */
export const BUILT_IN_ORIGIN: string =
  typeof __AYMU_MCP_ORIGIN__ === 'string' && __AYMU_MCP_ORIGIN__ !== '' ? __AYMU_MCP_ORIGIN__ : 'https://mcp.[DOMAIN]';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLoopbackOrigin(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK.has(u.hostname) && u.pathname === '/';
  } catch {
    return false;
  }
}

function isConfigured(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === 'https:' && !u.hostname.includes('[') && u.pathname === '/';
  } catch {
    return false;
  }
}

/** `--server` beats the run-time env; both must be loopback. Otherwise the built-in origin, which must be real. */
export function resolveOrigin(flag: string | undefined, env: Readonly<Record<string, string | undefined>>): string {
  const override = flag ?? env.AYMU_MCP_ORIGIN;
  if (override !== undefined && override !== '') {
    if (!isLoopbackOrigin(override)) {
      throw new CliError(
        EXIT.other,
        'server_not_allowed',
        'Only a loopback server (http://127.0.0.1:<port> or http://localhost:<port>) may replace the built-in server.',
      );
    }
    return new URL(override).origin;
  }
  if (!isConfigured(BUILT_IN_ORIGIN)) {
    throw new CliError(EXIT.other, 'config_missing', 'This build of the CLI has no server configured yet.');
  }
  return new URL(BUILT_IN_ORIGIN).origin;
}

/** The website origin for a server origin: `https://mcp.example.com` → `https://example.com`. */
export function webOriginOf(mcpOrigin: string): string {
  const u = new URL(mcpOrigin);
  if (u.hostname.startsWith('mcp.')) u.hostname = u.hostname.slice(4);
  return u.origin;
}
