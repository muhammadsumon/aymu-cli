// Test harness for the CLI suite (TEST_PLAN 13): a temporary Astro project on the real file system, an in-memory
// fake of the aymu-mcp grant endpoints that speaks the domain contracts (`RedeemResponse`, the report body), an `Io`
// that captures output, and a tree hash to prove "nothing written".
import { type InstallReport, type RedeemResponse, randomToken } from '@aymu/domain';
import type { KeyringEntry } from '@aymu/domain/manifest';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { z } from 'zod';
import type { Io } from '../src/io';
import type { BuiltRelease } from './fixtures/releases';

export const ORIGIN = 'http://127.0.0.1:8770';

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `aymu-cli-${prefix}-`));
}

/** A fresh Astro + Tailwind v4 project with installed package metadata (no real node_modules needed). */
export async function astroProject(versions: { astro?: string; tailwindcss?: string } = {}): Promise<string> {
  const root = await tempDir('project');
  const astro = versions.astro ?? '7.4.13';
  const tailwind = versions.tailwindcss ?? '4.3.5';
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'site', private: true, type: 'module', dependencies: { astro }, devDependencies: { tailwindcss: tailwind } }, null, 2)}\n`,
  );
  await writeFile(join(root, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\n`);
  for (const [name, version] of [
    ['astro', astro],
    ['tailwindcss', tailwind],
  ] as const) {
    await mkdir(join(root, 'node_modules', name), { recursive: true });
    await writeFile(join(root, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
  }
  await mkdir(join(root, 'src', 'pages'), { recursive: true });
  await writeFile(join(root, 'src', 'pages', 'index.astro'), '<h1>Site</h1>\n');
  return root;
}

/** SHA-256 over every path, type, link target and file content under `dir` (node_modules included). */
export async function treeHash(dir: string): Promise<string> {
  const h = createHash('sha256');
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = (await readdir(d, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    } catch {
      h.update('missing');
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      const rel = relative(dir, full);
      if (e.isSymbolicLink()) h.update(`L ${rel} -> ${await readlink(full)}\n`);
      else if (e.isDirectory()) {
        h.update(`D ${rel}\n`);
        await walk(full);
      } else {
        h.update(`F ${rel} ${(await lstat(full)).mode & 0o777}\n`);
        h.update(await readFile(full));
      }
    }
  }
  await walk(dir);
  return h.digest('hex');
}

export interface FakeServer {
  readonly fetch: typeof fetch;
  readonly requests: { method: string; path: string; body: string | null }[];
  readonly reports: InstallReport[];
  /** Registers a grant; returns the code. The server answers redeem with these items. */
  grant(items: BuiltRelease[], options?: GrantOptions): string;
  /** Status list served at /release-keys.json (default: unreachable 404). */
  keyStatus: { keyId: string; status: 'active' | 'compromised' }[] | null;
}

export interface GrantOptions {
  readonly challenge?: string;
  /** Answer redeem with this error instead (403 quota_exhausted, 400 invalid_grant, …). */
  readonly redeemError?: { status: number; code: string };
  /** What the server claims about the manifest (a compromised server lying about hashes). */
  readonly claimManifestSha256?: string;
  readonly selectionId?: string;
}

/** An in-memory fake of POST /grants/redeem, GET /grants/{id}/items/{n}[/manifest], POST …/report. */
export function fakeServer(): FakeServer {
  const grants = new Map<
    string,
    { items: BuiltRelease[]; options: GrantOptions; redeemed: boolean; installId: string; fetchKey: string }
  >();
  const byInstall = new Map<string, { items: BuiltRelease[]; fetchKey: string }>();
  const requests: FakeServer['requests'] = [];
  const reports: InstallReport[] = [];
  const server: FakeServer = {
    requests,
    reports,
    keyStatus: null,
    grant(items, options = {}) {
      const code = randomToken('ig_');
      const installId = `ins_01m81kk5xp${String(grants.size).padStart(16, '0')}`;
      grants.set(code, { items, options, redeemed: false, installId, fetchKey: randomToken('igf_') });
      return code;
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- a fetch implementation must return a Promise
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : null;
      requests.push({ method, path: url.pathname, body });
      const json = (v: unknown, status = 200) =>
        new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
      if (url.pathname === '/release-keys.json') {
        if (!server.keyStatus) return new Response('not found', { status: 404 });
        return json({
          keysVersion: 1,
          generatedAt: '2026-11-22T12:00:00.000Z',
          keys: server.keyStatus.map((k) => ({
            keyId: k.keyId,
            algorithm: 'Ed25519',
            publicKey: 'A'.repeat(43) + '=',
            status: k.status,
            compromisedAt: k.status === 'compromised' ? '2026-11-22T12:00:00.000Z' : null,
          })),
        });
      }
      if (url.pathname === '/health') return json({ status: 'ok', db: 'ok' });
      if (url.pathname === '/grants/redeem' && method === 'POST') {
        const req = JSON.parse(body ?? '{}') as { grantCode: string; verifier: string };
        const g = grants.get(req.grantCode);
        if (!g) return json({ error: { code: 'invalid_grant', message: 'x', retryable: false } }, 400);
        if (g.options.redeemError) {
          return json(
            { error: { code: g.options.redeemError.code, message: 'denied', retryable: false } },
            g.options.redeemError.status,
          );
        }
        if (g.redeemed) return json({ error: { code: 'invalid_grant', message: 'x', retryable: false } }, 400);
        if (g.options.challenge) {
          const digest = createHash('sha256').update(req.verifier).digest('base64url');
          if (digest !== g.options.challenge)
            return json({ error: { code: 'invalid_grant', message: 'x', retryable: false } }, 400);
        }
        g.redeemed = true;
        byInstall.set(g.installId, { items: g.items, fetchKey: g.fetchKey });
        const response: z.infer<typeof RedeemResponse> = {
          installId: g.installId as never,
          status: 'redeemed',
          channel: 'mcp',
          selectionId: (g.options.selectionId ?? null) as never,
          fetchKey: g.fetchKey,
          fetchExpiresAt: '2026-11-22T13:01:00.000Z',
          creditsConsumed: 1,
          items: g.items.map((r, position) => ({
            position,
            releaseId: r.releaseId as never,
            productId: r.productId as never,
            productKind: r.productKind,
            variantKind: r.variantKind,
            slug: r.slug,
            version: r.version,
            manifestSha256: g.options.claimManifestSha256 ?? r.manifestSha256,
            objectSha256: r.objectSha256,
            objectSizeBytes: r.objectBytes.length,
            manifestUrl: `${ORIGIN}/grants/${g.installId}/items/${position}/manifest`,
            objectUrl: `${ORIGIN}/grants/${g.installId}/items/${position}`,
          })),
        };
        return json(response);
      }
      const m = /^\/grants\/(ins_[0-9a-z]+)\/(?:items\/(\d+)(\/manifest)?|(report))$/.exec(url.pathname);
      if (m) {
        const install = byInstall.get(m[1] ?? '');
        const auth = new Headers(init?.headers).get('authorization');
        if (!install || auth !== `Bearer ${install.fetchKey}`)
          return json({ error: { code: 'invalid_fetch_key', message: 'x' } }, 401);
        if (m[4] === 'report') {
          reports.push(JSON.parse(body ?? '{}') as InstallReport);
          return json({ status: 'confirmed', recorded: true });
        }
        const item = install.items[Number(m[2])];
        if (!item) return json({ error: { code: 'invalid_fetch_key', message: 'x' } }, 401);
        const bytes = m[3] ? item.manifestBytes : item.objectBytes;
        return new Response(bytes.slice().buffer, { status: 200, headers: { 'content-length': String(bytes.length) } });
      }
      return json({ error: { code: 'not_found', message: 'x' } }, 404);
    },
  };
  return server;
}

export interface TestIo extends Io {
  readonly stdout: string[];
  readonly stderr: string[];
}

export async function testIo(options: {
  cwd: string;
  server: FakeServer;
  keyring: readonly KeyringEntry[];
  stdin?: string;
  env?: Record<string, string>;
  cacheDir?: string;
  tty?: boolean;
  confirm?: boolean;
}): Promise<TestIo> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const cacheDir = options.cacheDir ?? (await tempDir('cache'));
  return {
    stdout,
    stderr,
    cwd: options.cwd,
    env: { AYMU_MCP_ORIGIN: ORIGIN, ...options.env },
    stdinIsTTY: options.tty ?? false,
    stdoutIsTTY: false,
    readStdin: () => Promise.resolve(options.stdin ?? ''),
    out: (l) => stdout.push(l),
    err: (l) => stderr.push(l),
    confirm: () => Promise.resolve(options.confirm ?? true),
    fetch: options.server.fetch,
    now: () => new Date(),
    openBrowser: () => Promise.resolve(true),
    keyring: options.keyring,
    cacheDir,
    tmpDir: tmpdir(),
    onInterrupt: () => () => undefined,
  };
}
