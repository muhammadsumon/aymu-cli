// Unit tests for the CLI's pure pieces: SemVer ranges (F1), the ZIP reader (D1–D3, E1), the server allowlist, argv
// parsing (C1), and the loopback PKCE sign-in (C19) against a fake authorization server.
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/args';
import { isLoopbackOrigin, resolveOrigin, webOriginOf } from '../src/config';
import { CliError } from '../src/errors';
import { login, type LoopbackListener } from '../src/login';
import { satisfies } from '../src/semver';
import { LIFECYCLE_SCRIPTS } from '@aymu/domain/manifest';
import { inflateEntry, readCentralDirectory, unixFileType, ZipFormatError } from '../src/zip';
import { tempDir, testIo, fakeServer } from './helpers';

describe('semver satisfies', () => {
  it.each([
    ['7.4.13', '>=7.4.0 <8', true],
    ['8.0.0', '>=7.4.0 <8', false],
    ['4.3.5', '>=4.0.0 <5', true],
    ['4.3.5', '^4.0.0', true],
    ['5.0.0', '^4.0.0', false],
    ['0.2.5', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['4.9.9', '4.x', true],
    ['22.23.4', '>=22.23.4', true],
    ['22.23.3', '>=22.23.4', false],
    ['7.4.13', '7.4.13', true],
    ['7.4.14', '7.4.13', false],
    ['2.0.0', '1.x || 2.x', true],
    ['1.5.0', '1.2.3 - 1.9', true],
    ['8.0.0-beta.1', '>=7.4.0 <8', false],
    ['not-a-version', '*', false],
  ])('%s in %s → %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });
});

describe('zip reader', () => {
  const opts = { level: 6 as const, mtime: new Date(1980, 0, 1), os: 3 };
  it('reads entries, file types and inflates under the declared size with a CRC check', () => {
    const zip = zipSync({
      'a.txt': [new TextEncoder().encode('hello hello hello'), { ...opts, attrs: 0o100644 << 16 }],
      link: [new TextEncoder().encode('target'), { ...opts, attrs: 0o120777 << 16 }],
    });
    const entries = readCentralDirectory(zip);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'link']);
    expect(entries.map(unixFileType)).toEqual(['regular', 'symlink']);
    expect(new TextDecoder().decode(inflateEntry(zip, entries[0] as never))).toBe('hello hello hello');
  });

  it('refuses a lying size, trailing data and a corrupted CRC', () => {
    const zip = zipSync({ 'a.txt': [new Uint8Array(1000), { ...opts, attrs: 0o100644 << 16 }] });
    const [entry] = readCentralDirectory(zip);
    if (!entry) throw new Error('no entry');
    expect(() => inflateEntry(zip, { ...entry, uncompressedSize: 10 })).toThrow(ZipFormatError);
    expect(() => readCentralDirectory(new Uint8Array([...zip, 0]))).toThrow(ZipFormatError);
    const broken = zip.slice();
    const view = new DataView(broken.buffer);
    // corrupt the CRC in both headers
    const cen = broken.length - 22 - (46 + 5);
    view.setUint32(14, 0xdeadbeef, true);
    view.setUint32(cen + 16, 0xdeadbeef, true);
    const [e2] = readCentralDirectory(broken);
    expect(() => inflateEntry(broken, e2 as never)).toThrow(/CRC/);
  });
});

describe('argv and the server allowlist', () => {
  it('refuses grant codes in argv for every command', () => {
    expect(() => parseArgs(['list', `ig_${'x'.repeat(43)}`])).toThrow(CliError);
    expect(() =>
      parseArgs(['add', 'section', 'sec_01m81kk5xp6dr9y8v02bw8dha2', `--dir=igf_${'y'.repeat(43)}`]),
    ).toThrow(/command-line argument/);
  });

  it('accepts only loopback overrides and derives the web origin', () => {
    expect(isLoopbackOrigin('http://127.0.0.1:8770')).toBe(true);
    expect(isLoopbackOrigin('https://evil.example')).toBe(false);
    expect(isLoopbackOrigin('http://localhost.evil.example')).toBe(false);
    expect(resolveOrigin('http://localhost:8770', {})).toBe('http://localhost:8770');
    expect(() => resolveOrigin(undefined, { AYMU_MCP_ORIGIN: 'https://mcp.evil.example' })).toThrow(/loopback/);
    expect(() => resolveOrigin(undefined, {})).toThrow(/no server configured/);
    expect(webOriginOf('https://mcp.example.com')).toBe('https://example.com');
  });
});

