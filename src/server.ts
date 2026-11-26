// The CLI's side of the install exchange (MCP_PROTOCOL 10.3–10.6): /install/prepare (interactive path), the grant
// redemption, the item fetch with the redemption-bound fetch key, and the report. Responses are validated with the
// domain contracts. The grant code, verifier, fetch key and tokens are request data only: never logged or persisted.
import {
  InstallPrepareHttpResponse,
  type InstallReport,
  RECOMMENDED_CLI_VERSION,
  RedeemResponse,
  RedeemResponseItem,
  type PrepareInstallInput,
} from '@aymu/domain';
import { z } from 'zod';

// The contracts type every URL as https. A loopback development server (the only other origin the CLI accepts, see
// config.ts) answers with http URLs, so URLs are read as strings here and then pinned to the server's own origin.
const RedeemBody = RedeemResponse.extend({
  items: z.array(RedeemResponseItem.extend({ manifestUrl: z.string(), objectUrl: z.string() })).min(1),
});
const PrepareBody = InstallPrepareHttpResponse.extend({
  grant: InstallPrepareHttpResponse.shape.grant.extend({ redeemUrl: z.string() }),
});
import { CliError, EXIT, accessError } from './errors';

export interface ServerClient {
  readonly origin: string;
  readonly fetch: typeof fetch;
}

const ACCESS_CODES = new Set([
  'auth_required',
  'email_unverified',
  'account_banned',
  'account_closed',
  'account_restricted',
  'no_entitlement',
  'not_in_plan',
  'entitlement_not_started',
  'entitlement_expired',
  'entitlement_revoked',
  'subscription_paused',
  'billing_past_due',
  'quota_exhausted',
  'fair_use_exceeded',
  'release_revoked',
  'release_unavailable',
  'variant_unavailable',
  'not_found',
  'invalid_grant',
  'invalid_fetch_key',
  'rate_limited',
  'config_missing',
]);

const MESSAGES: Record<string, string> = {
  invalid_grant:
    'The install grant is not valid (expired, already used, or made for another verifier). Ask the agent to prepare a new one.',
  invalid_fetch_key: 'The download window for this install closed. Ask the agent to prepare a new install.',
  quota_exhausted: 'You have no install credits left this period. Nothing was installed.',
  fair_use_exceeded: "You reached today's fair-use limit. Try again after midnight UTC.",
  entitlement_expired: 'Your access to this item has ended. Nothing was installed.',
  rate_limited: 'The server is rate limiting requests. Wait a minute and try again.',
};

async function errorFrom(res: Response): Promise<CliError> {
  let code = `http_${res.status}`;
  let message = `The server answered ${res.status}.`;
  try {
    const body = (await res.json()) as { error?: { code?: unknown; message?: unknown } };
    if (typeof body.error?.code === 'string') code = body.error.code;
    if (typeof body.error?.message === 'string') message = body.error.message.slice(0, 300);
  } catch {
    // not JSON: keep the status
  }
  const text = MESSAGES[code] ?? message;
  return ACCESS_CODES.has(code) ? accessError(code, text) : new CliError(EXIT.other, code, text);
}

export async function redeem(
  server: ServerClient,
  grantCode: string,
  verifier: string,
): Promise<z.infer<typeof RedeemBody>> {
  const res = await server.fetch(`${server.origin}/grants/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ grantCode, verifier, client: { name: 'aymu', version: RECOMMENDED_CLI_VERSION } }),
    redirect: 'error',
  });
  if (!res.ok) throw await errorFrom(res);
  const parsed = RedeemBody.safeParse(await res.json());
  if (!parsed.success)
    throw new CliError(EXIT.other, 'bad_response', 'The server sent an unexpected redemption response.');
  for (const item of parsed.data.items) {
    for (const url of [item.manifestUrl, item.objectUrl]) {
      if (!url.startsWith(`${server.origin}/grants/`)) {
        throw new CliError(EXIT.other, 'bad_response', 'The redemption response points outside the server.');
      }
    }
  }
  return parsed.data;
}

/** Downloads one URL with the fetch key, refusing more than `maxBytes` while streaming (B2, B3). */
export async function fetchBytes(
  server: ServerClient,
  url: string,
  fetchKey: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const res = await server.fetch(url, { headers: { authorization: `Bearer ${fetchKey}` }, redirect: 'error' });
  if (!res.ok || !res.body) throw await errorFrom(res);
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes)
    throw new CliError(EXIT.verification, 'limit_exceeded', 'The download is larger than allowed.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const value of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += value.length;
    if (total > maxBytes) {
      throw new CliError(EXIT.verification, 'limit_exceeded', 'The download is larger than allowed.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** H1: best effort; never changes local state, and a failure only prints a warning. */
export async function report(
  server: ServerClient,
  installId: string,
  fetchKey: string,
  body: InstallReport,
): Promise<boolean> {
  try {
    const res = await server.fetch(`${server.origin}/grants/${installId}/report`, {
      method: 'POST',
      headers: { authorization: `Bearer ${fetchKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'error',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** MCP_PROTOCOL 10.3: the interactive CLI's prepare with a `cli:install` access token. */
export async function prepareInteractive(
  server: ServerClient,
  accessToken: string,
  input: z.input<typeof PrepareInstallInput>,
): Promise<z.infer<typeof PrepareBody>> {
  const res = await server.fetch(`${server.origin}/install/prepare`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(input),
    redirect: 'error',
  });
  if (!res.ok) throw await errorFrom(res);
  const parsed = PrepareBody.safeParse(await res.json());
  if (!parsed.success)
    throw new CliError(EXIT.other, 'bad_response', 'The server sent an unexpected prepare response.');
  return parsed.data;
}