describe('C19 aymu login (loopback PKCE)', () => {
  it('registers (loopback dev), opens /authorize with S256, checks state, and exchanges the code; nothing persisted', async () => {
    const server = fakeServer();
    const seen: { authorize?: URL; token?: URLSearchParams } = {};
    const origin = 'http://127.0.0.1:8770';
    const io = await testIo({ cwd: await tempDir('login'), server, keyring: [] });
    const fetcher: typeof fetch = (input, init) => Promise.resolve(route(input, init));
    const route = (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): Response => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === '/oauth/register')
        return new Response(JSON.stringify({ client_id: 'client-1' }), { status: 201 });
      if (url.pathname === '/token') {
        seen.token = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
        return new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', token_type: 'bearer' }), {
          status: 200,
        });
      }
      return new Response('nope', { status: 404 });
    };
    let deliver: (q: URLSearchParams) => void = () => {};
    const listener: LoopbackListener = {
      port: 54321,
      waitForCallback: () => new Promise((res) => (deliver = res)),
      close: () => Promise.resolve(),
    };
    const session = login(
      {
        ...io,
        fetch: fetcher,
        openBrowser: (url) => {
          seen.authorize = new URL(url);
          // The "browser": consent, sign-in, then the redirect back with code, state and iss.
          setTimeout(() =>
            deliver(
              new URLSearchParams({
                code: 'the-code',
                state: seen.authorize?.searchParams.get('state') ?? '',
                iss: origin,
              }),
            ),
          );
          return Promise.resolve(true);
        },
      },
      origin,
      () => Promise.resolve(listener),
    );
    await expect(session).resolves.toEqual({ accessToken: 'at', refreshToken: 'rt' });
    const a = seen.authorize as URL;
    expect(a.pathname).toBe('/authorize');
    expect(a.searchParams.get('resource')).toBe(`${origin}/install`);
    expect(a.searchParams.get('scope')).toBe('cli:install offline_access');
    expect(a.searchParams.get('code_challenge_method')).toBe('S256');
    expect(a.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:54321/callback');
    const verifier = seen.token?.get('code_verifier') ?? '';
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(a.searchParams.get('code_challenge'));
    expect(seen.token?.get('resource')).toBe(`${origin}/install`);
    expect(io.stderr.join(' ')).toContain('memory for this run only');
  });

  it('a mismatched state is refused', async () => {
    const io = await testIo({ cwd: await tempDir('login2'), server: fakeServer(), keyring: [] });
    const listener: LoopbackListener = {
      port: 1,
      waitForCallback: () => Promise.resolve(new URLSearchParams({ code: 'c', state: 'wrong' })),
      close: () => Promise.resolve(),
    };
    const fetcher: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ client_id: 'c' }), { status: 201 }));
    await expect(
      login({ ...io, fetch: fetcher }, 'http://127.0.0.1:8770', () => Promise.resolve(listener)),
    ).rejects.toMatchObject({
      code: 'login_state',
    });
  });
});

describe('C19 aymu login: RFC 9207 issuer (P11 CLI-3)', () => {
  // The authorization server advertises `authorization_response_iss_parameter_supported`, so every response, errors
  // included, carries `iss`. A response without it, or from another issuer, is refused before the code is used.
  it.each([
    ['a missing iss', {}],
    ['another issuer', { iss: 'http://127.0.0.1:9999' }],
  ])('%s is refused', async (_label, extra: Record<string, string>) => {
    const io = await testIo({ cwd: await tempDir('login-iss'), server: fakeServer(), keyring: [] });
    let tokenCalled = false;
    let deliver: (q: URLSearchParams) => void = () => {};
    const listener: LoopbackListener = {
      port: 2,
      waitForCallback: () => new Promise((res) => (deliver = res)),
      close: () => Promise.resolve(),
    };
    const fetcher: typeof fetch = (input) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === '/token') tokenCalled = true;
      return Promise.resolve(new Response(JSON.stringify({ client_id: 'c' }), { status: 201 }));
    };
    await expect(
      login(
        {
          ...io,
          fetch: fetcher,
          openBrowser: (url) => {
            const state = new URL(url).searchParams.get('state') ?? '';
            setTimeout(() => deliver(new URLSearchParams({ code: 'c', state, ...extra })));
            return Promise.resolve(true);
          },
        },
        'http://127.0.0.1:8770',
        () => Promise.resolve(listener),
      ),
    ).rejects.toMatchObject({ code: 'login_issuer' });
    expect(tokenCalled).toBe(false);
  });
});

describe('TM-ZIP-5 / SECURITY_MODEL 11 V7: lifecycle hooks the CLI refuses', () => {
  it('are every hook SECURITY_MODEL names', () => {
    expect([...LIFECYCLE_SCRIPTS].sort()).toEqual(
      [
        'preinstall',
        'install',
        'postinstall',
        'preprepare',
        'prepare',
        'postprepare',
        'prepublish',
        'prepublishOnly',
        'prepack',
        'postpack',
        'preuninstall',
        'uninstall',
        'postuninstall',
        'dependencies',
      ].sort(),
    );
  });
});
